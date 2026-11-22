import { InferenceProvider, EmbeddingProvider } from './interfaces.js';
import logger from '../logger.js';

let cachedSsmApiKey = null;

export function resetCachedSsmApiKey() {
  cachedSsmApiKey = null;
}

/**
 * Resolves the AI API key with priority:
 * 1. Explicitly passed key
 * 2. Environment variable AI_API_KEY
 * 3. In-memory cached SSM key
 * 4. AWS SSM Parameter Store if AI_API_KEY_SSM is set
 */
export async function resolveAiApiKey(explicitKey = '') {
  if (explicitKey) return explicitKey;
  if (process.env.AI_API_KEY) return process.env.AI_API_KEY;
  if (cachedSsmApiKey) return cachedSsmApiKey;
  if (process.env.AI_API_KEY_SSM) {
    try {
      const { SSMClient, GetParameterCommand } = await import('@aws-sdk/client-ssm');
      const ssmClient = new SSMClient({ region: process.env.AWS_REGION || 'us-east-1' });
      const res = await ssmClient.send(
        new GetParameterCommand({ Name: process.env.AI_API_KEY_SSM, WithDecryption: true })
      );
      cachedSsmApiKey = res.Parameter?.Value?.trim() || '';
      return cachedSsmApiKey;
    } catch (err) {
      logger.error('Failed to retrieve AI API key from AWS SSM', {
        parameter: process.env.AI_API_KEY_SSM,
        error: err.message,
      });
    }
  }
  return '';
}

export const GEMINI_OPENAI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai';
export const OPENAI_BASE_URL = 'https://api.openai.com/v1';
export const DEFAULT_GEMINI_MODEL = 'gemini-flash-latest';
export const DEFAULT_GEMINI_EMBEDDING_MODEL = 'gemini-embedding-001';
export const DEFAULT_OPENAI_EMBEDDING_MODEL = 'text-embedding-3-small';

export function isGeminiModel(model = '') {
  return typeof model === 'string' && model.trim().toLowerCase().startsWith('gemini');
}

function resolveCloudUrl({ explicitUrl, apiEndpoint, pathSuffix, useGemini }) {
  if (explicitUrl) return explicitUrl;
  if (apiEndpoint) {
    return `${apiEndpoint.replace(/\/+$/, '')}${pathSuffix}`;
  }
  const base = useGemini ? GEMINI_OPENAI_BASE_URL : OPENAI_BASE_URL;
  return `${base}${pathSuffix}`;
}

function stripJsonCodeFences(raw = '') {
  const trimmed = raw.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return fenced ? fenced[1].trim() : trimmed;
}

/**
 * Cloud LLM inference provider for serverless deployments or systems with external API access.
 * Compatible with Gemini (OpenAI-compatible endpoint) and OpenAI REST API formats.
 */
export class CloudInferenceProvider extends InferenceProvider {
  /**
   * @param {Object} [options]
   * @param {string} [options.apiKey]
   * @param {string} [options.apiUrl]
   * @param {string} [options.apiEndpoint]
   * @param {string} [options.model]
   */
  constructor(options = {}) {
    super();
    this.apiKey = options.apiKey || process.env.AI_API_KEY || '';
    this.model = options.model || process.env.AI_MODEL || DEFAULT_GEMINI_MODEL;
    this.apiUrl = resolveCloudUrl({
      explicitUrl: options.apiUrl || process.env.AI_API_URL || '',
      apiEndpoint: options.apiEndpoint || process.env.AI_API_ENDPOINT || '',
      pathSuffix: '/chat/completions',
      useGemini: isGeminiModel(this.model),
    });
    this.timeoutMs = options.timeoutMs || 20000;
  }

  isAvailable() {
    return Boolean(
      this.apiKey || process.env.AI_API_KEY || process.env.AI_API_KEY_SSM || cachedSsmApiKey
    );
  }

