import { promisify } from 'node:util';
import crypto from 'node:crypto';
import db from './db.js';
import { ensureArray } from './utils/arrays.js';

const TOKEN_EXPIRY_MS = 1000 * 60 * 60 * 24 * 7;

const getTokenFromRequest = (req) => {
  const authHeader = req.headers?.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return null;
  }
  return authHeader.slice(7).trim();
};

export const createSalt = () => crypto.randomBytes(16).toString('hex');

const scryptOptions = process.env.NODE_ENV === 'test' ? { N: 16, r: 1, p: 1 } : undefined;

const scrypt = promisify(crypto.scrypt);

export const hashPassphrase = async (passphrase, salt) => {
  const derivedKey = await scrypt(passphrase, salt, 64, scryptOptions);
  return derivedKey.toString('hex');
};

export const verifyPassphrase = async (passphrase, salt, hash) => {
  const computedHash = await hashPassphrase(passphrase, salt);
  return computedHash === hash;
};

export const createSessionToken = async (userId) => {
  const token = crypto.randomBytes(24).toString('hex');
  const expiresAt = new Date(Date.now() + TOKEN_EXPIRY_MS).toISOString();
  await db
    .prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)')
    .run(token, userId, expiresAt);
  return token;
};

export const parseJsonArray = (value) => {
  if (!value) {
    return [];
  }
  try {
    const parsed = JSON.parse(value);
    return ensureArray(parsed);
  } catch {
    return [];
  }
};

export const normalizeArrayInput = (value) => {
  if (!value) {
    return [];
  }
  const array = Array.isArray(value) ? value : [value];
  return array
    .flatMap((item) => String(item).split(','))
    .map((item) => item.trim())
    .filter(Boolean);
};

export const parseJsonObject = (value) => {
  if (!value) {
    return {};
  }
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

export const getUserFromToken = async (token) => {
  if (!token) {
    return null;
  }
  const row = await db
    .prepare(
      'SELECT u.id, u.username, u.role, u.is_active, u.contacts, u.wishmail_enabled, u.identity_attributes FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.expires_at > ?'
    )
    .get(token, new Date().toISOString());
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    is_active: Boolean(row.is_active),
    contacts: parseJsonArray(row.contacts),
    wishmail_enabled: Boolean(row.wishmail_enabled),
    identity_attributes: parseJsonObject(row.identity_attributes),
  };
};

export const getUserFromRequest = async (req) => await getUserFromToken(getTokenFromRequest(req));

export const requireAuth = async (req, res, next) => {
  const user = await getUserFromRequest(req);
  if (!user) {
    return res.status(401).json({ error: 'Authentication required.' });
  }
  req.user = user;
  next();
};

export const requireAdmin = async (req, res, next) => {
  const user = await getUserFromRequest(req);
  // Distinguish "no valid session" (401) from "authenticated but not admin"
  // (403). Collapsing both into 403 hid expired/orphaned tokens from the client,
  // which then couldn't tell "log back in" from "you're not allowed".
  if (!user) {
    return res.status(401).json({ error: 'Authentication required.' });
  }
  if (user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required.' });
  }
  req.user = user;
  next();
};

export const getTokenFromRequestHeader = getTokenFromRequest;
