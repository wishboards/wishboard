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

let cachedAdminToken: string | null = null;

function getE2eBaseUrl(): string {
  const port = process.env.PORT || '3000';
  return process.env.PLAYWRIGHT_BASE_URL || `http://127.0.0.1:${port}`;
}

async function getAdminToken(forceRefresh = false): Promise<string> {
  if (cachedAdminToken && !forceRefresh) {
    return cachedAdminToken;
  }
  const passphrase = process.env.WISHBOARD_ADMIN_SECRET || 'e2e-admin-password'; // gitleaks:allow
  const res = await fetch(`${getE2eBaseUrl()}/api/users/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', passphrase }),
  });
  if (!res.ok) {
    throw new Error(`taxonomyDb admin login failed (${res.status}): ${await res.text()}`);
  }
  const data = (await res.json()) as { token?: string };
  if (!data.token) {
    throw new Error('taxonomyDb admin login returned no token');
  }
  cachedAdminToken = data.token;
  return cachedAdminToken;
}

export async function seedProposal(input: SeedProposalInput): Promise<TaxonomyProposalRow> {
  if (!VALID_PROPOSAL_TYPES.has(input.proposal_type)) {
    throw new Error(`Invalid proposal_type: ${input.proposal_type}`);
  }
  const normalizedKey = normalizeProposalKey(input.normalized_key);
  if (!normalizedKey) {
    throw new Error(`Invalid normalized_key: ${input.normalized_key}`);
  }

  const body = JSON.stringify({
    proposal_type: input.proposal_type,
    normalized_key: normalizedKey,
    proposed_payload: input.proposed_payload ?? {},
    occurrence_count: Math.max(1, Math.floor(input.occurrence_count ?? 1)),
    status: input.status ?? 'pending',
  });

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const token = await getAdminToken(attempt > 0);
    const res = await fetch(`${getE2eBaseUrl()}/api/admin/proposals/test-seed`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body,
    });
    if (res.ok) {
      const data = (await res.json()) as { proposal: TaxonomyProposalRow };
      return data.proposal;
    }
    if (res.status === 401 || res.status === 403 || res.status === 429 || res.status >= 500) {
      cachedAdminToken = null;
      await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
      continue;
    }
    throw new Error(`seedProposal failed (${res.status}): ${await res.text()}`);
  }
  throw new Error('seedProposal failed after retries');
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
  const token = await getAdminToken();
  const res = await fetch(`${getE2eBaseUrl()}/api/admin/proposals/test-seed`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ normalizedKeys: normalizedKeys ?? [] }),
  });
  if (!res.ok) {
    throw new Error(`clearProposals failed (${res.status}): ${await res.text()}`);
  }
}
