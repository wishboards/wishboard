import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  InferenceProvider,
  EmbeddingProvider,
  NoopInferenceProvider,
  NoopEmbeddingProvider,
  LocalInferenceProvider,
  LocalEmbeddingProvider,
  CloudInferenceProvider,
  CloudEmbeddingProvider,
  cosineSimilarity,
  rankWishesBySimilarity,
  isAiEnabled,
  getInferenceProvider,
  getEmbeddingProvider,
  setInferenceProvider,
  setEmbeddingProvider,
  resetProviders,
} from './index.js';
import { queueWishForTagging, drainQueue } from './taggingWorker.js';
import db from '../db.js';
import {
  resolveAiApiKey,
  resetCachedSsmApiKey,
  GEMINI_OPENAI_BASE_URL,
  OPENAI_BASE_URL,
  DEFAULT_GEMINI_MODEL,
  DEFAULT_GEMINI_EMBEDDING_MODEL,
  DEFAULT_OPENAI_EMBEDDING_MODEL,
  isGeminiModel,
} from './CloudProvider.js';

vi.mock('@aws-sdk/client-ssm', () => {
  class MockSSMClient {
    async send(command) {
      if (command?.name === 'fail') {
        throw new Error('SSM Access Denied');
      }
      return {
        Parameter: { Value: 'mocked-ssm-api-key\n' },
      };
    }
  }

  class MockGetParameterCommand {
    constructor(input) {
      this.name = input?.Name?.includes('fail') ? 'fail' : 'ok';
      Object.assign(this, input);
    }
  }

  return {
    SSMClient: MockSSMClient,
    GetParameterCommand: MockGetParameterCommand,
  };
});

