import express from 'express';
import multer from 'multer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import crypto from 'node:crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const isS3Mode = Boolean(process.env.AWS_S3_BUCKET);
const imagesDir = isS3Mode ? '/tmp' : path.resolve(__dirname, '../../../data/images');
if (!isS3Mode) {
  fs.mkdirSync(imagesDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, imagesDir);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase() || '.png';
    const uniqueSuffix = Date.now() + '-' + crypto.randomInt(0, 1000000000);
    cb(null, file.fieldname + '-' + uniqueSuffix + ext);
  },
});
const fileFilter = (req, file, cb) => {
  const allowedExtensions = ['.png', '.jpg', '.jpeg', '.webp'];
  const ext = path.extname(file.originalname).toLowerCase();
  if (allowedExtensions.includes(ext)) {
    cb(null, true);
  } else {
    // A client-input validation error: mark it safe-to-expose with a 400 so the
    // JSON error handler returns the helpful message (not a generic 500).
    const err = new Error('Invalid file type. Only PNG, JPG, and WEBP are allowed.');
    err.status = 400;
    err.expose = true;
    cb(err, false);
  }
};
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 },
});

import { customAlphabet } from 'nanoid';
import db from '../db.js';
import {
  getUserFromToken,
  getTokenFromRequestHeader,
  hashPassphrase,
  verifyPassphrase,
  parseJsonArray,
  normalizeArrayInput,
  createSalt,
  requireAuth,
} from '../auth.js';
import { generatePassphrase } from '../../client/src/passphrase.js';
import logger from '../logger.js';
import { getRules } from '../rulesManager.js';
import { emitNewWish, emitWishFlagged, emitWishDeleted } from '../socket.js';
import { ensureArray } from '../utils/arrays.js';

const router = express.Router();
const idGenerator = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 8);

const getRequestUser = async (req) => {
  const token = getTokenFromRequestHeader(req);
  return await getUserFromToken(token);
};

export {
  normalizeToken,
  escapeRegExp,
  hasToken,
  parseJsonSafe,
  parseAttributesInput,
  matchesContext,
  getExpandedDesired,
  getExclusionConflicts,
  evaluateRuleConditions,
  enrichAttributes,
  buildAcceptedSet,
  applyCrossRule,
  getCrossMatchedDesired,
  matchesAttribute,
  isCompatible,
} from '@wishboards/matching-engine';

import {
  isCompatible,
  getExclusionConflicts,
  parseJsonSafe,
  parseAttributesInput,
} from '@wishboards/matching-engine';

const uploadImageToS3 = async (file) => {
  const safePath = path.join(imagesDir, path.basename(file.filename));
  try {
    const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
    const s3 = new S3Client();
    const fileStream = fs.createReadStream(safePath);

    await s3.send(
      new PutObjectCommand({
        Bucket: process.env.AWS_S3_BUCKET,
        Key: `images/${file.filename}`,
        Body: fileStream,
        ContentType: file.mimetype,
      })
    );

    fs.unlinkSync(safePath);
    logger.info('Uploaded image to S3', {
      bucket: process.env.AWS_S3_BUCKET,
      key: `images/${file.filename}`,
    });
    return { error: null };
  } catch (err) {
    logger.error('Failed to upload image to S3:', { error: err.message });
    if (fs.existsSync(safePath)) {
      fs.unlinkSync(safePath);
    }
    return { error: 'Failed to process image upload.' };
  }
};

