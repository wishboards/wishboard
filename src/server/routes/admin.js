import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import db from '../db.js';
import { requireAdmin } from '../auth.js';
import { generateDemoData } from '../demoSeeder.js';
import logger from '../logger.js';
import { emitWishDeleted } from '../socket.js';
import { getEventProfile } from '../configManager.js';
import { reloadRules } from '../rulesManager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// Admin responses reflect live, privileged state — never let a browser or proxy
// cache them (e.g. serving a stale 403 after a session is fixed, or stale data
// after a mutation). CloudFront already bypasses /api/*, this covers the rest.
router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

const checkResult = (result, res, entityName) => {
  if (result.changes === 0) {
    return res.status(404).json({ error: `${entityName} not found.` });
  }
  res.json({ success: true });
};

router.get('/flags', requireAdmin, async (req, res) => {
  const rows = await db
    .prepare(
      'SELECT id, content, flagged, created_at, user_id FROM wishes WHERE flagged > 0 ORDER BY flagged DESC'
    )
    .all();
  res.json(rows);
});

router.post('/wishes/:id/remove', requireAdmin, async (req, res) => {
  const result = await db.prepare('DELETE FROM wishes WHERE id = ?').run(req.params.id);
  logger.info('Admin removed wish', { admin_user_id: req.user.id, wish_id: req.params.id });
  if (result.changes > 0) {
    emitWishDeleted(req.params.id);
  }
  checkResult(result, res, 'Wish');
});

router.post('/wishes/:id/clear-flag', requireAdmin, async (req, res) => {
  const result = await db.prepare('UPDATE wishes SET flagged = 0 WHERE id = ?').run(req.params.id);
  logger.info('Admin cleared flag for wish', {
    admin_user_id: req.user.id,
    wish_id: req.params.id,
  });
  checkResult(result, res, 'Wish');
});

router.post('/wishes/clear-all-flags', requireAdmin, async (req, res) => {
  await db.prepare('UPDATE wishes SET flagged = 0').run();
  logger.info('Admin cleared all flags', { admin_user_id: req.user.id });
  res.json({ success: true });
});

router.post('/users/:username/reset-password', requireAdmin, async (req, res, next) => {
  try {
    const { username } = req.params;
    let passphrase = req.body?.passphrase;

    const user = await db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }
    const id = user.id;

    if (!passphrase) {
      const { generatePassphrase } = await import('../../client/src/passphrase.js');
      passphrase = generatePassphrase();
    }

    const { createSalt, hashPassphrase } = await import('../auth.js');
    const salt = createSalt();
    const hash = await hashPassphrase(passphrase, salt);

    await db
      .prepare('UPDATE users SET passphrase_hash = ?, passphrase_salt = ? WHERE id = ?')
      .run(hash, salt, id);
    await db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);

    logger.info('Admin reset user passphrase', { admin_user_id: req.user.id, target_user_id: id });
    res.json({ success: true, new_passphrase: passphrase });
  } catch (error) {
    next(error);
  }
});

router.get('/users', requireAdmin, async (req, res) => {
  const users = await db
    .prepare('SELECT id, username, role, created_at FROM users ORDER BY created_at DESC')
    .all();
  res.json(users);
});

router.post('/users/:id/role', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { role } = req.body;
  if (!role || !['user', 'admin'].includes(role)) {
    return res.status(400).json({ error: 'Role must be user or admin.' });
  }

  const result = await db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id);
  logger.info('Admin updated user role', {
    admin_user_id: req.user.id,
    target_user_id: id,
    new_role: role,
  });
  checkResult(result, res, 'User');
});

router.get('/users/:id/delete-preview', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const wishesCount = (
    await db.prepare('SELECT COUNT(*) as count FROM wishes WHERE user_id = ?').get(id)
  ).count;
  const wishmailsCount = (
    await db
      .prepare(
        'SELECT COUNT(*) as count FROM wishmails WHERE wish_id IN (SELECT id FROM wishes WHERE user_id = ?)'
      )
      .get(id)
  ).count;
  res.json({ wishesCount, wishmailsCount });
});

