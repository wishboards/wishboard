import express from 'express';
import { customAlphabet } from 'nanoid';
import db from '../db.js';
import {
  createSalt,
  hashPassphrase,
  createSessionToken,
  getUserFromRequest,
  getTokenFromRequestHeader,
  verifyPassphrase,
  parseJsonArray,
  parseJsonObject,
} from '../auth.js';
import { generatePassphrase } from '../../client/src/passphrase.js';
import logger from '../logger.js';
import { getRules } from '../rulesManager.js';
import { getExclusionConflicts, parseAttributesInput } from '@wishboards/matching-engine';
import { validateBody, validateQuery } from '../utils/validation.js';
import {
  UsernameCheckQuerySchema,
  RegisterUserInputSchema,
  LoginInputSchema,
} from '../docs/openapi.js';

const router = express.Router();
const idGenerator = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 8);

router.get('/exists', validateQuery(UsernameCheckQuerySchema), async (req, res) => {
  const { username } = req.validatedQuery;

  const existingUser = await db
    .prepare('SELECT 1 FROM users WHERE username = ?')
    .get(username.trim());
  res.json({ exists: Boolean(existingUser) });
});

const validateProfile = (identityAttrs) => {
  const rules = getRules();
  const conflicts = getExclusionConflicts(identityAttrs, rules);
  return {
    identityAttrs,
    error:
      conflicts.length > 0
        ? `Validation failed: Profile attributes conflict. ${conflicts.map((c) => c.message).join(' ')}`
        : null,
  };
};

router.post('/register', validateBody(RegisterUserInputSchema), async (req, res) => {
  const { username, passphrase, contacts, wishmail_enabled } = req.validatedBody;

  const existingUser = await db
    .prepare('SELECT id FROM users WHERE username = ?')
    .get(username.trim());
  if (existingUser) {
    return res.status(409).json({ error: 'Username already exists.' });
  }

  const providedPassphrase = typeof passphrase === 'string' ? passphrase.trim() : '';
  const secret = providedPassphrase || generatePassphrase();
  const salt = createSalt();
  const hash = await hashPassphrase(secret, salt);
  const userId = idGenerator();
  const now = new Date().toISOString();

  const identityAttrs = parseAttributesInput(req.body.identity_attributes);

  const { error } = validateProfile(identityAttrs);
  if (error) {
    return res.status(400).json({ error });
  }

  const wishmailEnabledInt = wishmail_enabled ? 1 : 0;

  await db
    .prepare(
      'INSERT INTO users (id, username, passphrase_hash, passphrase_salt, role, contacts, wishmail_enabled, created_at, identity_attributes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .run(
      userId,
      username.trim(),
      hash,
      salt,
      'user',
      JSON.stringify(contacts || []),
      wishmailEnabledInt,
      now,
      JSON.stringify(identityAttrs)
    );

  logger.info('New user registered', { user_id: userId, username: username.trim() });
  const token = await createSessionToken(userId);
  res.json({
    id: userId,
    username: username.trim(),
    role: 'user',
    is_active: true,
    token,
    secret,
    contacts: contacts || [],
    wishmail_enabled: Boolean(wishmailEnabledInt),
    identity_attributes: identityAttrs,
  });
});

router.use('/me', async (req, res, next) => {
  const user = await getUserFromRequest(req);
  if (!user) {
    return res.status(401).json({ error: 'Not authenticated.' });
  }
  req.user = user;
  next();
});

router.put('/me', async (req, res) => {
  const user = req.user;

  const { contacts, wishmail_enabled } = req.body;
  const identityAttrs = parseAttributesInput(req.body.identity_attributes);

  const { error } = validateProfile(identityAttrs);
  if (error) {
    return res.status(400).json({ error });
  }

  const wishmailEnabledInt = wishmail_enabled ? 1 : 0;

  await db
    .prepare(
      'UPDATE users SET contacts = ?, wishmail_enabled = ?, identity_attributes = ? WHERE id = ?'
    )
    .run(
      JSON.stringify(contacts || []),
      wishmailEnabledInt,
      JSON.stringify(identityAttrs),
      user.id
    );

  res.json({
    id: user.id,
    username: user.username,
    role: user.role,
    contacts: contacts || [],
    wishmail_enabled: Boolean(wishmailEnabledInt),
    identity_attributes: identityAttrs,
  });
});

