import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  createSalt,
  hashPassphrase,
  verifyPassphrase,
  createSessionToken,
  parseJsonArray,
  normalizeArrayInput,
  getUserFromToken,
  requireAuth,
  requireAdmin,
  getTokenFromRequestHeader,
  authorizeWishSubscription,
} from './auth.js';
import db from './db.js';

describe('Server Auth Helper Functions', () => {
  beforeEach(async () => {
    // Clear databases or wrap in transactions if necessary, but we can just use the db
  });

  describe('salt and hashing', () => {
    it('generates a valid salt and verifies hash correctly', async () => {
      const salt = createSalt();
      expect(salt).toBeDefined();
      expect(typeof salt).toBe('string');
      expect(salt.length).toBe(32);

      const passphrase = 'my-super-secret-passphrase';
      const hash = await hashPassphrase(passphrase, salt);
      expect(hash).toBeDefined();
      expect(typeof hash).toBe('string');

      expect(await verifyPassphrase(passphrase, salt, hash)).toBe(true);
      expect(await verifyPassphrase('wrong-passphrase', salt, hash)).toBe(false);
    });
  });

  describe('parseJsonArray', () => {
    it('returns empty array if no value', async () => {
      expect(parseJsonArray(null)).toEqual([]);
      expect(parseJsonArray(undefined)).toEqual([]);
    });

    it('returns empty array if parsed value is not an array', async () => {
      expect(parseJsonArray('{"a": 1}')).toEqual([]);
      expect(parseJsonArray('123')).toEqual([]);
      expect(parseJsonArray('"string"')).toEqual([]);
    });

    it('returns array if valid json array', async () => {
      expect(parseJsonArray('["man", "woman"]')).toEqual(['man', 'woman']);
    });

    it('returns empty array if invalid JSON (triggers catch block)', async () => {
      expect(parseJsonArray('[invalid-json')).toEqual([]);
    });
  });

  describe('normalizeArrayInput', () => {
    it('returns empty array if no value', async () => {
      expect(normalizeArrayInput(null)).toEqual([]);
      expect(normalizeArrayInput(undefined)).toEqual([]);
    });

    it('normalizes various array and string inputs', async () => {
      expect(normalizeArrayInput('single')).toEqual(['single']);
      expect(normalizeArrayInput(['one', 'two'])).toEqual(['one', 'two']);
      expect(normalizeArrayInput('one,two,three')).toEqual(['one', 'two', 'three']);
      expect(normalizeArrayInput(['one,two', 'three'])).toEqual(['one', 'two', 'three']);
      expect(normalizeArrayInput('  one , two  ')).toEqual(['one', 'two']);
    });
  });

  describe('await getUserFromToken and session management', () => {
    it('returns null if no token', async () => {
      expect(await getUserFromToken(null)).toBeNull();
      expect(await getUserFromToken(undefined)).toBeNull();
    });

    it('returns null if token does not exist', async () => {
      expect(await getUserFromToken('non-existent-token')).toBeNull();
    });

    it('creates a session and fetches user details successfully', async () => {
      // Create a test user in DB
      const userId = 'user-' + Math.random().toString(36).substring(2, 9);
      await db
        .prepare(
          'INSERT INTO users (id, username, passphrase_hash, passphrase_salt, role, identity_attributes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
        )
        .run(
          userId,
          `test-user-${userId}`,
          'hash',
          'salt',
          'user',
          JSON.stringify({ gender: ['woman'], orientation: ['queer'], role: ['top'] }),
          new Date().toISOString()
        );

      const token = await createSessionToken(userId);
      expect(token).toBeDefined();

      const user = await getUserFromToken(token);
      expect(user).not.toBeNull();
      expect(user.id).toBe(userId);
      expect(user.identity_attributes.gender).toEqual(['woman']);
      expect(user.identity_attributes.orientation).toEqual(['queer']);
      expect(user.identity_attributes.role).toEqual(['top']);
    });
  });

  describe('getTokenFromRequestHeader', () => {
    it('returns null if auth header is missing or incorrect format', async () => {
      expect(getTokenFromRequestHeader({ headers: {} })).toBeNull();
      expect(getTokenFromRequestHeader({ headers: { authorization: 'Basic 123' } })).toBeNull();
    });

    it('extracts token from Bearer header', async () => {
      expect(getTokenFromRequestHeader({ headers: { authorization: 'Bearer mytoken' } })).toBe(
        'mytoken'
      );
    });
  });

  describe('await requireAuth and await requireAdmin middleware', () => {
    it('await requireAuth returns 401 if user is not authenticated', async () => {
      const req = { headers: {} };
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };
      const next = vi.fn();

      await requireAuth(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Authentication required.' });
      expect(next).not.toHaveBeenCalled();
    });

    it('await requireAuth sets req.user and calls next if authenticated', async () => {
      // Create a test user in DB
      const userId = 'user-' + Math.random().toString(36).substring(2, 9);
      await db
        .prepare(
          'INSERT INTO users (id, username, passphrase_hash, passphrase_salt, role, identity_attributes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
        )
        .run(
          userId,
          `test-user-${userId}`,
          'hash',
          'salt',
          'user',
          JSON.stringify({ gender: [], orientation: [], role: [] }),
          new Date().toISOString()
        );

      const token = await createSessionToken(userId);
      const req = { headers: { authorization: `Bearer ${token}` } };
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };
      const next = vi.fn();

      await requireAuth(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(req.user).toBeDefined();
      expect(req.user.id).toBe(userId);
    });

    it('await requireAdmin returns 403 if user is not an admin', async () => {
      // Create a normal test user in DB
      const userId = 'user-' + Math.random().toString(36).substring(2, 9);
      await db
        .prepare(
          'INSERT INTO users (id, username, passphrase_hash, passphrase_salt, role, identity_attributes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
        )
        .run(
          userId,
          `normal-user-${userId}`,
          'hash',
          'salt',
          'user',
          '{"gender":[],"orientation":[],"role":[]}',
          new Date().toISOString()
        );

      const token = await createSessionToken(userId);
      const req = { headers: { authorization: `Bearer ${token}` } };
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };
      const next = vi.fn();

      await requireAdmin(req, res, next);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ error: 'Admin access required.' });
      expect(next).not.toHaveBeenCalled();
    });

    it('await requireAdmin returns 401 when there is no valid session', async () => {
      const req = { headers: {} };
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      const next = vi.fn();

      await requireAdmin(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Authentication required.' });
      expect(next).not.toHaveBeenCalled();
    });

    it('await requireAdmin sets req.user and calls next if user is an admin', async () => {
      // Create an admin test user in DB
      const userId = 'user-' + Math.random().toString(36).substring(2, 9);
      await db
        .prepare(
          'INSERT INTO users (id, username, passphrase_hash, passphrase_salt, role, identity_attributes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
        )
        .run(
          userId,
          `admin-user-${userId}`,
          'hash',
          'salt',
          'admin',
          '{"gender":[],"orientation":[],"role":[]}',
          new Date().toISOString()
        );

      // Create a session for this admin
      const token = 'test-admin-token-' + Math.random().toString(36).substring(2, 9);
      await db
        .prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)')
        .run(token, userId, new Date(Date.now() + 86400000).toISOString());

      const req = { headers: { authorization: `Bearer ${token}` } };
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };
      const next = vi.fn();

      await requireAdmin(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(req.user).toBeDefined();
      expect(req.user.id).toBe(userId);
    });
  });

  describe('authorizeWishSubscription', () => {
    it('authorizes wish owner via session token or passphrase secret and rejects non-owners', async () => {
      const ownerId = `ws-owner-${Math.random().toString(36).slice(2, 8)}`;
      const otherId = `ws-other-${Math.random().toString(36).slice(2, 8)}`;
      const now = new Date().toISOString();
      for (const uid of [ownerId, otherId]) {
        await db
          .prepare(
            'INSERT INTO users (id, username, passphrase_hash, passphrase_salt, role, created_at) VALUES (?, ?, ?, ?, ?, ?)'
          )
          .run(uid, uid, 'h', 's', 'user', now);
      }
      const ownerToken = await createSessionToken(ownerId);
      const otherToken = await createSessionToken(otherId);

      expect(await authorizeWishSubscription()).toEqual({ authorized: false, userId: null });
      expect(
        await authorizeWishSubscription({
          wishId: 'non-existent-wish',
          token: ownerToken,
          secret: 'any-secret',
        })
      ).toEqual({
        authorized: false,
        userId: null,
      });

      const salt = createSalt();
      const hash = await hashPassphrase('correct-wish-secret', salt);
      const wishId = `ws-wish-${Math.random().toString(36).slice(2, 8)}`;
      await db
        .prepare(
          'INSERT INTO wishes (id, user_id, content, secret_hash, contacts, wishmail_enabled, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
        )
        .run(wishId, ownerId, 'Test WS auth wish', `${salt}:${hash}`, '[]', 0, 1, now, now);

      const anonWishId = `ws-anon-${Math.random().toString(36).slice(2, 8)}`;
      await db
        .prepare(
          'INSERT INTO wishes (id, user_id, content, secret_hash, contacts, wishmail_enabled, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
        )
        .run(anonWishId, null, 'Anon WS wish', `${salt}:${hash}`, '[]', 0, 1, now, now);

      const noSecretWishId = `ws-nosec-${Math.random().toString(36).slice(2, 8)}`;
      await db
        .prepare(
          'INSERT INTO wishes (id, user_id, content, secret_hash, contacts, wishmail_enabled, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
        )
        .run(noSecretWishId, ownerId, 'No secret WS wish', null, '[]', 0, 1, now, now);

      // Owner token succeeds
      expect(await authorizeWishSubscription({ wishId, token: ownerToken })).toEqual({
        authorized: true,
        userId: ownerId,
      });

      // Other user token without secret fails
      expect(await authorizeWishSubscription({ wishId, token: otherToken })).toEqual({
        authorized: false,
        userId: null,
      });

      // Valid passphrase secret succeeds on both owned and anonymous wishes
      expect(await authorizeWishSubscription({ wishId, secret: 'correct-wish-secret' })).toEqual({
        authorized: true,
        userId: ownerId,
      });
      expect(
        await authorizeWishSubscription({ wishId: anonWishId, secret: 'correct-wish-secret' })
      ).toEqual({
        authorized: true,
        userId: null,
      });

      // Wrong passphrase secret or secret on a wish with null secret_hash fails
      expect(await authorizeWishSubscription({ wishId, secret: 'wrong-secret' })).toEqual({
        authorized: false,
        userId: null,
      });
      expect(
        await authorizeWishSubscription({ wishId: noSecretWishId, secret: 'correct-wish-secret' })
      ).toEqual({
        authorized: false,
        userId: null,
      });
    });
  });
});
