import crypto from 'node:crypto';
import { customAlphabet } from 'nanoid';
import db from './db.js';
import { createSalt, hashPassphrase } from './auth.js';
import logger from './logger.js';
import { getExclusionConflicts } from '@wishboards/matching-engine';
import { getRules, reloadRules } from './rulesManager.js';
import { getEventProfile } from './configManager.js';

const idGenerator = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 8);

const DEFAULT_USER_COUNT = 50;
const DEFAULT_WISH_COUNT = 100;

// Helper to securely shuffle an array using Fisher-Yates
function shuffleArray(arr) {
  const shuffled = [...arr];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

// Helper to grab 1-N random items from an array
function getRandom(arr, maxCount = 2) {
  const count = crypto.randomInt(1, maxCount + 1);
  return shuffleArray(arr).slice(0, count);
}

function generateRandomContacts(contactMethods) {
  const count = crypto.randomInt(0, 3); // 0 to 2 contacts
  if (count === 0) return [];

  return getRandom(contactMethods, count).map((type) => ({
    type,
    value:
      type === 'Phone'
        ? '555-010' + crypto.randomInt(0, 10)
        : `demo_${type.toLowerCase().replace(/\s+/g, '_')}_${crypto.randomInt(0, 1000)}`,
  }));
}

function randomList(arr, chanceEmpty) {
  return crypto.randomInt(0, 100) > chanceEmpty ? [] : getRandom(arr, 2);
}

/**
 * Build a random identity-attributes object using the profile's categories.
 * Each category gets 0-2 randomly selected suggestions.
 */
function generateRandomAttributes(attributePools) {
  const attrs = {};
  for (const pool of attributePools) {
    if (pool.values.length === 0) {
      attrs[pool.id] = [];
      continue;
    }
    // 70% chance to have at least one value, otherwise empty
    if (crypto.randomInt(0, 100) > 30) {
      attrs[pool.id] = getRandom(pool.values, 2);
    } else {
      attrs[pool.id] = [];
    }
  }
  return attrs;
}

/**
 * Build random desired-attributes for a wish using the profile's categories.
 * Uses varying empty-chance per category to create natural variety.
 */
function generateDesiredAttributes(attributePools) {
  const attrs = {};
  for (const pool of attributePools) {
    if (pool.values.length === 0) {
      attrs[pool.id] = [];
      continue;
    }
    // Each category has a different chance of being left empty
    const emptyChance = 40 + crypto.randomInt(0, 31); // 40-70%
    attrs[pool.id] = randomList(pool.values, emptyChance);
  }
  return attrs;
}

// Helper to generate a random Mad Libs wish
function generateMadLibsWish(demoSeeds) {
  const action = demoSeeds.actions[crypto.randomInt(0, demoSeeds.actions.length)];
  const subject = demoSeeds.subjects[crypto.randomInt(0, demoSeeds.subjects.length)];
  const context = demoSeeds.contexts[crypto.randomInt(0, demoSeeds.contexts.length)];
  return `${action} ${subject} ${context}`;
}

const INSERT_USER_SQL = `
  INSERT INTO users (id, username, passphrase_hash, passphrase_salt, role, identity_attributes, contacts, wishmail_enabled, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

const INSERT_WISH_SQL = `
  INSERT INTO wishes (
    id, user_id, content,
    creator_attributes, desired_attributes,
    contacts, wishmail_enabled,
    created_at, updated_at, flagged
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

function buildClearDemoDataStmts() {
  // 1. Clear existing demo/user data (Keep the default admin's session)
  // Remove wishes and demo users first, then prune sessions that no
  // longer belong to any remaining user (this preserves the admin's session)
  return [
    {
      sql: "DELETE FROM wishes WHERE user_id IN (SELECT id FROM users WHERE username LIKE 'demo_user_%')",
      args: [],
    },
    {
      sql: "DELETE FROM users WHERE username LIKE 'demo_user_%'",
      args: [],
    },
    {
      sql: 'DELETE FROM sessions WHERE user_id NOT IN (SELECT id FROM users)',
      args: [],
    },
  ];
}

async function createSingleUser(index, attributePools, contactMethods) {
  const id = idGenerator();
  const username = `demo_user_${index}`;
  const salt = createSalt();
  const hash = await hashPassphrase('demo-password', salt);

  // Generate random identities, retry if exclusion conflicts arise
  let attributes;
  let attempts = 0;
  while (true) {
    attributes = generateRandomAttributes(attributePools);
    const conflicts = getExclusionConflicts(attributes, getRules());
    if (conflicts.length === 0 || attempts > 10) break;
    attempts++;
  }

  const identityAttributes = JSON.stringify(attributes);
  const contacts = generateRandomContacts(contactMethods);
  const wishmailEnabledInt = crypto.randomInt(0, 100) > 50 ? 1 : 0;
  const createdAt = new Date().toISOString();

  return {
    user: {
      id,
      identityAttributes,
      contacts,
      wishmailEnabled: wishmailEnabledInt === 1,
    },
    stmt: {
      sql: INSERT_USER_SQL,
      args: [
        id,
        username,
        hash,
        salt,
        'user',
        identityAttributes,
        JSON.stringify(contacts),
        wishmailEnabledInt,
        createdAt,
      ],
    },
  };
}

async function buildDemoUsers(userCount, attributePools, contactMethods) {
  // 2. Generate simulated users concurrently
  const results = await Promise.all(
    Array.from({ length: userCount }, (_, idx) =>
      createSingleUser(idx + 1, attributePools, contactMethods)
    )
  );
  return {
    users: results.map((r) => r.user),
    userStmts: results.map((r) => r.stmt),
  };
}

function buildSingleWishStmt(randomUser, attributePools, contactMethods, demoSeeds) {
  const id = idGenerator();
  const content = generateMadLibsWish(demoSeeds);

  let desiredAttrs;
  let attempts = 0;
  while (true) {
    desiredAttrs = generateDesiredAttributes(attributePools);
    const conflicts = getExclusionConflicts(desiredAttrs, getRules());
    if (conflicts.length === 0 || attempts > 10) break;
    attempts++;
  }

  const desiredAttributes = JSON.stringify(desiredAttrs);

  const timeOffset = crypto.randomInt(0, 30 * 24 * 60 * 60 * 1000);
  const date = new Date(Date.now() - timeOffset).toISOString();

  const wishContacts = [...randomUser.contacts];
  let wishWishmail = randomUser.wishmailEnabled;

  if (crypto.randomInt(0, 100) > 80) wishWishmail = !wishWishmail;

  if (crypto.randomInt(0, 100) > 70 && wishContacts.length > 0) {
    wishContacts.pop();
  } else if (crypto.randomInt(0, 100) > 70) {
    wishContacts.push({
      type: contactMethods[0] || 'Email',
      value: `wish_specific_${crypto.randomInt(0, 1000)}`,
    });
  }

  return {
    sql: INSERT_WISH_SQL,
    args: [
      id,
      randomUser.id,
      content,
      randomUser.identityAttributes,
      desiredAttributes,
      JSON.stringify(wishContacts),
      wishWishmail ? 1 : 0,
      date,
      date,
      0,
    ],
  };
}

function buildDemoWishStmts(users, wishCount, attributePools, contactMethods, demoSeeds) {
  // 3. Distribute wishes randomly across the users
  const wishStmts = [];
  for (let i = 0; i < wishCount; i++) {
    const randomUser = users[crypto.randomInt(0, users.length)];
    wishStmts.push(buildSingleWishStmt(randomUser, attributePools, contactMethods, demoSeeds));
  }
  return wishStmts;
}

export async function generateDemoData() {
  const config = getEventProfile();
  const { categories, contact_methods: contactMethods, demo_seeds: demoSeeds } = config;

  if (!demoSeeds) {
    throw new Error(
      'No demo seed data found for this profile. ' +
        'Create a demo_seeds.yaml file in your profile directory with actions, subjects, and contexts arrays. ' +
        'See docs/EVENT_PROFILES.md for details.'
    );
  }

  if (!demoSeeds.actions?.length || !demoSeeds.subjects?.length || !demoSeeds.contexts?.length) {
    throw new Error('demo_seeds must contain non-empty actions, subjects, and contexts arrays.');
  }

  const userCount = demoSeeds.user_count ?? DEFAULT_USER_COUNT;
  const wishCount = demoSeeds.wish_count ?? DEFAULT_WISH_COUNT;

  // Build attribute pools dynamically from profile categories
  const attributePools = (categories || []).map((c) => ({
    id: c.id,
    values: c.suggestions ?? [],
  }));

  logger.info('Clearing old demo data for seeder');
  await reloadRules(); // Ensure rules are loaded for exclusion checks
  const clearStmts = buildClearDemoDataStmts();
  const { users, userStmts } = await buildDemoUsers(userCount, attributePools, contactMethods);
  const wishStmts = buildDemoWishStmts(users, wishCount, attributePools, contactMethods, demoSeeds);

  await db.batch([...clearStmts, ...userStmts, ...wishStmts], 'write');

  logger.info('Demo seeder completed', { usersCreated: userCount, wishesCreated: wishCount });
  return { usersCreated: userCount, wishesCreated: wishCount };
}
