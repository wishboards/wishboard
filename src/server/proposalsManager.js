import crypto from 'node:crypto';
import { validateRuleset } from '@wishboards/matching-engine';
import db from './db.js';
import { getRules, addRule } from './rulesManager.js';
import { setProfileOverride } from './configManager.js';
import { sanitizeSvg, sanitizeStickerImageSrc } from '../shared/svgSanitizer.js';

export const VALID_PROPOSAL_TYPES = new Set(['category', 'suggestion', 'rule', 'sticker']);
export const VALID_PROPOSAL_STATUSES = new Set(['pending', 'approved', 'dismissed']);
export const DEFAULT_QUORUM_THRESHOLD = 3;

export const PII_PATTERN =
  /(@|https?:\/\/|www\.|\.(?:com|net|org)(?=$|[^a-z0-9])|(?<!\d)\d{3}[-.\s]\d{3,4}(?:[-.\s]\d{4})?(?!\d)|(?<!\w)\d{7,11}(?!\w))/i;

const DISALLOWED_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const STRIPPED_PII_PROSE_KEYS = new Set([
  'wishid',
  'wish_id',
  'userid',
  'user_id',
  'rawtext',
  'raw_text',
  'content',
  'prose',
  'secret',
  'email',
  'phone',
  'username',
  'author',
  'text',
  'body',
  'quote',
  'note',
]);

export class ProposalValidationError extends Error {
  constructor(message, { status = 400, errors = [], warnings = [] } = {}) {
    super(message);
    this.name = 'ProposalValidationError';
    this.status = status;
    this.errors = errors;
    this.warnings = warnings;
  }
}

/**
 * Normalizes a proposal key: trims, lowercases, and collapses internal whitespace.
 * @param {unknown} raw
 * @returns {string}
 */
export function normalizeProposalKey(raw) {
  if (typeof raw !== 'string') return '';
  return raw.trim().toLowerCase().replaceAll(/\s+/g, ' ');
}

function isPlainObject(val) {
  if (!val || typeof val !== 'object' || Array.isArray(val)) return false;
  const proto = Object.getPrototypeOf(val);
  return proto === Object.prototype || proto === null;
}

function sanitizeValue(val, key = '') {
  const lowerKey = typeof key === 'string' ? key.toLowerCase() : '';
  if (lowerKey === 'svg' && typeof val === 'string') {
    return sanitizeSvg(val) ?? undefined;
  }
  if (lowerKey === 'src' && typeof val === 'string') {
    return sanitizeStickerImageSrc(val) ?? undefined;
  }
  if (typeof val === 'string') {
    return PII_PATTERN.test(val) ? undefined : val;
  }
  if (Array.isArray(val)) {
    return val.map((item) => sanitizeValue(item)).filter((item) => item !== undefined);
  }
  if (isPlainObject(val)) {
    return sanitizeProposalPayload(val);
  }
  return val;
}

/**
 * Strips PII/raw-prose keys, PII-matching string values, and prototype-pollution keys
 * from a proposal payload. Exempts `svg` and `src` sticker fields from `PII_PATTERN`
 * while strictly validating them with `sanitizeSvg` / `sanitizeStickerImageSrc`.
 * Ensures the returned value is a plain object.
 *
 * @param {unknown} payload
 * @returns {Record<string, unknown>}
 */
export function sanitizeProposalPayload(payload) {
  if (!isPlainObject(payload)) {
    return {};
  }

  const sanitized = {};
  for (const key of Object.keys(payload)) {
    if (DISALLOWED_OBJECT_KEYS.has(key) || !Object.hasOwn(payload, key)) {
      continue;
    }
    if (STRIPPED_PII_PROSE_KEYS.has(key.toLowerCase())) {
      continue;
    }
    const cleanVal = sanitizeValue(payload[key], key);
    if (cleanVal !== undefined) {
      sanitized[key] = cleanVal;
    }
  }
  return sanitized;
}

function parsePayloadJson(raw) {
  if (!raw || typeof raw !== 'string') return {};
  try {
    return sanitizeProposalPayload(JSON.parse(raw));
  } catch {
    return {};
  }
}