router.post('/', upload.single('image'), async (req, res) => {
  const { content, passphrase, contacts, wishmail_enabled } = req.body;
  if (!content?.trim()) {
    return res.status(400).json({ error: 'Wish content is required.' });
  }

  const imageId = req.file ? req.file.filename : null;

  if (req.file && isS3Mode) {
    const { error } = await uploadImageToS3(req.file);
    if (error) {
      return res.status(500).json({ error });
    }
  }

  const user = await getRequestUser(req);
  const userId = user?.id || null;
  const id = idGenerator();
  let secret = null;
  let secretHash = null;

  if (!userId) {
    secret = passphrase?.trim() || generatePassphrase();
    const salt = createSalt();
    const hash = await hashPassphrase(secret, salt);
    secretHash = `${salt}:${hash}`;
  }

  let creatorAttrs = parseAttributesInput(req.body.creator_attributes);

  if (user?.identity_attributes) {
    // Merge user identity attributes if logged in
    creatorAttrs = {
      ...user.identity_attributes,
      ...creatorAttrs,
    };
  }

  let desiredAttrs = parseAttributesInput(req.body.desired_attributes);

  const rules = getRules();
  const creatorConflicts = getExclusionConflicts(creatorAttrs, rules);
  if (creatorConflicts.length > 0) {
    return res.status(400).json({
      error: `Validation failed: Creator attributes conflict. ${creatorConflicts.map((c) => c.message).join(' ')}`,
    });
  }

  const desiredConflicts = getExclusionConflicts(desiredAttrs, rules);
  if (desiredConflicts.length > 0) {
    return res.status(400).json({
      error: `Validation failed: Desired criteria conflict. ${desiredConflicts.map((c) => c.message).join(' ')}`,
    });
  }

  const parsedContacts = ensureArray(contacts);
  const wme = wishmail_enabled ? 1 : 0;

  const now = new Date().toISOString();
  await db
    .prepare(
      'INSERT INTO wishes (id, user_id, content, secret_hash, contacts, wishmail_enabled, created_at, updated_at, image_id, creator_attributes, desired_attributes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .run(
      id,
      userId,
      content.trim(),
      secretHash,
      JSON.stringify(parsedContacts),
      wme,
      now,
      now,
      imageId,
      JSON.stringify(creatorAttrs),
      JSON.stringify(desiredAttrs)
    );

  logger.info('Wish created', { user_id: userId, wish_id: id });
  const newWish = {
    id,
    content: content.trim(),
    created_at: now,
    creator_attributes: creatorAttrs,
    desired_attributes: desiredAttrs,
    contacts: parsedContacts,
    wishmail_enabled: Boolean(wme),
    image_id: imageId,
    is_active: true,
  };
  emitNewWish(newWish);

  res.status(201).json({ id, secret });
});

router.get('/random', async (req, res) => {
  const limit = Number(req.query.limit || 12);
  const rows = await db
    .prepare(
      'SELECT w.id, w.content, w.creator_attributes, w.contacts, w.wishmail_enabled, w.image_id FROM wishes w LEFT JOIN users u ON w.user_id = u.id WHERE w.is_active = 1 AND (u.id IS NULL OR u.is_active = 1) ORDER BY RANDOM() LIMIT ?'
    )
    .all(limit);
  res.json(
    rows.map((wish) => ({
      id: wish.id,
      content: wish.content,
      creator_attributes: parseJsonSafe(wish.creator_attributes),
      contacts: parseJsonArray(wish.contacts),
      wishmail_enabled: Boolean(wish.wishmail_enabled),
      image_id: wish.image_id,
    }))
  );
});

/**
 * Parse a comma-separated list of IDs from a query parameter that may be a
 * string or an array of strings (express can produce either).
 * Trims, deduplicates, and caps at 200 entries.
 * @param {string | string[] | undefined} raw
 * @returns {string[]}
 */
function parseQueryIds(raw) {
  let str = '';
  if (typeof raw === 'string') {
    str = raw;
  } else if (Array.isArray(raw)) {
    str = raw.map(String).join(',');
  }
  return str
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)
    .slice(0, 200);
}

/**
 * Excludes wishes the signed-in user has hidden, via their wish_exclusions rows.
 * @param {string} sql
 * @param {any[]} args
 * @param {object} searcher
 * @returns {{ sql: string; args: any[] }}
 */
function applyUserExclusionFilter(sql, args, searcher) {
  return {
    sql:
      sql +
      ' AND NOT EXISTS (SELECT 1 FROM wish_exclusions x WHERE x.wish_id = w.id AND x.user_id = ?)',
    args: [...args, searcher.id],
  };
}

/**
 * Excludes the ids an anonymous caller passes in the query string. Bound as a
 * single JSON array through json_each rather than N placeholders, matching the
 * approach taken elsewhere in this module (see #354).
 * @param {string} sql
 * @param {any[]} args
 * @param {string | string[] | undefined} excludeQuery
 * @returns {{ sql: string; args: any[] }}
 */
function applyQueryExclusionFilter(sql, args, excludeQuery) {
  const excludeIds = parseQueryIds(excludeQuery);
  if (excludeIds.length === 0) {
    return { sql, args };
  }

  return {
    sql: sql + ' AND w.id NOT IN (SELECT value FROM json_each(?))',
    args: [...args, JSON.stringify(excludeIds)],
  };
}

/**
 * Append exclusion filter clauses to the SQL query.
 * @param {object} params
 * @param {string} params.sql
 * @param {any[]} params.args
 * @param {object|null} params.searcher
 * @param {string | string[] | undefined} params.excludeQuery
 * @returns {{ sql: string; args: any[] }}
 */