router.post('/login', validateBody(LoginInputSchema), async (req, res) => {
  const { username, passphrase } = req.validatedBody;

  const user = await db
    .prepare(
      'SELECT id, username, role, is_active, passphrase_hash, passphrase_salt, contacts, wishmail_enabled, identity_attributes FROM users WHERE username = ?'
    )
    .get(username.trim());
  if (
    !user ||
    !(await verifyPassphrase(passphrase.trim(), user.passphrase_salt, user.passphrase_hash))
  ) {
    logger.warn('Failed login attempt', { username: username.trim(), ip: req.ip });
    return res.status(401).json({ error: 'Invalid username or passphrase.' });
  }

  logger.info('Successful login', { username: user.username, ip: req.ip });
  const token = await createSessionToken(user.id);
  res.json({
    id: user.id,
    username: user.username,
    role: user.role,
    is_active: Boolean(user.is_active),
    token,
    contacts: parseJsonArray(user.contacts),
    wishmail_enabled: Boolean(user.wishmail_enabled),
    identity_attributes: parseJsonObject(user.identity_attributes),
  });
});

router.post('/logout', async (req, res) => {
  const token = getTokenFromRequestHeader(req);
  if (token) {
    await db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  }
  res.json({ success: true });
});

router.get('/me/delete-preview', async (req, res) => {
  const user = req.user;

  const wishesCount = (
    await db.prepare('SELECT COUNT(*) as count FROM wishes WHERE user_id = ?').get(user.id)
  ).count;
  const wishmailsCount = (
    await db
      .prepare(
        'SELECT COUNT(*) as count FROM wishmails WHERE wish_id IN (SELECT id FROM wishes WHERE user_id = ?)'
      )
      .get(user.id)
  ).count;

  res.json({ wishesCount, wishmailsCount });
});

router.post('/me/delete', async (req, res) => {
  const user = req.user;

  if (user.role === 'admin') {
    const adminCount = (
      await db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'admin'").get()
    ).count;
    if (adminCount <= 1) {
      return res.status(403).json({ error: 'Cannot delete the last admin user.' });
    }
  }

  await db
    .prepare('DELETE FROM wishmails WHERE wish_id IN (SELECT id FROM wishes WHERE user_id = ?)')
    .run(user.id);
  await db.prepare('DELETE FROM wishes WHERE user_id = ?').run(user.id);
  await db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
  await db.prepare('DELETE FROM users WHERE id = ?').run(user.id);

  logger.info('User self-deleted', { user_id: user.id });
  res.json({ success: true });
});

async function setUserActiveState(req, res, isActive) {
  const user = req.user;
  const activeInt = isActive ? 1 : 0;

  await db.prepare('UPDATE users SET is_active = ? WHERE id = ?').run(activeInt, user.id);

  if (isActive) {
    const wishes = await db
      .prepare(
        'SELECT id, content, creator_attributes, contacts, wishmail_enabled, image_id FROM wishes WHERE user_id = ? AND is_active = 1'
      )
      .all(user.id);
    const { emitWishReactivated } = await import('../socket.js');
    wishes.forEach((w) => {
      emitWishReactivated({
        ...w,
        creator_attributes: parseJsonObject(w.creator_attributes),
        contacts: parseJsonArray(w.contacts),
        wishmail_enabled: Boolean(w.wishmail_enabled),
        image_id: w.image_id,
      });
    });
    logger.info('User reactivated', { user_id: user.id });
  } else {
    const wishes = await db.prepare('SELECT id FROM wishes WHERE user_id = ?').all(user.id);
    const { emitWishDeleted } = await import('../socket.js');
    wishes.forEach((w) => emitWishDeleted(w.id));
    logger.info('User deactivated', { user_id: user.id });
  }

  res.json({ success: true });
}

router.post('/me/deactivate', (req, res) => setUserActiveState(req, res, false));
router.post('/me/reactivate', (req, res) => setUserActiveState(req, res, true));

router.get('/me', async (req, res) => {
  const user = req.user;
  res.json(user);
});

router.get('/me/wishes', async (req, res) => {
  const user = req.user;

  const rows = await db
    .prepare(
      'SELECT id, content, contacts, wishmail_enabled, creator_attributes, desired_attributes, flagged, created_at, updated_at, is_active, image_id, (SELECT COUNT(*) FROM wishmails wm WHERE wm.wish_id = wishes.id AND wm.read = 0) AS unread_wishmail_count FROM wishes WHERE user_id = ? ORDER BY created_at DESC'
    )
    .all(user.id);

  const formattedRows = rows.map((row) => ({
    ...row,
    creator_attributes: parseJsonObject(row.creator_attributes),
    desired_attributes: parseJsonObject(row.desired_attributes),
    contacts: parseJsonArray(row.contacts),
    wishmail_enabled: Boolean(row.wishmail_enabled),
    is_active: Boolean(row.is_active),
    image_id: row.image_id,
    unread_wishmail_count: Number(row.unread_wishmail_count || 0),
  }));

  res.json(formattedRows);
});

export default router;