  /**
   * Sends prompt to LLM endpoint requesting structured attribute extraction.
   */
  async suggestAttributes({
    content = '',
    existingCreatorAttributes = {},
    existingDesiredAttributes = {},
    taxonomy = [],
  }) {
    const key = await resolveAiApiKey(this.apiKey);
    if (!key) {
      return {
        suggestedCreatorAttributes: {},
        suggestedDesiredAttributes: {},
        reasoning: 'Cloud inference API key not configured',
      };
    }

    const taxonomyDescription = taxonomy
      .map((cat) => `- ${cat.label} (${cat.id}): ${cat.suggestions?.join(', ')}`)
      .join('\n');

    const systemPrompt = `You are an AI assistant for a convention wishboard matching system.
Your job is to analyze wish content and suggest relevant attributes for:
1. "suggestedCreatorAttributes": Attributes describing the person who wrote the wish.
2. "suggestedDesiredAttributes": Attributes describing the person/people they are seeking to meet.

Allowed Categories and Taxonomy:
${taxonomyDescription}

Only suggest attributes that match or closely align with the provided taxonomy.
Do not duplicate existing attributes.
Return ONLY valid JSON with this exact schema:
{
  "suggestedCreatorAttributes": { "category_id": ["Term"] },
  "suggestedDesiredAttributes": { "category_id": ["Term"] },
  "reasoning": "brief explanation"
}`;

    const userPrompt = `Wish Content: "${content}"
Existing Creator Attributes: ${JSON.stringify(existingCreatorAttributes)}
Existing Desired Attributes: ${JSON.stringify(existingDesiredAttributes)}`;

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      const requestBody = {
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.2,
      };
      if (isGeminiModel(this.model)) {
        requestBody.reasoning_effort = 'low';
      }

      const res = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!res.ok) {
        const errorText = await res.text();
        logger.warn('Cloud AI inference request returned non-OK status', {
          model: this.model,
          apiUrl: this.apiUrl,
          status: res.status,
          error: errorText,
        });
        return {
          suggestedCreatorAttributes: {},
          suggestedDesiredAttributes: {},
          reasoning: `Cloud AI error: HTTP ${res.status}`,
        };
      }

      const data = await res.json();
      const firstChoice = data.choices?.[0];
      const rawContent = firstChoice?.message?.content || '';
      if (!rawContent) {
        logger.warn('Cloud AI inference returned empty content', {
          model: this.model,
          finishReason: firstChoice?.finish_reason ?? null,
        });
        return {
          suggestedCreatorAttributes: {},
          suggestedDesiredAttributes: {},
          reasoning: `Cloud AI returned empty content (finish_reason: ${firstChoice?.finish_reason ?? 'unknown'})`,
        };
      }

      const parsed = JSON.parse(stripJsonCodeFences(rawContent));

      return {
        suggestedCreatorAttributes:
          parsed.suggestedCreatorAttributes || parsed.creatorAttributes || {},
        suggestedDesiredAttributes:
          parsed.suggestedDesiredAttributes || parsed.desiredAttributes || {},
        reasoning: parsed.reasoning || 'Extracted via cloud LLM',
      };
    } catch (err) {
      logger.warn('Cloud AI inference request failed', {
        model: this.model,
        apiUrl: this.apiUrl,
        error: err.message,
      });
      return {
        suggestedCreatorAttributes: {},
        suggestedDesiredAttributes: {},
        reasoning: `Inference failed: ${err.message}`,
      };
    }
  }
}

/**
 * Cloud embedding provider using Gemini (OpenAI-compatible) or OpenAI embeddings endpoints.
 */
export class CloudEmbeddingProvider extends EmbeddingProvider {
  /**
   * @param {Object} [options]
   * @param {string} [options.apiKey]
   * @param {string} [options.apiUrl]
   * @param {string} [options.apiEndpoint]
   * @param {string} [options.model]
   */
  constructor(options = {}) {
    super();
    this.apiKey = options.apiKey || process.env.AI_API_KEY || '';
    const explicitModel = options.model || process.env.AI_EMBEDDING_MODEL || '';
    const useGemini = explicitModel
      ? isGeminiModel(explicitModel)
      : isGeminiModel(process.env.AI_MODEL || DEFAULT_GEMINI_MODEL);
    this.model =
      explicitModel ||
      (useGemini ? DEFAULT_GEMINI_EMBEDDING_MODEL : DEFAULT_OPENAI_EMBEDDING_MODEL);
    this.apiUrl = resolveCloudUrl({
      explicitUrl: options.apiUrl || process.env.AI_EMBEDDING_API_URL || '',
      apiEndpoint: options.apiEndpoint || process.env.AI_API_ENDPOINT || '',
      pathSuffix: '/embeddings',
      useGemini,
    });
    this.timeoutMs = options.timeoutMs || 10000;
  }

  isAvailable() {
    return Boolean(
      this.apiKey || process.env.AI_API_KEY || process.env.AI_API_KEY_SSM || cachedSsmApiKey
    );
  }

  async generateEmbedding(text = '') {
    const key = await resolveAiApiKey(this.apiKey);
    if (!key || !text.trim()) {
      return [];
    }

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      const res = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model: this.model,
          input: text.trim(),
        }),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!res.ok) {
        logger.warn('Cloud AI embedding request returned non-OK status', { status: res.status });
        return [];
      }

      const data = await res.json();
      return data.data?.[0]?.embedding || [];
    } catch (err) {
      logger.warn('Cloud AI embedding request failed', { error: err.message });
      return [];
    }
  }
}