function applyExclusionFilter({ sql, args, searcher, excludeQuery }) {
  if (searcher) {
    return applyUserExclusionFilter(sql, args, searcher);
  }
  return applyQueryExclusionFilter(sql, args, excludeQuery);
}

router.get('/', async (req, res) => {
  const searcher = await getRequestUser(req);
  const query = (req.query.q || '').trim();
  const manualAttributes = req.query.attributes ? parseJsonSafe(req.query.attributes) : {};
  const queryAliasMap = { sg: 'gender', so: 'orientation', sr: 'role' };
  for (const [alias, cat] of Object.entries(queryAliasMap)) {
    if (req.query[alias] && !manualAttributes[cat]) {
      manualAttributes[cat] = normalizeArrayInput(req.query[alias]);
    }
  }
  for (const [key, val] of Object.entries(req.query)) {
    if (['q', 'sg', 'so', 'sr', 'attributes', 'ignore_attributes', 'page', 'limit'].includes(key))
      continue;
    if (!manualAttributes[key]) {
      manualAttributes[key] = normalizeArrayInput(val);
    }
  }

  let searcherAttributes = {};
  if (searcher?.identity_attributes) {
    searcherAttributes =
      typeof searcher.identity_attributes === 'string'
        ? parseJsonSafe(searcher.identity_attributes)
        : searcher.identity_attributes || {};
  }

  for (const [key, value] of Object.entries(manualAttributes)) {
    if (!searcherAttributes[key] || searcherAttributes[key].length === 0) {
      searcherAttributes[key] = normalizeArrayInput(value);
    }
  }

  const ignoreAttributes =
    req.query.ignore_attributes === '1' ||
    req.query.ignore_attributes === 'true' ||
    (!searcher &&
      Object.keys(searcherAttributes).every(
        (k) => !searcherAttributes[k] || searcherAttributes[k].length === 0
      ));

  const searcherProfile = {
    identity_attributes: searcherAttributes,
  };

  let sql =
    'SELECT w.id, w.content, w.creator_attributes, w.desired_attributes, w.contacts, w.wishmail_enabled, w.image_id FROM wishes w LEFT JOIN users u ON w.user_id = u.id WHERE w.is_active = 1 AND (u.id IS NULL OR u.is_active = 1)';
  let args = [];

  if (query) {
    sql += ' AND w.content LIKE ?';
    args.push(`%${query}%`);
  }

  if (req.query.ids) {
    const filterIds = parseQueryIds(req.query.ids);
    if (filterIds.length > 0) {
      sql += ' AND w.id IN (SELECT value FROM json_each(?))';
      args.push(JSON.stringify(filterIds));
    }
  }

  const includeExcluded =
    req.query.include_excluded === '1' || req.query.include_excluded === 'true';

  if (!includeExcluded) {
    ({ sql, args } = applyExclusionFilter({
      sql,
      args,
      searcher,
      excludeQuery: req.query.exclude,
    }));
  }

  sql += ' ORDER BY w.created_at DESC LIMIT 50';

  const rows = await db.prepare(sql).all(...args);

  const rules = getRules();
  const filtered = ignoreAttributes
    ? rows
    : rows.filter((wish) => isCompatible(wish, searcherProfile, rules));
  res.json(
    filtered.map((wish) => ({
      id: wish.id,
      content: wish.content,
      creator_attributes: parseJsonSafe(wish.creator_attributes),
      desired_attributes: parseJsonSafe(wish.desired_attributes),
      contacts: parseJsonArray(wish.contacts),
      wishmail_enabled: Boolean(wish.wishmail_enabled),
      image_id: wish.image_id,
    }))
  );
});

// List excluded wish IDs - must be before /:id to avoid param capture
router.get('/exclusions/list', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const rows = await db
    .prepare('SELECT wish_id FROM wish_exclusions WHERE user_id = ?')
    .all(userId);

  res.json(rows.map((row) => row.wish_id));
});

// List full excluded wishes - must be before /:id to avoid param capture
router.get('/exclusions', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const rows = await db
    .prepare(
      'SELECT w.id, w.content, w.creator_attributes, w.desired_attributes, w.contacts, w.wishmail_enabled, w.image_id FROM wish_exclusions x JOIN wishes w ON x.wish_id = w.id WHERE x.user_id = ?'
    )
    .all(userId);

  res.json(
    rows.map((wish) => ({
      id: wish.id,
      content: wish.content,
      creator_attributes: parseJsonSafe(wish.creator_attributes),
      desired_attributes: parseJsonSafe(wish.desired_attributes),
      contacts: parseJsonArray(wish.contacts),
      wishmail_enabled: Boolean(wish.wishmail_enabled),
      image_id: wish.image_id,
    }))
  );
});