router.post('/users/:id/delete', requireAdmin, async (req, res) => {
  const { id } = req.params;

  // Never delete the account you're signed in as: it also deletes your own
  // session below, orphaning your token — you'd keep seeing the admin UI while
  // every request 401s. Delete a different admin, or use the self-service
  // account-deletion flow (which guards against removing the last admin).
  if (id === req.user.id) {
    return res.status(409).json({ error: "You can't delete the account you're signed in as." });
  }

  await db
    .prepare('DELETE FROM wishmails WHERE wish_id IN (SELECT id FROM wishes WHERE user_id = ?)')
    .run(id);
  await db.prepare('DELETE FROM wishes WHERE user_id = ?').run(id);
  await db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  const result = await db.prepare('DELETE FROM users WHERE id = ?').run(id);
  logger.info('Admin deleted user', { admin_user_id: req.user.id, target_user_id: id });
  checkResult(result, res, 'User');
});

// POST /api/admin/reset-demo
// Protected by await requireAdmin so only the 'admin' account can trigger it
router.post('/reset-demo', requireAdmin, async (req, res) => {
  if (
    process.env.NODE_ENV === 'production' &&
    req.query.force !== 'true' &&
    req.body?.force !== true
  ) {
    return res.status(403).json({
      error: 'Demo reset is disabled in production unless force is explicitly requested.',
    });
  }

  try {
    const stats = await generateDemoData();
    res.status(200).json({
      message: 'Demo environment successfully seeded.',
      stats,
    });
  } catch (error) {
    console.error('Failed to seed demo data:', error);
    res.status(500).json({ error: 'Internal Server Error during seeding' });
  }
});

