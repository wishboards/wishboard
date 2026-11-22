/** @vitest-environment node */
process.env.WISHBOARD_DB_PATH = ':memory:';

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'node:crypto';

// Small deterministic profile: two categories (one with an empty suggestion
// pool), two contact methods, tiny seed arrays.
const baseConfig = {
  profile: 'lifestyle',
  contact_methods: ['Phone', 'Email'],
  categories: [
    { id: 'gender', label: 'Gender', suggestions: ['Woman', 'Man'] },
    { id: 'role', label: 'Role', suggestions: [] },
  ],
  rules: [],
  demo_seeds: {
    actions: ['Act1', 'Act2'],
    subjects: ['Sub1'],
    contexts: ['Ctx1', 'Ctx2'],
    user_count: 2,
    wish_count: 2,
  },
};

vi.mock('./configManager.js', () => ({
  getEventProfile: vi.fn(() => baseConfig),
  getDomainConfig: vi.fn(() => baseConfig),
  DEFAULT_EVENT_PROFILE: 'lifestyle',
  clearConfigCache: vi.fn(),
}));

const { getEventProfile } = await import('./configManager.js');
const db = (await import('./db.js')).default;
const { generateDemoData } = await import('./demoSeeder.js');

const FROZEN_NOW = new Date('2026-06-01T12:00:00.000Z');
let batchSpy;
let randomIntSpy;

beforeEach(() => {
  vi.mocked(getEventProfile).mockReturnValue(baseConfig);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(FROZEN_NOW);
  batchSpy = vi.spyOn(db, 'batch').mockImplementation(async () => []);
});

afterEach(() => {
  vi.useRealTimers();
  randomIntSpy?.mockRestore();
  batchSpy?.mockRestore();
});

const scriptRandomInt = (fn) => {
  randomIntSpy = vi.spyOn(crypto, 'randomInt').mockImplementation(fn);
};

const INSERT_USER_SQL = `
  INSERT INTO users (id, username, passphrase_hash, passphrase_salt, role, identity_attributes, contacts, wishmail_enabled, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`;
