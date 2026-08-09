import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import db from './db.js';
import logger from './logger.js';
import { getDomainConfig } from './configManager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDir = path.resolve(__dirname, '../../data');

// Rules now live in the DB (a `rules` table) on every target — Pi embedded libSQL
// and serverless Turso alike — so they persist across restarts/cold starts and are
// shared across Lambda instances. See docs/adr/0002 and #188. An in-memory cache
// keeps getRules() synchronous for the matching engine; writes go through to the DB.
const RULE_COLUMNS = [
  'id',
  'rule_type',
  'trigger_attribute',
  'trigger_value',
  'context_attribute',
  'context_value',
  'target_attribute',
  'target_value',
];

let rulesCache = [];

const rowToRule = (row) => ({
  id: row.id,
  rule_type: row.rule_type,
  trigger_attribute: row.trigger_attribute,
  trigger_value: row.trigger_value,
  context_attribute: row.context_attribute ?? null,
  context_value: row.context_value ?? null,
  target_attribute: row.target_attribute,
  target_value: row.target_value,
});

const buildInsertRuleQuery = (rule) => ({
  sql: `INSERT INTO rules (${RULE_COLUMNS.join(', ')}) VALUES (${RULE_COLUMNS.map(() => '?').join(
    ', '
  )})`,
  args: RULE_COLUMNS.map((c) => rule[c] ?? null),
});

const insertRule = (rule) => db.execute(buildInsertRuleQuery(rule));

const updateRuleRow = (rule) => {
  const setCols = RULE_COLUMNS.filter((c) => c !== 'id');
  return db.execute({
    sql: `UPDATE rules SET ${setCols.map((c) => c + ' = ?').join(', ')} WHERE id = ?`,
    args: [...setCols.map((c) => rule[c] ?? null), rule.id],
  });
};

// A warm Lambda instance lives across many invocations, during which an admin on
// another instance may change the rules. Serve the cache synchronously, but kick a
// background reload once it's older than this TTL, so changes propagate across
// instances within ~TTL without a per-request DB read. See #188.
const CACHE_TTL_MS = Number(process.env.RULES_CACHE_TTL_MS ?? 60_000);
let lastLoadedAt = 0;
let reloadInFlight = null;

/** Rehydrate the in-memory cache from the DB so getRules() can stay synchronous. */
export const reloadRules = async () => {
  const rs = await db.execute('SELECT * FROM rules');
  rulesCache = rs.rows.map(rowToRule);
  lastLoadedAt = Date.now();
  logger.debug(`Loaded ${rulesCache.length} rules from the database`);
  return rulesCache;
};

const maybeRefreshCache = () => {
  if (reloadInFlight || Date.now() - lastLoadedAt < CACHE_TTL_MS) return;
  // Fire-and-forget: serve the slightly-stale cache now, fresh on a later call.
  reloadInFlight = reloadRules().finally(() => {
    reloadInFlight = null;
  });
};

/**
 * A pre-#188 single-node (Pi) deployment persisted its rules in a rules.yaml file
 * — at RULES_PATH if set, otherwise in the data dir (its Docker `/app/data` volume).
 * Return those rules so the first DB boot migrates them once, preserving any admin
 * customizations. null when no such file exists (fresh deploy, or serverless where
 * RULES_PATH points at an empty /tmp), in which case the bundled defaults seed.
 */
const loadLegacyYamlRules = () => {
  const legacyPath = process.env.RULES_PATH || path.join(dataDir, 'rules.yaml');
  if (!fs.existsSync(legacyPath)) return null;
  try {
    const parsed = YAML.parse(fs.readFileSync(legacyPath, 'utf8'));
    return Array.isArray(parsed?.rules) && parsed.rules.length > 0 ? parsed.rules : null;
  } catch (err) {
    logger.warn(`Could not read legacy rules file for migration: ${err.message}`);
    return null;
  }
};

/** First-boot seed: migrate a legacy rules.yaml if present, otherwise the bundled defaults. */
export const seedIfEmpty = async () => {
  const rs = await db.execute('SELECT COUNT(*) AS n FROM rules');
  if (Number(rs.rows[0].n) > 0) return;

  const legacy = loadLegacyYamlRules();
  const seed = legacy ?? getDomainConfig().rules;
  const source = legacy ? 'legacy rules.yaml' : 'bundled defaults';

  const stmts = seed.map(buildInsertRuleQuery);

  const BATCH_SIZE = 1000;
  for (let i = 0; i < stmts.length; i += BATCH_SIZE) {
    const batch = stmts.slice(i, i + BATCH_SIZE);
    await db.batch(batch, 'write');
  }

  logger.info(`Seeded ${seed.length} rules into the database from ${source}`);
};

await seedIfEmpty();
await reloadRules();

export const getRules = () => {
  maybeRefreshCache();
  return rulesCache;
};

export const addRule = async (rule) => {
  await insertRule(rule);
  rulesCache.push(rule);
  return rule;
};

export const updateRule = async (id, updatedRule) => {
  const index = rulesCache.findIndex((r) => r.id === id);
  if (index === -1) return false;

  const merged = { ...rulesCache[index], ...updatedRule, id };
  await updateRuleRow(merged);
  rulesCache[index] = merged;
  return true;
};

export const deleteRule = async (id) => {
  const index = rulesCache.findIndex((r) => r.id === id);
  if (index === -1) return false;

  await db.execute({ sql: 'DELETE FROM rules WHERE id = ?', args: [id] });
  rulesCache.splice(index, 1);
  return true;
};

/** No-op retained for API compatibility — the file watcher is gone with the DB migration. */
export const stopWatchingRules = () => {};