// POST /api/admin/reset-rules
// Clears and re-seeds the matching rules table with bundled defaults.
// Protected by requireAdmin; force-gated in production to prevent accidental resets.
router.post('/reset-rules', requireAdmin, async (req, res) => {
  if (
    process.env.NODE_ENV === 'production' &&
    req.query.force !== 'true' &&
    req.body?.force !== true
  ) {
    return res.status(403).json({
      error: 'Matching rules reset is disabled in production unless force is explicitly requested.',
    });
  }

  try {
    // Clear existing rules
    await db.prepare('DELETE FROM rules').run();

    // Re-seed default rules from profile
    const profileRules = getEventProfile().rules;
    const mapArg = (a) => {
      if (a === undefined) return null;
      if (typeof a === 'boolean') return a ? 1 : 0;
      return a;
    };

    const stmts = profileRules.map((rule) => ({
      sql: `INSERT INTO rules (id, rule_type, trigger_attribute, trigger_value, context_attribute, context_value, target_attribute, target_value)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        rule.id,
        rule.rule_type,
        rule.trigger_attribute,
        rule.trigger_value,
        rule.context_attribute,
        rule.context_value,
        rule.target_attribute,
        rule.target_value,
      ].map(mapArg),
    }));

    const BATCH_SIZE = 1000;
    for (let i = 0; i < stmts.length; i += BATCH_SIZE) {
      const batch = stmts.slice(i, i + BATCH_SIZE);
      await db.batch(batch, 'write');
    }

    // Synchronize the memory cache
    await reloadRules();

    logger.info('Admin reset matching rules to defaults', {
      admin_user_id: req.user.id,
      rules_count: profileRules.length,
    });
    res.status(200).json({
      message: 'Matching rules successfully reset to defaults.',
      rules_count: profileRules.length,
    });
  } catch (error) {
    logger.error('Failed to reset rules:', { error: error.message, admin_user_id: req.user.id });
    res.status(500).json({ error: 'Internal Server Error during rules reset' });
  }
});

// GET /api/admin/logs
router.get('/logs', requireAdmin, async (req, res) => {
  // Prevent CloudFront and browsers from caching log responses
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.set('Pragma', 'no-cache');
  const isLambda = !!process.env.AWS_LAMBDA_FUNCTION_NAME;

  // In serverless mode, pull recent logs from CloudWatch Logs
  if (isLambda) {
    try {
      const { CloudWatchLogsClient, FilterLogEventsCommand } =
        await import('@aws-sdk/client-cloudwatch-logs');
      const region = process.env.AWS_REGION || 'us-east-1';
      const client = new CloudWatchLogsClient({ region });
      const apiLogGroupName = `/aws/lambda/${process.env.AWS_LAMBDA_FUNCTION_NAME}`;
      const wsFunctionName = process.env.AWS_LAMBDA_FUNCTION_NAME.replace(
        /-express-api$/,
        '-websocket-mgr'
      );
      const wsLogGroupName = `/aws/lambda/${wsFunctionName}`;
      const startTime = Date.now() - 60 * 60 * 1000; // last hour

      // Helper to fetch logs for a specific log group
      const fetchGroupLogs = async (logGroupName) => {
        const command = new FilterLogEventsCommand({
          logGroupName,
          startTime,
          limit: 300,
        });
        const response = await client.send(command);
        return response.events ?? [];
      };

      // Fetch both in parallel
      const [apiEvents, wsEvents] = await Promise.all([
        fetchGroupLogs(apiLogGroupName).catch((err) => {
          logger.error(`Error querying log group ${apiLogGroupName}:`, { error: err.message });
          return [];
        }),
        fetchGroupLogs(wsLogGroupName).catch((err) => {
          logger.error(`Error querying log group ${wsLogGroupName}:`, { error: err.message });
          return [];
        }),
      ]);

      // Tag and combine events
      const taggedEvents = [
        ...apiEvents.map((e) => ({ ...e, group: 'api' })),
        ...wsEvents.map((e) => ({ ...e, group: 'ws' })),
      ];

      // Sort chronologically
      taggedEvents.sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));

      // Limit combined output
      const finalEvents = taggedEvents.slice(-500);

      // Strip Lambda START/END/REPORT lines; keep application log lines only
      const lines = finalEvents
        .map((e) => {
          const prefix = e.group === 'ws' ? '[WS] ' : '';
          return prefix + e.message?.trim();
        })
        .filter(
          (m) => m && !m.startsWith('START ') && !m.startsWith('END ') && !m.startsWith('REPORT ')
        )
        .join('\n');

      return res.json({
        logs: lines || 'No log entries found in the last hour.',
        source: 'cloudwatch',
        fetchedAt: new Date().toISOString(),
      });
    } catch (error) {
      logger.error('Failed to read CloudWatch logs:', { error: error.message });
      return res.status(500).json({ error: `Failed to read CloudWatch logs: ${error.message}` });
    }
  }

  // Local mode: read from filesystem log files
  const logsDir = path.join(__dirname, '../../../data/logs');
  try {
    if (!fs.existsSync(logsDir)) {
      return res.json({ logs: 'Logs directory not found.' });
    }
    const files = fs.readdirSync(logsDir).filter((f) => f.endsWith('.log'));
    if (!files.length) {
      return res.json({ logs: 'No logs found.' });
    }

    files.sort(
      (a, b) =>
        fs.statSync(path.join(logsDir, b)).mtimeMs - fs.statSync(path.join(logsDir, a)).mtimeMs
    );
    const newestFile = files[0];

    const content = fs.readFileSync(path.join(logsDir, newestFile), 'utf-8');
    const rawLines = content.split('\n').filter(Boolean);
    const formattedLines = rawLines.map((line) => {
      try {
        const parsed = JSON.parse(line);
        const { timestamp, level, message, ...meta } = parsed;
        const metaStr = Object.keys(meta).length ? ' ' + JSON.stringify(meta) : '';
        return `[${timestamp || ''}] ${level || ''}: ${message || ''}${metaStr}`;
      } catch {
        return line;
      }
    });

    const lastLines = formattedLines.slice(-500).join('\n');
    res.json({ logs: lastLines, fetchedAt: new Date().toISOString() });
  } catch (error) {
    console.error('Failed to read logs:', error);
    res.status(500).json({ error: 'Failed to read logs' });
  }
});

router.get('/config', requireAdmin, async (req, res) => {
  const config = getEventProfile();
  res.json({
    isProduction: process.env.NODE_ENV === 'production',
    hasDemoSeeds: config.demo_seeds != null,
  });
});

export default router;