// Bulk import exclusions (when migrating from anonymous localStorage to user database on login)
// Must be before /:id to avoid param capture
router.post('/exclusions/import', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const { ids } = req.body;

  if (!Array.isArray(ids)) {
    return res.status(400).json({ error: 'List of IDs to exclude must be an array.' });
  }

  // Cap at 200 items to prevent abuse
  const cleanIds = ids
    .map((id) => String(id).trim())
    .filter(Boolean)
    .slice(0, 200);

  const now = new Date().toISOString();
  if (cleanIds.length > 0) {
    try {
      const placeholders = cleanIds.map(() => '?').join(', ');
      const existingWishes = await db
        .prepare(`SELECT id FROM wishes WHERE id IN (${placeholders})`)
        .all(...cleanIds);
      const existingIds = existingWishes.map((w) => w.id);

      if (existingIds.length > 0) {
        const insertPlaceholders = existingIds.map(() => '(?, ?, ?)').join(', ');
        const args = [];
        for (const id of existingIds) {
          args.push(userId, id, now);
        }
        await db
          .prepare(
            `INSERT OR IGNORE INTO wish_exclusions (user_id, wish_id, created_at) VALUES ${insertPlaceholders}`
          )
          .run(...args);
      }
    } catch (err) {
      logger.warn('Failed to import exclusions in bulk', { user_id: userId, err });
    }
  }

  res.json({ success: true });
});

router.get('/:id', async (req, res) => {
  const { id } = req.params;
  const row = await db
    .prepare(
      'SELECT id, content, flagged, contacts, wishmail_enabled, created_at, updated_at, is_active, image_id FROM wishes WHERE id = ?'
    )
    .get(id);
  if (!row) {
    return res.status(404).json({ error: 'Wish not found.' });
  }
  row.contacts = parseJsonArray(row.contacts);
  row.wishmail_enabled = Boolean(row.wishmail_enabled);
  row.is_active = Boolean(row.is_active);
  res.json(row);
});

const getAuthorizedWish = async (req, res) => {
  const { id } = req.params;
  const secret = req.body?.secret;
  const user = await getRequestUser(req);

  const row = await db.prepare('SELECT secret_hash, user_id FROM wishes WHERE id = ?').get(id);
  if (!row) {
    res.status(404).json({ error: 'Wish not found.' });
    return null;
  }

  const isOwner = user?.id === row.user_id;
  const isAuthorized =
    isOwner ||
    (secret &&
      row.secret_hash &&
      (await verifyPassphrase(secret.trim(), ...row.secret_hash.split(':'))));

  if (!isAuthorized) {
    if (!secret && !isOwner && row.secret_hash) {
      res.status(401).json({ error: 'Secret token required for wish management.' });
    } else {
      res.status(403).json({ error: 'Invalid secret token or unauthorized.' });
    }
    return null;
  }

  return { row, user, id };
};

router.post('/:id/manage', async (req, res) => {
  const auth = await getAuthorizedWish(req, res);
  if (!auth) return;
  const { user, id, row } = auth;
  const { content, action } = req.body;

  if (action === 'delete') {
    await db.prepare('DELETE FROM wishmails WHERE wish_id = ?').run(id);
    await db.prepare('DELETE FROM wish_exclusions WHERE wish_id = ?').run(id);
    await db.prepare('DELETE FROM wishes WHERE id = ?').run(id);
    logger.info('Wish deleted by owner', { user_id: user?.id, wish_id: id });
    emitWishDeleted(id);
    return res.json({ success: true });
  }

  if (content?.trim()) {
    const { contacts, wishmail_enabled, new_passphrase } = req.body;
    const parsedContacts = ensureArray(contacts);
    const wme = wishmail_enabled ? 1 : 0;
    const now = new Date().toISOString();

    let secretHashToUpdate = row.secret_hash;
    let newSecret = null;
    if (row.secret_hash && new_passphrase?.trim()) {
      const salt = createSalt();
      const hash = await hashPassphrase(new_passphrase.trim(), salt);
      secretHashToUpdate = `${salt}:${hash}`;
      newSecret = new_passphrase.trim();
    }

    await db
      .prepare(
        'UPDATE wishes SET content = ?, contacts = ?, wishmail_enabled = ?, secret_hash = ?, updated_at = ? WHERE id = ?'
      )
      .run(content.trim(), JSON.stringify(parsedContacts), wme, secretHashToUpdate, now, id);

    return res.json({ success: true, newSecret });
  }

  res.status(400).json({ error: 'Invalid update payload.' });
});