function formatProposalRow(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    normalized_key: row.normalized_key,
    proposal_type: row.proposal_type,
    proposed_payload_json: row.proposed_payload_json,
    proposed_payload: parsePayloadJson(row.proposed_payload_json),
    occurrence_count: Number(row.occurrence_count),
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/**
 * Normalizes and upserts unmapped signals into `taxonomy_proposals`.
 * Deduplicates identical `(normalized_key, proposal_type)` within a single batch.
 * Only increments `occurrence_count` if the existing proposal is still `'pending'`.
 *
 * @param {Array<{ proposal_type: string, key: string, payload?: Record<string, unknown> }>} signals
 * @returns {Promise<number>} Number of unique valid signals harvested
 */
export async function harvestSignals(signals = []) {
  if (!Array.isArray(signals) || signals.length === 0) {
    return 0;
  }

  const seen = new Set();
  const now = new Date().toISOString();
  let harvested = 0;

  for (const signal of signals) {
    if (!signal || typeof signal !== 'object') continue;
    const proposalType =
      typeof signal.proposal_type === 'string' ? signal.proposal_type.trim().toLowerCase() : '';
    if (!VALID_PROPOSAL_TYPES.has(proposalType)) continue;

    const normalizedKey = normalizeProposalKey(signal.key);
    if (!normalizedKey || normalizedKey.length > 120 || PII_PATTERN.test(normalizedKey)) continue;

    const dedupeKey = `${proposalType}:${normalizedKey}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const sanitizedPayload = sanitizeProposalPayload(signal.payload ?? {});
    const payloadJson = JSON.stringify(sanitizedPayload);

    await db
      .prepare(
        `INSERT INTO taxonomy_proposals (
          normalized_key, proposal_type, proposed_payload_json, occurrence_count, status, created_at, updated_at
        ) VALUES (?, ?, ?, 1, 'pending', ?, ?)
        ON CONFLICT(normalized_key, proposal_type) DO UPDATE SET
          occurrence_count = CASE WHEN status = 'pending' THEN occurrence_count + 1 ELSE occurrence_count END,
          updated_at = CASE WHEN status = 'pending' THEN excluded.updated_at ELSE updated_at END`
      )
      .run(normalizedKey, proposalType, payloadJson, now, now);

    harvested += 1;
  }

  return harvested;
}

/**
 * Lists taxonomy proposals ranked by `occurrence_count DESC, updated_at DESC, id ASC`.
 * Filters by `minQuorum` unless `includeBelowQuorum` is true, and always returns `belowQuorumCount`.
 *
 * @param {Object} [options]
 * @param {'pending' | 'approved' | 'dismissed'} [options.status='pending']
 * @param {number} [options.minQuorum=3]
 * @param {boolean} [options.includeBelowQuorum=false]
 */
export async function listProposals({
  status = 'pending',
  minQuorum = DEFAULT_QUORUM_THRESHOLD,
  includeBelowQuorum = false,
} = {}) {
  const safeStatus = VALID_PROPOSAL_STATUSES.has(status) ? status : 'pending';
  const parsedMin = Number(minQuorum);
  const quorumThreshold =
    Number.isFinite(parsedMin) && parsedMin >= 1 ? Math.floor(parsedMin) : DEFAULT_QUORUM_THRESHOLD;

  const rows = await db
    .prepare(
      `SELECT id, normalized_key, proposal_type, proposed_payload_json, occurrence_count, status, created_at, updated_at
       FROM taxonomy_proposals
       WHERE status = ?
       ORDER BY occurrence_count DESC, updated_at DESC, id ASC`
    )
    .all(safeStatus);

  const allProposals = rows.map(formatProposalRow);
  const belowQuorumCount = allProposals.filter((p) => p.occurrence_count < quorumThreshold).length;

  const proposals = includeBelowQuorum
    ? allProposals
    : allProposals.filter((p) => p.occurrence_count >= quorumThreshold);

  return {
    proposals,
    quorumThreshold,
    belowQuorumCount,
  };
}

export async function getProposalById(id) {
  const numId = Number(id);
  if (!Number.isInteger(numId) || numId <= 0) return null;
  const row = await db
    .prepare(
      `SELECT id, normalized_key, proposal_type, proposed_payload_json, occurrence_count, status, created_at, updated_at
       FROM taxonomy_proposals WHERE id = ?`
    )
    .get(numId);
  return formatProposalRow(row);
}

let proposalWriteQueue = Promise.resolve();

function withProposalWriteLock(fn) {
  const run = proposalWriteQueue.then(fn, fn);
  proposalWriteQueue = run.catch(() => {});
  return run;
}

export async function updateProposalPayload(id, payload) {
  return withProposalWriteLock(async () => {
    const existing = await getProposalById(id);
    if (!existing) return null;
    if (existing.status !== 'pending') {
      throw new ProposalValidationError(`Proposal is already ${existing.status}`, { status: 409 });
    }

    const sanitized = sanitizeProposalPayload(payload);
    const now = new Date().toISOString();
    const result = await db
      .prepare(
        "UPDATE taxonomy_proposals SET proposed_payload_json = ?, updated_at = ? WHERE id = ? AND status = 'pending'"
      )
      .run(JSON.stringify(sanitized), now, existing.id);

    if (!result?.changes) {
      const latest = await getProposalById(existing.id);
      throw new ProposalValidationError(`Proposal is already ${latest?.status ?? 'processed'}`, {
        status: 409,
      });
    }

    return getProposalById(existing.id);
  });
}

export async function dismissProposal(id) {
  return withProposalWriteLock(async () => {
    const existing = await getProposalById(id);
    if (!existing) return null;
    if (existing.status !== 'pending') {
      throw new ProposalValidationError(`Proposal is already ${existing.status}`, { status: 409 });
    }

    const now = new Date().toISOString();
    const result = await db
      .prepare(
        "UPDATE taxonomy_proposals SET status = ?, updated_at = ? WHERE id = ? AND status = 'pending'"
      )
      .run('dismissed', now, existing.id);

    if (!result?.changes) {
      const latest = await getProposalById(existing.id);
      throw new ProposalValidationError(`Proposal is already ${latest?.status ?? 'processed'}`, {
        status: 409,
      });
    }

    return getProposalById(existing.id);
  });
}

async function readProfileOverrideSection(section, fallback) {
  const row = await db
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get(`profile_override:${section}`);
  if (!row?.value) return fallback;
  try {
    return JSON.parse(row.value);
  } catch {
    return fallback;
  }
}

async function promoteRuleProposal(existing, payload) {
  const candidateRule = {
    id:
      typeof payload.id === 'string' && payload.id.trim()
        ? payload.id.trim()
        : `rule_${crypto.randomUUID().slice(0, 8)}`,
    rule_type: typeof payload.rule_type === 'string' ? payload.rule_type.trim() : '',
    trigger_attribute:
      typeof payload.trigger_attribute === 'string' ? payload.trigger_attribute.trim() : '',
    trigger_value:
      typeof payload.trigger_value === 'string' && payload.trigger_value.trim()
        ? payload.trigger_value.trim()
        : existing.normalized_key,
    context_attribute:
      typeof payload.context_attribute === 'string' && payload.context_attribute.trim()
        ? payload.context_attribute.trim()
        : null,
    context_value:
      typeof payload.context_value === 'string' && payload.context_value.trim()
        ? payload.context_value.trim()
        : null,
    target_attribute:
      typeof payload.target_attribute === 'string' ? payload.target_attribute.trim() : '',
    target_value: typeof payload.target_value === 'string' ? payload.target_value.trim() : '',
  };

  const validation = validateRuleset([...getRules(), candidateRule]);
  if (!validation.valid) {
    throw new ProposalValidationError('Rule validation failed', {
      status: 422,
      errors: validation.errors,
      warnings: validation.warnings,
    });
  }

  await addRule(candidateRule);
  return {
    promoted: { type: 'rule', rule: candidateRule },
    validation,
  };
}

async function promoteCategoryProposal(existing, payload) {
  const current = await readProfileOverrideSection('categories', []);
  const overrides = Array.isArray(current) ? [...current] : [];

  const catId =
    typeof payload.id === 'string' && payload.id.trim()
      ? payload.id.trim()
      : existing.normalized_key;
  if (DISALLOWED_OBJECT_KEYS.has(catId)) {
    throw new ProposalValidationError('Invalid category id', { status: 400 });
  }

  const label =
    typeof payload.label === 'string' && payload.label.trim() ? payload.label.trim() : catId;
  const type =
    typeof payload.type === 'string' && payload.type.trim() ? payload.type.trim() : undefined;
  const suggestions = Array.isArray(payload.suggestions)
    ? payload.suggestions.filter((s) => typeof s === 'string' && s.trim()).map((s) => s.trim())
    : [];

  const nextCategory = {
    id: catId,
    label,
    ...(type ? { type } : {}),
    suggestions,
  };

  const idx = overrides.findIndex((c) => c && c.id === catId);
  if (idx >= 0) {
    overrides[idx] = nextCategory;
  } else {
    overrides.push(nextCategory);
  }

  await setProfileOverride('categories', overrides);
  return { promoted: { type: 'category', category: nextCategory } };
}

async function promoteSuggestionProposal(existing, payload) {
  const current = await readProfileOverrideSection('suggestions', {});
  const overrides = isPlainObject(current) ? { ...current } : {};

  const categoryId =
    (typeof payload.categoryId === 'string' && payload.categoryId.trim()) ||
    (typeof payload.category === 'string' && payload.category.trim()) ||
    (typeof payload.attribute === 'string' && payload.attribute.trim()) ||
    'interests';
  const term =
    (typeof payload.term === 'string' && payload.term.trim()) ||
    (typeof payload.value === 'string' && payload.value.trim()) ||
    (typeof payload.label === 'string' && payload.label.trim()) ||
    existing.normalized_key;

  if (DISALLOWED_OBJECT_KEYS.has(categoryId) || !term) {
    throw new ProposalValidationError('Invalid suggestion category or term', { status: 400 });
  }

  const existingList = Array.isArray(overrides[categoryId]) ? [...overrides[categoryId]] : [];
  if (!existingList.includes(term)) {
    existingList.push(term);
  }
  overrides[categoryId] = existingList;

  await setProfileOverride('suggestions', overrides);
  return { promoted: { type: 'suggestion', categoryId, term } };
}

async function promoteStickerProposal(existing, payload) {
  const categoryId =
    (typeof payload.categoryId === 'string' && payload.categoryId.trim()) ||
    (typeof payload.category === 'string' && payload.category.trim()) ||
    'interests';
  const term =
    (typeof payload.term === 'string' && payload.term.trim()) ||
    (typeof payload.value === 'string' && payload.value.trim()) ||
    (typeof payload.label === 'string' && payload.label.trim()) ||
    existing.normalized_key;

  if (DISALLOWED_OBJECT_KEYS.has(categoryId) || DISALLOWED_OBJECT_KEYS.has(term) || !term) {
    throw new ProposalValidationError('Invalid sticker category or term', { status: 400 });
  }

  let sanitizedSticker;
  if (payload.type === 'svg' || typeof payload.svg === 'string') {
    const cleanSvg = typeof payload.svg === 'string' ? sanitizeSvg(payload.svg) : null;
    if (!cleanSvg) {
      throw new ProposalValidationError('Invalid or unsafe SVG sticker payload', { status: 400 });
    }
    sanitizedSticker = {
      ...(typeof payload.label === 'string' && payload.label.trim()
        ? { label: payload.label.trim() }
        : {}),
      type: 'svg',
      svg: cleanSvg,
    };
  } else if (payload.type === 'image' || typeof payload.src === 'string') {
    const cleanSrc = typeof payload.src === 'string' ? sanitizeStickerImageSrc(payload.src) : null;
    if (!cleanSrc) {
      throw new ProposalValidationError('Invalid or unsafe sticker image src', { status: 400 });
    }
    sanitizedSticker = {
      ...(typeof payload.label === 'string' && payload.label.trim()
        ? { label: payload.label.trim() }
        : {}),
      type: 'image',
      src: cleanSrc,
    };
  } else {
    throw new ProposalValidationError('Sticker proposal requires a valid svg or image src', {
      status: 400,
    });
  }

  const current = await readProfileOverrideSection('stickers', {});
  const overrides = isPlainObject(current) ? { ...current } : {};
  const catMap = isPlainObject(overrides[categoryId]) ? { ...overrides[categoryId] } : {};
  catMap[term] = sanitizedSticker;
  overrides[categoryId] = catMap;

  await setProfileOverride('stickers', overrides);
  return { promoted: { type: 'sticker', categoryId, term, sticker: sanitizedSticker } };
}

/**
 * Approves a proposal and promotes it into either `rulesManager` (for `'rule'`)
 * or `configManager` DB profile overrides (for `'category' | 'suggestion' | 'sticker'`).
 *
 * @param {number|string} id
 * @param {{ payloadOverride?: Record<string, unknown>, sticker?: Record<string, unknown> }} [options]
 */
export async function approveProposal(id, { payloadOverride, sticker } = {}) {
  return withProposalWriteLock(async () => {
    const existing = await getProposalById(id);
    if (!existing) return null;
    if (existing.status !== 'pending') {
      throw new ProposalValidationError(`Proposal is already ${existing.status}`, { status: 409 });
    }

    const basePayload =
      payloadOverride !== undefined
        ? sanitizeProposalPayload(payloadOverride)
        : existing.proposed_payload;

    const cleanSticker = isPlainObject(sticker) ? sanitizeProposalPayload(sticker) : null;
    const payload =
      existing.proposal_type === 'sticker' && cleanSticker
        ? { ...basePayload, ...cleanSticker }
        : basePayload;

    let promotionResult;
    if (existing.proposal_type === 'rule') {
      promotionResult = await promoteRuleProposal(existing, payload);
    } else if (existing.proposal_type === 'category') {
      promotionResult = await promoteCategoryProposal(existing, payload);
    } else if (existing.proposal_type === 'suggestion') {
      promotionResult = await promoteSuggestionProposal(existing, payload);
    } else if (existing.proposal_type === 'sticker') {
      promotionResult = await promoteStickerProposal(existing, payload);
    } else {
      throw new ProposalValidationError(`Unsupported proposal type: ${existing.proposal_type}`, {
        status: 400,
      });
    }

    let stickerPromotion = null;
    if (existing.proposal_type !== 'sticker' && cleanSticker) {
      stickerPromotion = await promoteStickerProposal(existing, { ...payload, ...cleanSticker });
    }

    const storedPayload = stickerPromotion ? { ...payload, ...cleanSticker } : payload;

    const now = new Date().toISOString();
    const result = await db
      .prepare(
        "UPDATE taxonomy_proposals SET status = ?, proposed_payload_json = ?, updated_at = ? WHERE id = ? AND status = 'pending'"
      )
      .run('approved', JSON.stringify(storedPayload), now, existing.id);

    if (!result?.changes) {
      const latest = await getProposalById(existing.id);
      throw new ProposalValidationError(`Proposal is already ${latest?.status ?? 'processed'}`, {
        status: 409,
      });
    }

    const updated = await getProposalById(existing.id);
    return {
      proposal: updated,
      ...promotionResult,
      ...(stickerPromotion ? { sticker: stickerPromotion.promoted.sticker } : {}),
    };
  });
}

/**
 * Maps a proposal as an `expansion` alias rule in `rulesManager`, gated by `validateRuleset`.
 *
 * @param {number|string} id
 * @param {{ targetAttribute: string, targetValue: string, triggerAttribute?: string }} options
 */
export async function mapProposalAsAlias(id, { targetAttribute, targetValue, triggerAttribute }) {
  return withProposalWriteLock(async () => {
    const existing = await getProposalById(id);
    if (!existing) return null;
    if (existing.status !== 'pending') {
      throw new ProposalValidationError(`Proposal is already ${existing.status}`, { status: 409 });
    }

    const cleanTargetAttr = typeof targetAttribute === 'string' ? targetAttribute.trim() : '';
    const cleanTargetVal = typeof targetValue === 'string' ? targetValue.trim() : '';
    const cleanTriggerAttr =
      typeof triggerAttribute === 'string' && triggerAttribute.trim()
        ? triggerAttribute.trim()
        : cleanTargetAttr;

    if (!cleanTargetAttr || !cleanTargetVal || !cleanTriggerAttr) {
      throw new ProposalValidationError(
        'targetAttribute and targetValue are required to map an alias',
        { status: 400 }
      );
    }

    const aliasRule = {
      id: `rule_${crypto.randomUUID().slice(0, 8)}`,
      rule_type: 'expansion',
      trigger_attribute: cleanTriggerAttr,
      trigger_value: existing.normalized_key,
      context_attribute: null,
      context_value: null,
      target_attribute: cleanTargetAttr,
      target_value: cleanTargetVal,
    };

    const validation = validateRuleset([...getRules(), aliasRule]);
    if (!validation.valid) {
      throw new ProposalValidationError('Alias rule validation failed', {
        status: 422,
        errors: validation.errors,
        warnings: validation.warnings,
      });
    }

    await addRule(aliasRule);

    const now = new Date().toISOString();
    const result = await db
      .prepare(
        "UPDATE taxonomy_proposals SET status = ?, updated_at = ? WHERE id = ? AND status = 'pending'"
      )
      .run('approved', now, existing.id);

    if (!result?.changes) {
      const latest = await getProposalById(existing.id);
      throw new ProposalValidationError(`Proposal is already ${latest?.status ?? 'processed'}`, {
        status: 409,
      });
    }

    const updated = await getProposalById(existing.id);
    return {
      proposal: updated,
      promoted: { type: 'rule', rule: aliasRule },
      validation,
    };
  });
}
