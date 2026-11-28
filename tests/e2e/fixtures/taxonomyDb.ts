import path from 'node:path';
import { createClient, type Client } from '@libsql/client';

export type ProposalType = 'category' | 'suggestion' | 'rule' | 'sticker';
export type ProposalStatus = 'pending' | 'approved' | 'dismissed';

export interface SeedProposalInput {
  proposal_type: ProposalType;
  normalized_key: string;
  proposed_payload?: Record<string, unknown>;
  occurrence_count?: number;
  status?: ProposalStatus;
}

export interface HarvestSignalInput {
  proposal_type: ProposalType;
  key: string;
  payload?: Record<string, unknown>;
  occurrence_count?: number;
}

export interface TaxonomyProposalRow {
  id: number;
  normalized_key: string;
  proposal_type: ProposalType;
  proposed_payload_json: string;
  proposed_payload: Record<string, unknown>;
  occurrence_count: number;
  status: ProposalStatus;
  created_at: string;
  updated_at: string;
}

const VALID_PROPOSAL_TYPES = new Set<ProposalType>(['category', 'suggestion', 'rule', 'sticker']);

let client: Client | null = null;

function getE2eDbClient(): Client {
  if (!client) {
    const dbPath = process.env.WISHBOARD_DB_PATH || path.resolve(process.cwd(), 'data/e2e-test.db');
    const url =
      process.env.DATABASE_URL || (dbPath === ':memory:' ? 'file::memory:' : `file:${dbPath}`);
    client = createClient({ url });
  }
  return client;
}

export function normalizeProposalKey(raw: string): string {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-+|-+$/g, '');
}

function parseRow(row: Record<string, unknown>): TaxonomyProposalRow {
  const json = String(row.proposed_payload_json ?? '{}');
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(json) as Record<string, unknown>;
  } catch {
    parsed = {};
  }
  return {
    id: Number(row.id),
    normalized_key: String(row.normalized_key),
    proposal_type: String(row.proposal_type) as ProposalType,
    proposed_payload_json: json,
    proposed_payload: parsed,
    occurrence_count: Number(row.occurrence_count),
    status: String(row.status) as ProposalStatus,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

export async function seedProposal(input: SeedProposalInput): Promise<TaxonomyProposalRow> {
  if (!VALID_PROPOSAL_TYPES.has(input.proposal_type)) {
    throw new Error(`Invalid proposal_type: ${input.proposal_type}`);
  }
  const normalizedKey = normalizeProposalKey(input.normalized_key);
  if (!normalizedKey) {
    throw new Error(`Invalid normalized_key: ${input.normalized_key}`);
  }

  const db = getE2eDbClient();
  const count = Math.max(1, Math.floor(input.occurrence_count ?? 1));
  const status: ProposalStatus = input.status ?? 'pending';
  const payloadJson = JSON.stringify(input.proposed_payload ?? {});
  const now = new Date().toISOString();

  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      await db.execute('PRAGMA busy_timeout = 10000');
      await db.execute({
        sql: `INSERT INTO taxonomy_proposals (
          normalized_key, proposal_type, proposed_payload_json, occurrence_count, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(normalized_key, proposal_type) DO UPDATE SET
          proposed_payload_json = excluded.proposed_payload_json,
          occurrence_count = CASE
            WHEN taxonomy_proposals.status = 'pending' THEN taxonomy_proposals.occurrence_count + excluded.occurrence_count
            ELSE excluded.occurrence_count
          END,
          status = excluded.status,
          updated_at = excluded.updated_at`,
        args: [normalizedKey, input.proposal_type, payloadJson, count, status, now, now],
      });
      const res = await db.execute({
        sql: `SELECT id, normalized_key, proposal_type, proposed_payload_json, occurrence_count, status, created_at, updated_at
              FROM taxonomy_proposals
              WHERE normalized_key = ? AND proposal_type = ?`,
        args: [normalizedKey, input.proposal_type],
      });
      return parseRow(res.rows[0] as Record<string, unknown>);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes('SQLITE_BUSY') || attempt === 11) {
        throw err;
      }
      await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
    }
  }
  throw new Error('Unreachable: seedProposal retry loop exhausted');
}

export async function harvestTestSignals(
  signals: HarvestSignalInput[]
): Promise<TaxonomyProposalRow[]> {
  const results: TaxonomyProposalRow[] = [];
  for (const sig of signals) {
    const row = await seedProposal({
      proposal_type: sig.proposal_type,
      normalized_key: sig.key,
      proposed_payload: sig.payload ?? {},
      occurrence_count: sig.occurrence_count ?? 1,
    });
    results.push(row);
  }
  return results;
}

export async function getProposalById(id: number | string): Promise<TaxonomyProposalRow | null> {
  const db = getE2eDbClient();
  await db.execute('PRAGMA busy_timeout = 5000');
  const res = await db.execute({
    sql: `SELECT id, normalized_key, proposal_type, proposed_payload_json, occurrence_count, status, created_at, updated_at
          FROM taxonomy_proposals WHERE id = ?`,
    args: [Number(id)],
  });
  if (res.rows.length === 0) return null;
  return parseRow(res.rows[0] as Record<string, unknown>);
}

export async function getProposalByKey(
  key: string,
  proposalType?: ProposalType
): Promise<TaxonomyProposalRow | null> {
  const db = getE2eDbClient();
  await db.execute('PRAGMA busy_timeout = 5000');
  const normalizedKey = normalizeProposalKey(key);
  const res = proposalType
    ? await db.execute({
        sql: `SELECT id, normalized_key, proposal_type, proposed_payload_json, occurrence_count, status, created_at, updated_at
              FROM taxonomy_proposals WHERE normalized_key = ? AND proposal_type = ?`,
        args: [normalizedKey, proposalType],
      })
    : await db.execute({
        sql: `SELECT id, normalized_key, proposal_type, proposed_payload_json, occurrence_count, status, created_at, updated_at
              FROM taxonomy_proposals WHERE normalized_key = ? ORDER BY id DESC LIMIT 1`,
        args: [normalizedKey],
      });
  if (res.rows.length === 0) return null;
  return parseRow(res.rows[0] as Record<string, unknown>);
}

export async function listProposalsFromDb(): Promise<TaxonomyProposalRow[]> {
  const db = getE2eDbClient();
  await db.execute('PRAGMA busy_timeout = 5000');
  const res = await db.execute(
    `SELECT id, normalized_key, proposal_type, proposed_payload_json, occurrence_count, status, created_at, updated_at
     FROM taxonomy_proposals ORDER BY occurrence_count DESC, updated_at DESC, id ASC`
  );
  return res.rows.map((r) => parseRow(r as Record<string, unknown>));
}

export async function clearProposals(normalizedKeys?: string[]): Promise<void> {
  const db = getE2eDbClient();
  await db.execute('PRAGMA busy_timeout = 5000');
  if (!normalizedKeys || normalizedKeys.length === 0) {
    await db.execute('DELETE FROM taxonomy_proposals');
    return;
  }
  const normalized = normalizedKeys.map(normalizeProposalKey).filter(Boolean);
  if (normalized.length === 0) return;
  const placeholders = normalized.map(() => '?').join(', ');
  await db.execute({
    sql: `DELETE FROM taxonomy_proposals WHERE normalized_key IN (${placeholders})`,
    args: normalized,
  });
}