const INSERT_WISH_SQL = `
  INSERT INTO wishes (
    id, user_id, content,
    creator_attributes, desired_attributes,
    contacts, wishmail_enabled,
    created_at, updated_at, flagged,
    card_style
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

describe('generateDemoData: exact statements under scripted randomness', () => {
  it('upper-bound rolls: exact clear/user/wish statements in one batch', async () => {
    scriptRandomInt((min, max) => max - 1);
    const result = await generateDemoData();
    expect(result).toEqual({ usersCreated: 2, wishesCreated: 2 });
    expect(batchSpy).toHaveBeenCalledTimes(1);
    const [stmts, mode] = batchSpy.mock.calls[0];
    expect(mode).toBe('write');
    expect(stmts).toHaveLength(7);

    expect(stmts[0]).toEqual({
      sql: "DELETE FROM wishes WHERE user_id IN (SELECT id FROM users WHERE username LIKE 'demo_user_%')",
      args: [],
    });
    expect(stmts[1]).toEqual({
      sql: "DELETE FROM users WHERE username LIKE 'demo_user_%'",
      args: [],
    });
    expect(stmts[2]).toEqual({
      sql: 'DELETE FROM sessions WHERE user_id NOT IN (SELECT id FROM users)',
      args: [],
    });

    const expectedContacts = JSON.stringify([
      { type: 'Phone', value: '555-0109' },
      { type: 'Email', value: 'demo_email_999' },
    ]);
    const expectedIdentity = '{"gender":["Woman","Man"],"role":[]}';
    for (const [i, username] of [
      [3, 'demo_user_1'],
      [4, 'demo_user_2'],
    ]) {
      const stmt = stmts[i];
      expect(stmt.sql).toBe(INSERT_USER_SQL);
      const [id, name, hash, salt, role, identity, contacts, wishmail, createdAt] = stmt.args;
      expect(id).toMatch(/^[a-z0-9]{8}$/);
      expect(name).toBe(username);
      expect(hash).toMatch(/^[0-9a-f]{128}$/);
      expect(salt).toMatch(/^[0-9a-f]{32}$/);
      expect(role).toBe('user');
      expect(identity).toBe(expectedIdentity);
      expect(contacts).toBe(expectedContacts);
      expect(wishmail).toBe(1);
      expect(createdAt).toBe('2026-06-01T12:00:00.000Z');
    }

    const secondUserId = stmts[4].args[0];
    const expectedWishDate = new Date(
      FROZEN_NOW.getTime() - (30 * 24 * 60 * 60 * 1000 - 1)
    ).toISOString();
    for (const stmt of stmts.slice(5)) {
      expect(stmt.sql).toBe(INSERT_WISH_SQL);
      const [
        id,
        userId,
        content,
        creatorAttrs,
        desiredAttrs,
        contacts,
        wishmail,
        createdAt,
        updatedAt,
        flagged,
        cardStyle,
      ] = stmt.args;
      expect(id).toMatch(/^[a-z0-9]{8}$/);
      expect(userId).toBe(secondUserId); // upper-bound roll picks the last user
      expect(content).toBe('Act2 Sub1 Ctx2');
      expect(creatorAttrs).toBe(expectedIdentity);
      expect(desiredAttrs).toBe('{"gender":[],"role":[]}');
      // The user's last contact is popped by the >70 roll.
      expect(contacts).toBe('[{"type":"Phone","value":"555-0109"}]');
      expect(wishmail).toBe(0); // flipped by the >80 roll
      expect(createdAt).toBe(expectedWishDate);
      expect(updatedAt).toBe(expectedWishDate);
      expect(flagged).toBe(0);
      expect(cardStyle).toBe('{"paperColor":"sage","pinColor":"violet"}');
    }
  });

  it('lower-bound rolls with 40/100: boundary comparisons fall the documented way', async () => {
    scriptRandomInt((min, max) => (min === 0 && max === 100 ? 40 : min));
    await generateDemoData();
    const [stmts] = batchSpy.mock.calls[0];
    const user = stmts[3];
    // 40 > 30, so gender gets one value: the shuffle swaps with index 0 and the
    // count roll is 1, yielding 'Man'. The empty role pool stays empty.
    expect(user.args[5]).toBe('{"gender":["Man"],"role":[]}');
    expect(user.args[6]).toBe('[]'); // contact count roll is 0
    expect(user.args[7]).toBe(0); // 40 > 50 is false
    const wish = stmts[5];
    expect(wish.args[1]).toBe(stmts[3].args[0]); // lower-bound roll picks the first user
    expect(wish.args[2]).toBe('Act1 Sub1 Ctx1');
    // emptyChance is exactly 40 and the roll is exactly 40: not greater, so a
    // value IS drawn (one, shuffled to 'Man').
    expect(wish.args[4]).toBe('{"gender":["Man"],"role":[]}');
    expect(wish.args[5]).toBe('[]');
    expect(wish.args[6]).toBe(0); // no flip at 40
    expect(wish.args[7]).toBe('2026-06-01T12:00:00.000Z'); // time offset roll is 0
    expect(wish.args[10]).toBe('{"paperColor":"ivory","pinColor":"ruby"}');
  });

  it('a wish for a contactless user gains a wish-specific contact on the >70 else-branch', async () => {
    // Contacts count roll 0 (users have none), flip roll low, pop roll low,
    // push roll high: the else-if branch appends contactMethods[0].
    scriptRandomInt((min, max) => {
      if (min === 0 && max === 100) return 85;
      if (min === 0 && max === 1000) return 42;
      return min;
    });
    await generateDemoData();
    const [stmts] = batchSpy.mock.calls[0];
    const wish = stmts[5];
    expect(wish.args[5]).toBe('[{"type":"Phone","value":"wish_specific_42"}]');
    // The user's wishmail flag is 1 (85 > 50) and the wish roll (85 > 80) flips it.
    expect(wish.args[6]).toBe(0);
  });

  it('uses the default counts of 50 users and 100 wishes when the seeds omit them', async () => {
    scriptRandomInt((min) => min);
    vi.mocked(getEventProfile).mockReturnValue({
      ...baseConfig,
      demo_seeds: { actions: ['A'], subjects: ['S'], contexts: ['C'] },
    });
    const result = await generateDemoData();
    expect(result).toEqual({ usersCreated: 50, wishesCreated: 100 });
    const [stmts] = batchSpy.mock.calls[0];
    expect(stmts).toHaveLength(3 + 50 + 100);
  });

  it('throws the exact errors for missing and empty seed data', async () => {
    vi.mocked(getEventProfile).mockReturnValue({ ...baseConfig, demo_seeds: null });
    await expect(generateDemoData()).rejects.toThrow(
      'No demo seed data found for this profile. Create a demo_seeds.yaml file in your profile directory with actions, subjects, and contexts arrays. See docs/EVENT_PROFILES.md for details.'
    );
    vi.mocked(getEventProfile).mockReturnValue({
      ...baseConfig,
      demo_seeds: { actions: [], subjects: ['S'], contexts: ['C'] },
    });
    await expect(generateDemoData()).rejects.toThrow(
      'demo_seeds must contain non-empty actions, subjects, and contexts arrays.'
    );
    expect(batchSpy).not.toHaveBeenCalled();
  });
});
