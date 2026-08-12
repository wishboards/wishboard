import express from 'express';
import { customAlphabet } from 'nanoid';
import db from '../db.js';
import {
  getUserFromToken,
  getTokenFromRequestHeader,
  verifyPassphrase,
  parseJsonArray,
} from '../auth.js';
import logger from '../logger.js';
import { ensureArray } from '../utils/arrays.js';

const router = express.Router({ mergeParams: true });
const idGenerator = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 8);

const getRequestUser = async (req) => {
  const token = getTokenFromRequestHeader(req);
  return await getUserFromToken(token);
};

const authorizeWishmailManagement = async (req, res, next) => {
  const { id: wish_id } = req.params;
  const secret = req.headers['x-wish-secret'] || req.body?.secret;
  const user = await getRequestUser(req);

  const wish = await db
    .prepare('SELECT user_id, secret_hash FROM wishes WHERE id = ?')
    .get(wish_id);
  if (!wish) {
    return res.status(404).json({ error: 'Wish not found.' });
  }

  let authorized = false;
  if (user && wish.user_id === user.id) {
    authorized = true;
  }

  if (!authorized && secret && wish.secret_hash) {
    const [salt, hash] = wish.secret_hash.split(':');
    if (await verifyPassphrase(secret.trim(), salt, hash)) {
      authorized = true;
    }
  }

  if (!authorized) {
    return res.status(403).json({ error: 'Not authorized to manage wishmail.' });
  }

  next();
};

// POST /api/wishes/:id/mail
// Send a wishmail
router.post('/', async (req, res) => {
  const { id: wish_id } = req.params;
  const { content, return_contacts } = req.body;
  const user = await getRequestUser(req);

  if (!content?.trim()) {
    return res.status(400).json({ error: 'Mail content is required.' });
  }

  const wish = await db
    .prepare('SELECT id, wishmail_enabled FROM wishes WHERE id = ?')
    .get(wish_id);
  if (!wish) {
    return res.status(404).json({ error: 'Wish not found.' });
  }

  if (!wish.wishmail_enabled) {
    return res.status(403).json({ error: 'Wishmail is not enabled for this wish.' });
  }

  const mailId = idGenerator();
  const now = new Date().toISOString();
  const parsedContacts = JSON.stringify(ensureArray(return_contacts));

  await db
    .prepare(
      'INSERT INTO wishmails (id, wish_id, content, return_contacts, sender_id, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .run(mailId, wish_id, content.trim(), parsedContacts, user?.id || null, now);

  logger.info('Wishmail sent', { sender_id: user?.id || null, target_wish_id: wish_id });
  res.json({ success: true, id: mailId });
});

// GET /api/wishes/:id/mail
// Get wishmails for a wish
router.get('/', authorizeWishmailManagement, async (req, res) => {
  const { id: wish_id } = req.params;

  const rows = await db
    .prepare(
      'SELECT id, content, return_contacts, sender_id, read, created_at FROM wishmails WHERE wish_id = ? ORDER BY created_at DESC'
    )
    .all(wish_id);
  res.json(
    rows.map((row) => ({
      id: row.id,
      content: row.content,
      return_contacts: parseJsonArray(row.return_contacts),
      sender_id: row.sender_id,
      read: Boolean(row.read),
      created_at: row.created_at,
    }))
  );
});

// POST /api/wishes/:id/mail/:mailId/read
// Mark wishmail as read
router.post('/:mailId/read', authorizeWishmailManagement, async (req, res) => {
  const { id: wish_id, mailId } = req.params;

  const result = await db
    .prepare('UPDATE wishmails SET read = 1 WHERE id = ? AND wish_id = ?')
    .run(mailId, wish_id);
  if (result.changes === 0) {
    return res.status(404).json({ error: 'Wishmail not found.' });
  }

  res.json({ success: true });
});

// DELETE /api/wishes/:id/mail/:mailId
// Delete a wishmail
router.delete('/:mailId', authorizeWishmailManagement, async (req, res) => {
  const { id: wish_id, mailId } = req.params;

  const result = await db
    .prepare('DELETE FROM wishmails WHERE id = ? AND wish_id = ?')
    .run(mailId, wish_id);
  if (result.changes === 0) {
    return res.status(404).json({ error: 'Wishmail not found.' });
  }

  const user = await getRequestUser(req);
  logger.info('Wishmail deleted', { user_id: user?.id || null, wish_id, mail_id: mailId });
  res.json({ success: true });
});

export default router;
