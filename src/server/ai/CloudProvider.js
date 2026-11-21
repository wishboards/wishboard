import { InferenceProvider, EmbeddingProvider } from './interfaces.js';
import logger from '../logger.js';

/**
 * Cloud LLM inference provider for serverless deployments or systems with external API access.
 * Compatible with OpenAI and Gemini REST API formats.
 */
export class CloudInferenceProvider extends InferenceProvider {
  /**
   * @param {Object} [options]
   * @param {string} [options.apiKey]
   * @param {string} [options.apiUrl]
   * @param {string} [options.model]
   */
  constructor(options = {}) {
    super();
    this.apiKey = options.apiKey || process.env.AI_API_KEY || '';
    this.apiUrl =
      options.apiUrl || process.env.AI_API_URL || 'https://api.openai.com/v1/chat/completions';
    this.model = options.model || process.env.AI_MODEL || 'gpt-4o-mini';
    this.timeoutMs = options.timeoutMs || 10000;
  }

  isAvailable() {
    return Boolean(this.apiKey);
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
    if (!this.isAvailable()) {
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
1. "creatorAttributes": Attributes describing the person who wrote the wish.
2. "desiredAttributes": Attributes describing the person/people they are seeking to meet.

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

      const res = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          response_format: { type: 'json_object' },
          temperature: 0.2,
        }),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!res.ok) {
        const errorText = await res.text();
        logger.warn('Cloud AI inference request returned non-OK status', {
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
      const rawContent = data.choices?.[0]?.message?.content || '{}';
      const parsed = JSON.parse(rawContent);

      return {
        suggestedCreatorAttributes: parsed.suggestedCreatorAttributes || {},
        suggestedDesiredAttributes: parsed.suggestedDesiredAttributes || {},
        reasoning: parsed.reasoning || 'Extracted via cloud LLM',
      };
    } catch (err) {
      logger.warn('Cloud AI inference request failed', { error: err.message });
      return {
        suggestedCreatorAttributes: {},
        suggestedDesiredAttributes: {},
        reasoning: `Inference failed: ${err.message}`,
      };
    }
  }
}

/**
 * Cloud embedding provider using standard OpenAI/compatible embeddings endpoints.
 */
export class CloudEmbeddingProvider extends EmbeddingProvider {
  /**
   * @param {Object} [options]
   * @param {string} [options.apiKey]
   * @param {string} [options.apiUrl]
   * @param {string} [options.model]
   */
  constructor(options = {}) {
    super();
    this.apiKey = options.apiKey || process.env.AI_API_KEY || '';
    this.apiUrl =
      options.apiUrl || process.env.AI_EMBEDDING_API_URL || 'https://api.openai.com/v1/embeddings';
    this.model = options.model || process.env.AI_EMBEDDING_MODEL || 'text-embedding-3-small';
    this.timeoutMs = options.timeoutMs || 10000;
  }

  isAvailable() {
    return Boolean(this.apiKey);
  }

  async generateEmbedding(text = '') {
    if (!this.isAvailable() || !text.trim()) {
      return [];
    }

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      const res = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
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