router.post('/:id/deactivate', async (req, res) => {
  const auth = await getAuthorizedWish(req, res);
  if (!auth) return;

  await db
    .prepare('UPDATE wishes SET is_active = 0, updated_at = ? WHERE id = ?')
    .run(new Date().toISOString(), auth.id);
  emitWishDeleted(auth.id); // Immediately remove from UI
  res.json({ success: true });
});

router.post('/:id/reactivate', async (req, res) => {
  const auth = await getAuthorizedWish(req, res);
  if (!auth) return;

  await db
    .prepare('UPDATE wishes SET is_active = 1, updated_at = ? WHERE id = ?')
    .run(new Date().toISOString(), auth.id);

  const wish = await db
    .prepare(
      'SELECT id, content, creator_attributes, contacts, wishmail_enabled, image_id FROM wishes WHERE id = ?'
    )
    .get(auth.id);

  if (!wish) {
    return res.status(404).json({ error: 'Wish not found' });
  }

  const { emitWishReactivated } = await import('../socket.js');
  emitWishReactivated({
    ...wish,
    creator_attributes: parseJsonSafe(wish.creator_attributes),
    contacts: parseJsonArray(wish.contacts),
    wishmail_enabled: Boolean(wish.wishmail_enabled),
    image_id: wish.image_id,
  });

  res.json({ success: true });
});

router.post('/:id/claim', async (req, res) => {
  const { id } = req.params;
  const { secret } = req.body;
  const user = await getRequestUser(req);

  if (!user) {
    return res.status(401).json({ error: 'Must be logged in to claim a wish.' });
  }

  if (!secret) {
    return res.status(400).json({ error: 'Passphrase is required.' });
  }

  const row = await db.prepare('SELECT secret_hash, user_id FROM wishes WHERE id = ?').get(id);
  if (!row) {
    return res.status(404).json({ error: 'Wish not found.' });
  }

  if (row.user_id) {
    return res.status(403).json({ error: 'This wish has already been claimed by a user.' });
  }

  if (!row.secret_hash) {
    return res.status(403).json({ error: 'This wish cannot be claimed.' });
  }

  const [salt, hash] = row.secret_hash.split(':');
  if (!(await verifyPassphrase(secret.trim(), salt, hash))) {
    return res.status(403).json({ error: 'Invalid passphrase.' });
  }

  const now = new Date().toISOString();
  // Assign to user and clear the secret_hash since it's now managed via user authentication
  await db
    .prepare('UPDATE wishes SET user_id = ?, secret_hash = NULL, updated_at = ? WHERE id = ?')
    .run(user.id, now, id);

  logger.info('Wish claimed by user', { user_id: user.id, wish_id: id });
  res.json({ success: true });
});

router.post('/:id/flag', async (req, res) => {
  const { id } = req.params;
  const result = await db.prepare('UPDATE wishes SET flagged = 1 WHERE id = ?').run(id);
  if (result.changes === 0) {
    return res.status(404).json({ error: 'Wish not found.' });
  }

  const flaggedWish = await db
    .prepare('SELECT id, content, flagged, user_id FROM wishes WHERE id = ?')
    .get(id);
  emitWishFlagged(flaggedWish);

  logger.warn('Wish flagged for moderation', { wish_id: id });
  res.json({ success: true });
});

// Exclude a wish (Hide / Not Interested)
router.post('/:id/exclude', requireAuth, async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;
  const now = new Date().toISOString();

  // Verify wish exists
  const wishExists = await db.prepare('SELECT 1 FROM wishes WHERE id = ?').get(id);
  if (!wishExists) {
    return res.status(404).json({ error: 'Wish not found.' });
  }

  await db
    .prepare(
      'INSERT OR IGNORE INTO wish_exclusions (user_id, wish_id, created_at) VALUES (?, ?, ?)'
    )
    .run(userId, id, now);

  logger.info('Wish excluded by user', { user_id: userId, wish_id: id });
  res.json({ success: true });
});

// Remove exclusion (Un-hide / Undo)
router.delete('/:id/exclude', requireAuth, async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  await db.prepare('DELETE FROM wish_exclusions WHERE user_id = ? AND wish_id = ?').run(userId, id);

  logger.info('Wish exclusion removed by user', { user_id: userId, wish_id: id });
  res.json({ success: true });
});

export default router;