describe('AI Module', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    resetProviders();
    resetCachedSsmApiKey();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    resetProviders();
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  describe('Abstract Interfaces', () => {
    it('InferenceProvider throws on suggestAttributes and defaults isAvailable to false', async () => {
      const provider = new InferenceProvider();
      expect(provider.isAvailable()).toBe(false);
      await expect(provider.suggestAttributes({})).rejects.toThrow(
        'suggestAttributes must be implemented by subclass'
      );
    });

    it('EmbeddingProvider throws on generateEmbedding and defaults isAvailable to false', async () => {
      const provider = new EmbeddingProvider();
      expect(provider.isAvailable()).toBe(false);
      await expect(provider.generateEmbedding('test')).rejects.toThrow(
        'generateEmbedding must be implemented by subclass'
      );
    });
  });

  describe('NoopProvider', () => {
    it('NoopInferenceProvider returns empty attributes and is not available', async () => {
      const provider = new NoopInferenceProvider();
      expect(provider.isAvailable()).toBe(false);
      const res = await provider.suggestAttributes();
      expect(res.suggestedCreatorAttributes).toEqual({});
      expect(res.suggestedDesiredAttributes).toEqual({});
      expect(res.reasoning).toContain('Noop');
    });

    it('NoopEmbeddingProvider returns empty array and is not available', async () => {
      const provider = new NoopEmbeddingProvider();
      expect(provider.isAvailable()).toBe(false);
      const res = await provider.generateEmbedding('test');
      expect(res).toEqual([]);
    });
  });

  describe('LocalProvider', () => {
    const sampleTaxonomy = [
      { id: 'genders', label: 'Gender', suggestions: ['woman', 'man', 'nonbinary'] },
      { id: 'roles', label: 'Role', suggestions: ['switch', 'top', 'bottom'] },
      { id: 'orientations', label: 'Orientation', suggestions: ['queer', 'lesbian', 'pansexual'] },
    ];

    it('LocalInferenceProvider extracts creator and desired attributes based on context', async () => {
      const provider = new LocalInferenceProvider();
      expect(provider.isAvailable()).toBe(true);

      const res = await provider.suggestAttributes({
        content: 'I am a switch woman looking for a top nonbinary',
        taxonomy: sampleTaxonomy,
      });

      expect(res.suggestedCreatorAttributes.roles).toContain('switch');
      expect(res.suggestedCreatorAttributes.genders).toContain('woman');
      expect(res.suggestedDesiredAttributes.roles).toContain('top');
      expect(res.suggestedDesiredAttributes.genders).toContain('nonbinary');
      expect(res.reasoning).toContain('matched taxonomy keywords');
    });

    it('LocalInferenceProvider deduplicates against existing attributes', async () => {
      const provider = new LocalInferenceProvider();
      const res = await provider.suggestAttributes({
        content: 'I am a switch woman seeking a top woman',
        existingCreatorAttributes: { roles: ['switch'], genders: ['woman'] },
        existingDesiredAttributes: { roles: ['top'] },
        taxonomy: sampleTaxonomy,
      });

      // switch and woman already in creator, top already in desired
      expect(res.suggestedCreatorAttributes.roles).toBeUndefined();
      expect(res.suggestedCreatorAttributes.genders).toBeUndefined();
      expect(res.suggestedDesiredAttributes.roles).toBeUndefined();
      expect(res.suggestedDesiredAttributes.genders).toContain('woman');
    });

    it('LocalInferenceProvider handles empty or non-matching content', async () => {
      const provider = new LocalInferenceProvider({ enabled: false });
      expect(provider.isAvailable()).toBe(false);

      const res = await provider.suggestAttributes({
        content: 'Just having coffee at the main lobby.',
        taxonomy: sampleTaxonomy,
      });
      expect(res.suggestedCreatorAttributes).toEqual({});
      expect(res.suggestedDesiredAttributes).toEqual({});
      expect(res.reasoning).toContain('No taxonomy terms');
    });

    it('LocalEmbeddingProvider generates normalized deterministic vectors', async () => {
      const provider = new LocalEmbeddingProvider({ dimensions: 32 });
      expect(provider.isAvailable()).toBe(true);

      const vEmpty = await provider.generateEmbedding('');
      expect(vEmpty).toHaveLength(32);
      expect(vEmpty.every((val) => val === 0)).toBe(true);

      const v1 = await provider.generateEmbedding('Board games on Saturday evening');
      expect(v1).toHaveLength(32);

      // Verify unit normalization
      const norm = Math.hypot(...v1);
      expect(norm).toBeCloseTo(1.0, 2);

      // Determinism
      const v2 = await provider.generateEmbedding('Board games on Saturday evening');
      expect(v1).toEqual(v2);

      // Different text has different vector
      const v3 = await provider.generateEmbedding('Rock climbing Sunday morning');
      expect(v1).not.toEqual(v3);
    });
  });

  describe('CloudProvider', () => {
    it('resolveAiApiKey resolves explicit key, env key, SSM key, and caches', async () => {
      // 1. Explicit key
      expect(await resolveAiApiKey('explicit-key')).toBe('explicit-key');

      // 2. AI_API_KEY environment variable
      process.env.AI_API_KEY = 'env-api-key';
      expect(await resolveAiApiKey()).toBe('env-api-key');
      delete process.env.AI_API_KEY;

      // 3. AWS SSM parameter
      process.env.AI_API_KEY_SSM = '/wishboard/ai/gemini-api-key';
      const keyFromSsm = await resolveAiApiKey();
      expect(keyFromSsm).toBe('mocked-ssm-api-key');

      // 4. Cached SSM key (even if SSM env var is deleted)
      delete process.env.AI_API_KEY_SSM;
      expect(await resolveAiApiKey()).toBe('mocked-ssm-api-key');

      // 5. SSM failure handles gracefully
      resetCachedSsmApiKey();
      process.env.AI_API_KEY_SSM = '/wishboard/ai/fail';
      expect(await resolveAiApiKey()).toBe('');
    });

    it('auto-routes Gemini and OpenAI endpoints and respects explicit URL/endpoint overrides', () => {
      expect(isGeminiModel('gemini-flash-latest')).toBe(true);
      expect(isGeminiModel('  GEMINI-3.8-flash ')).toBe(true);
      expect(isGeminiModel('gpt-4o-mini')).toBe(false);
      expect(isGeminiModel()).toBe(false);

      // Default routes to Google Gemini OpenAI-compatible endpoints
      delete process.env.AI_MODEL;
      delete process.env.AI_EMBEDDING_MODEL;
      delete process.env.AI_API_URL;
      delete process.env.AI_EMBEDDING_API_URL;
      delete process.env.AI_API_ENDPOINT;

      const defaultInf = new CloudInferenceProvider({ apiKey: 'k' });
      expect(defaultInf.model).toBe(DEFAULT_GEMINI_MODEL);
      expect(defaultInf.apiUrl).toBe(`${GEMINI_OPENAI_BASE_URL}/chat/completions`);

      const defaultEmb = new CloudEmbeddingProvider({ apiKey: 'k' });
      expect(defaultEmb.model).toBe(DEFAULT_GEMINI_EMBEDDING_MODEL);
      expect(defaultEmb.apiUrl).toBe(`${GEMINI_OPENAI_BASE_URL}/embeddings`);

      // Switching AI_MODEL to an OpenAI model auto-routes both chat and embeddings to OpenAI
      process.env.AI_MODEL = 'gpt-4o-mini';
      const openaiInf = new CloudInferenceProvider({ apiKey: 'k' });
      expect(openaiInf.apiUrl).toBe(`${OPENAI_BASE_URL}/chat/completions`);

      const openaiEmb = new CloudEmbeddingProvider({ apiKey: 'k' });
      expect(openaiEmb.model).toBe(DEFAULT_OPENAI_EMBEDDING_MODEL);
      expect(openaiEmb.apiUrl).toBe(`${OPENAI_BASE_URL}/embeddings`);

      // Explicit AI_EMBEDDING_MODEL overrides inference model family for embedding endpoint
      const explicitGeminiEmb = new CloudEmbeddingProvider({
        apiKey: 'k',
        model: 'gemini-embedding-001',
      });
      expect(explicitGeminiEmb.apiUrl).toBe(`${GEMINI_OPENAI_BASE_URL}/embeddings`);

      // AI_API_ENDPOINT trims trailing slashes and appends endpoint path
      process.env.AI_API_ENDPOINT = 'https://proxy.example.com/v1///';
      expect(new CloudInferenceProvider({ apiKey: 'k' }).apiUrl).toBe(
        'https://proxy.example.com/v1/chat/completions'
      );
      expect(new CloudEmbeddingProvider({ apiKey: 'k' }).apiUrl).toBe(
        'https://proxy.example.com/v1/embeddings'
      );

      // Explicit AI_API_URL / AI_EMBEDDING_API_URL win over AI_API_ENDPOINT
      process.env.AI_API_URL = 'https://custom.example.com/chat';
      process.env.AI_EMBEDDING_API_URL = 'https://custom.example.com/embed';
      expect(new CloudInferenceProvider({ apiKey: 'k' }).apiUrl).toBe(
        'https://custom.example.com/chat'
      );
      expect(new CloudEmbeddingProvider({ apiKey: 'k' }).apiUrl).toBe(
        'https://custom.example.com/embed'
      );
    });

    it('CloudInferenceProvider strips markdown JSON code fences from LLM responses', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content:
                  '```json\n{"suggestedCreatorAttributes":{"roles":["switch"]},"suggestedDesiredAttributes":{},"reasoning":"Fenced response"}\n```',
              },
            },
          ],
        }),
      });

      const provider = new CloudInferenceProvider({ apiKey: 'test-key' });
      const res = await provider.suggestAttributes({ content: 'Switch looking for friends' });
      expect(res.suggestedCreatorAttributes).toEqual({ roles: ['switch'] });
      expect(res.reasoning).toBe('Fenced response');
    });

    it('CloudInferenceProvider degrades gracefully when API key is missing', async () => {
      const provider = new CloudInferenceProvider({ apiKey: '' });
      expect(provider.isAvailable()).toBe(false);

      const res = await provider.suggestAttributes({ content: 'Hello' });
      expect(res.suggestedCreatorAttributes).toEqual({});
      expect(res.reasoning).toContain('not configured');
    });

    it('CloudInferenceProvider calls LLM endpoint and parses response', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  suggestedCreatorAttributes: { roles: ['switch'] },
                  suggestedDesiredAttributes: { roles: ['top'] },
                  reasoning: 'Parsed from user intro',
                }),
              },
            },
          ],
        }),
      });
      globalThis.fetch = mockFetch;

      const provider = new CloudInferenceProvider({ apiKey: 'test-key' });
      expect(provider.isAvailable()).toBe(true);

      const res = await provider.suggestAttributes({
        content: 'Switch looking for top',
        taxonomy: [{ id: 'roles', label: 'Role', suggestions: ['switch', 'top'] }],
      });

      expect(mockFetch).toHaveBeenCalledOnce();
      expect(res.suggestedCreatorAttributes).toEqual({ roles: ['switch'] });
      expect(res.suggestedDesiredAttributes).toEqual({ roles: ['top'] });
      expect(res.reasoning).toBe('Parsed from user intro');
    });

    it('CloudInferenceProvider handles non-200 and errors', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        text: async () => 'Rate limit exceeded',
      });

      const provider = new CloudInferenceProvider({ apiKey: 'test-key' });
      const res = await provider.suggestAttributes({ content: 'Hello' });
      expect(res.suggestedCreatorAttributes).toEqual({});
      expect(res.reasoning).toContain('HTTP 429');

      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network timeout'));
      const resErr = await provider.suggestAttributes({ content: 'Hello' });
      expect(resErr.reasoning).toContain('Inference failed: Network timeout');
    });

    it('CloudEmbeddingProvider calls embeddings endpoint and handles failures', async () => {
      const provider = new CloudEmbeddingProvider({ apiKey: 'test-key' });
      expect(provider.isAvailable()).toBe(true);

      // Empty text returns empty array
      const emptyRes = await provider.generateEmbedding('');
      expect(emptyRes).toEqual([]);

      // Mock success
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [{ embedding: [0.1, 0.2, 0.3] }],
        }),
      });

      const emb = await provider.generateEmbedding('Sample wish');
      expect(emb).toEqual([0.1, 0.2, 0.3]);

      // Mock error
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
      });
      const failEmb = await provider.generateEmbedding('Sample wish');
      expect(failEmb).toEqual([]);
    });
  });

  describe('Vector Search & Similarity', () => {
    it('cosineSimilarity computes expected values', () => {
      expect(cosineSimilarity([], [])).toBe(0);
      expect(cosineSimilarity([1, 0], [1])).toBe(0);

      // Identical
      expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1.0);
      expect(cosineSimilarity([0, 2], [0, 5])).toBeCloseTo(1.0);

      // Orthogonal
      expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0.0);

      // Opposite
      expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1.0);

      // Zero norm
      expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
    });

    it('rankWishesBySimilarity ranks and filters candidates', () => {
      const query = [1, 0, 0];
      const candidates = [
        { wish_id: 'w1', embedding: [0.9, 0.1, 0] },
        { wish_id: 'w2', embedding: JSON.stringify([0.1, 0.9, 0]) },
        { wish_id: 'w3', embedding: [-1, 0, 0] },
        { wish_id: 'w4', embedding: 'invalid-json' },
      ];

      const ranked = rankWishesBySimilarity(query, candidates, { minScore: 0.2, limit: 10 });
      expect(ranked).toHaveLength(1);
      expect(ranked[0].wish_id).toBe('w1');
      expect(ranked[0].score).toBeGreaterThan(0.9);

      // Check empty inputs
      expect(rankWishesBySimilarity([], candidates)).toEqual([]);
      expect(rankWishesBySimilarity(query, null)).toEqual([]);
    });
  });

  describe('Factory and Configuration', () => {
    it('respects ENABLE_AI_FEATURES flag', () => {
      process.env.ENABLE_AI_FEATURES = 'false';
      expect(isAiEnabled()).toBe(false);
      expect(getInferenceProvider()).toBeInstanceOf(NoopInferenceProvider);
      expect(getEmbeddingProvider()).toBeInstanceOf(NoopEmbeddingProvider);

      process.env.ENABLE_AI_FEATURES = 'true';
      expect(isAiEnabled()).toBe(true);
    });

    it('resolves LocalProvider when AI_PROVIDER is local', () => {
      process.env.ENABLE_AI_FEATURES = 'true';
      process.env.AI_PROVIDER = 'local';
      expect(getInferenceProvider()).toBeInstanceOf(LocalInferenceProvider);
      expect(getEmbeddingProvider()).toBeInstanceOf(LocalEmbeddingProvider);
    });

    it('resolves CloudProvider when AI_PROVIDER is cloud', () => {
      process.env.ENABLE_AI_FEATURES = 'true';
      process.env.AI_PROVIDER = 'cloud';
      expect(getInferenceProvider()).toBeInstanceOf(CloudInferenceProvider);
      expect(getEmbeddingProvider()).toBeInstanceOf(CloudEmbeddingProvider);
    });

    it('allows custom overrides', () => {
      const customInf = new NoopInferenceProvider();
      const customEmb = new NoopEmbeddingProvider();
      setInferenceProvider(customInf);
      setEmbeddingProvider(customEmb);

      expect(getInferenceProvider()).toBe(customInf);
      expect(getEmbeddingProvider()).toBe(customEmb);

      resetProviders();
      expect(getInferenceProvider()).not.toBe(customInf);
    });
  });

  describe('Tagging Worker', () => {
    it('skips invalid input', () => {
      queueWishForTagging({ wishId: '', content: '' });
      queueWishForTagging({ wishId: 'w1', content: '   ' });
    });

    it('processes wish tagging job when AI is enabled and stores suggestions and embeddings', async () => {
      process.env.ENABLE_AI_FEATURES = 'true';
      process.env.AI_PROVIDER = 'local';

      // Insert test wish in DB so foreign key constraints or queries succeed
      const testWishId = 'test-ai-worker-wish-1';
      await db
        .prepare(
          'INSERT OR REPLACE INTO wishes (id, content, contacts, wishmail_enabled, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
        )
        .run(
          testWishId,
          'I am a switch woman seeking a top nonbinary partner',
          '[]',
          0,
          1,
          new Date().toISOString(),
          new Date().toISOString()
        );

      queueWishForTagging({
        wishId: testWishId,
        content: 'I am a switch woman seeking a top nonbinary partner',
      });

      await drainQueue();

      const suggestion = await db
        .prepare('SELECT * FROM wish_ai_suggestions WHERE wish_id = ?')
        .get(testWishId);
      expect(suggestion).toBeDefined();
      expect(suggestion.status).toBe('pending');
      const creatorAttrs = JSON.parse(suggestion.suggested_creator_attributes);
      expect(
        creatorAttrs.role || creatorAttrs.gender || creatorAttrs.roles || creatorAttrs.genders
      ).toBeDefined();

      const embeddingRow = await db
        .prepare('SELECT * FROM wish_embeddings WHERE wish_id = ?')
        .get(testWishId);
      expect(embeddingRow).toBeDefined();
      const emb = JSON.parse(embeddingRow.embedding);
      expect(emb).toHaveLength(64);

      // Cleanup
      await db.prepare('DELETE FROM wish_ai_suggestions WHERE wish_id = ?').run(testWishId);
      await db.prepare('DELETE FROM wish_embeddings WHERE wish_id = ?').run(testWishId);
      await db.prepare('DELETE FROM wishes WHERE id = ?').run(testWishId);
    });
  });
});
