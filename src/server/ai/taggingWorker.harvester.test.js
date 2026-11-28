/** @vitest-environment node */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import db from '../db.js';
import { processWishJob } from './taggingWorker.js';
import { LocalInferenceProvider } from './LocalProvider.js';
import { CloudInferenceProvider } from './CloudProvider.js';
import * as proposalsManager from '../proposalsManager.js';
import * as socketModule from '../socket.js';

describe('Runtime Gap Harvester (taggingWorker + LocalProvider + CloudProvider)', () => {
  const originalEnv = { ...process.env };

  beforeEach(async () => {
    process.env.ENABLE_AI_FEATURES = 'true';
    process.env.AI_PROVIDER = 'local';
    await db.execute('DELETE FROM taxonomy_proposals');
    await db.execute('DELETE FROM wish_ai_suggestions');
    await db.execute('DELETE FROM wish_embeddings');
    await db.execute('DELETE FROM wishes');
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it('LocalInferenceProvider emits normalized, PII-free unmappedSignals capped at 10', async () => {
    const provider = new LocalInferenceProvider();
    const res = await provider.suggestAttributes({
      content:
        'Looking for fire-play and wax-play partners! Contact me at test@example.com or 555-1234.',
      taxonomy: [{ id: 'interests', label: 'Interests', suggestions: ['bondage'] }],
    });

    expect(Array.isArray(res.unmappedSignals)).toBe(true);
    const keys = res.unmappedSignals.map((s) => s.key);
    expect(keys).toContain('fire-play');
    expect(keys).toContain('wax-play');
    expect(keys.some((k) => k.includes('@') || k.includes('555'))).toBe(false);
    expect(res.unmappedSignals.length).toBeLessThanOrEqual(10);
  });

  it('CloudInferenceProvider parses and sanitizes unmappedSignals from LLM JSON', async () => {
    process.env.AI_API_KEY = 'test-key';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                suggestedCreatorAttributes: { role: ['switch'] },
                suggestedDesiredAttributes: {},
                suggestedContent: null,
                unmappedSignals: [
                  {
                    proposal_type: 'suggestion',
                    key: '  Primal   Play ',
                    payload: {
                      categoryId: 'interests',
                      rawText: 'must be stripped',
                      userId: 'u-1',
                      quote: 'some quote',
                      contactUrl: 'https://example.com',
                    },
                  },
                  {
                    proposal_type: 'suggestion',
                    key: 'user@example.com',
                    payload: { categoryId: 'interests' },
                  },
                  {
                    proposal_type: 'suggestion',
                    key: '555-867-5309',
                    payload: { categoryId: 'interests' },
                  },
                ],
                reasoning: 'Extracted role and unmapped term',
              }),
            },
          },
        ],
      }),
    });

    const provider = new CloudInferenceProvider({ apiKey: 'test-key' });
    const res = await provider.suggestAttributes({
      content: 'I am a switch into primal play',
      taxonomy: [{ id: 'role', label: 'Role', suggestions: ['switch'] }],
    });

    expect(res.unmappedSignals).toEqual([
      {
        proposal_type: 'suggestion',
        key: 'primal play',
        payload: { categoryId: 'interests' },
      },
    ]);
  });

  it('harvests unmappedSignals during processWishJob while keeping wish_ai_suggestions and socket notifications intact', async () => {
    const now = new Date().toISOString();
    await db
      .prepare('INSERT INTO wishes (id, content, created_at, updated_at) VALUES (?, ?, ?, ?)')
      .run('wish-harv-1', 'Looking for fire-play and bondage tonight', now, now);

    const emitSpy = vi.spyOn(socketModule, 'emitAiSuggestionsReady').mockImplementation(() => {});

    await processWishJob({
      wishId: 'wish-harv-1',
      content: 'Looking for fire-play and bondage tonight',
    });

    const suggRows = await db
      .prepare('SELECT * FROM wish_ai_suggestions WHERE wish_id = ?')
      .all('wish-harv-1');
    expect(suggRows).toHaveLength(1);
    expect(emitSpy).toHaveBeenCalledTimes(1);
    expect(emitSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        wish_id: 'wish-harv-1',
        suggestion_id: suggRows[0].id,
      })
    );

    const { proposals } = await proposalsManager.listProposals({ includeBelowQuorum: true });
    expect(proposals.some((p) => p.normalized_key === 'fire-play')).toBe(true);
  });

  it('does not fail wish tagging when harvestSignals throws', async () => {
    const now = new Date().toISOString();
    await db
      .prepare('INSERT INTO wishes (id, content, created_at, updated_at) VALUES (?, ?, ?, ?)')
      .run('wish-harv-2', 'Looking for fire-play and bondage tonight', now, now);

    vi.spyOn(proposalsManager, 'harvestSignals').mockRejectedValue(new Error('DB write error'));
    const emitSpy = vi.spyOn(socketModule, 'emitAiSuggestionsReady').mockImplementation(() => {});

    await processWishJob({
      wishId: 'wish-harv-2',
      content: 'Looking for fire-play and bondage tonight',
    });

    const suggRows = await db
      .prepare('SELECT * FROM wish_ai_suggestions WHERE wish_id = ?')
      .all('wish-harv-2');
    expect(suggRows).toHaveLength(1);
    expect(emitSpy).toHaveBeenCalledTimes(1);
  });

  it('skips tagging when AI is disabled and handles empty content job gracefully', async () => {
    process.env.ENABLE_AI_FEATURES = 'false';
    const emitSpy = vi.spyOn(socketModule, 'emitAiSuggestionsReady').mockImplementation(() => {});

    await processWishJob({
      wishId: 'wish-disabled-1',
      content: 'Looking for fire-play',
    });

    expect(emitSpy).not.toHaveBeenCalled();
    const suggRows = await db
      .prepare('SELECT * FROM wish_ai_suggestions WHERE wish_id = ?')
      .all('wish-disabled-1');
    expect(suggRows).toHaveLength(0);

    process.env.ENABLE_AI_FEATURES = 'true';
    await expect(
      processWishJob({ wishId: 'wish-disabled-1', content: '   ', skipInference: true })
    ).resolves.toBeUndefined();
  });
});
