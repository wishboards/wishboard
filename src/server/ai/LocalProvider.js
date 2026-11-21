import { InferenceProvider, EmbeddingProvider } from './interfaces.js';

/**
 * Lightweight, zero-dependency local inference provider suitable for edge
 * hardware (Raspberry Pi 4) and offline convention environments.
 */
export class LocalInferenceProvider extends InferenceProvider {
  /**
   * @param {Object} [options]
   * @param {boolean} [options.enabled=true]
   */
  constructor(options = {}) {
    super();
    this.enabled = options.enabled ?? true;
  }

  isAvailable() {
    return this.enabled;
  }

  /**
   * Analyzes content against taxonomy suggestions and contextual polarity.
   *
   * @param {Object} params
   * @param {string} params.content
   * @param {Record<string, string[]>} [params.existingCreatorAttributes]
   * @param {Record<string, string[]>} [params.existingDesiredAttributes]
   * @param {Array<{ id: string, label: string, suggestions: string[] }>} [params.taxonomy]
   */
  async suggestAttributes({
    content = '',
    existingCreatorAttributes = {},
    existingDesiredAttributes = {},
    taxonomy = [],
  }) {
    const text = content.toLowerCase();
    const suggestedCreator = {};
    const suggestedDesired = {};
    const matchedTerms = [];

    // Simple context splitting heuristics
    const seekingIndicators = ['looking for', 'seeking', 'want', 'interested in', 'iso', 'desired'];
    const selfIndicators = ['i am', "i'm", 'myself', 'as a'];

    const hasSeekingContext = seekingIndicators.some((indicator) => text.includes(indicator));
    const hasSelfContext = selfIndicators.some((indicator) => text.includes(indicator));

    for (const category of taxonomy) {
      const catId = category.id;
      const suggestions = category.suggestions || [];

      for (const term of suggestions) {
        const termLower = term.toLowerCase();
        const matches = [...text.matchAll(new RegExp(`\\b${escapeRegExp(termLower)}\\b`, 'gi'))];
        if (matches.length > 0) {
          matchedTerms.push(term);

          for (const match of matches) {
            const termIdx = match.index ?? 0;
            let assignedToDesired = false;

            for (const ind of seekingIndicators) {
              const indIdx = text.indexOf(ind);
              if (indIdx !== -1 && indIdx < termIdx) {
                assignedToDesired = true;
                break;
              }
            }

            if (assignedToDesired || (hasSeekingContext && !hasSelfContext)) {
              const existing = existingDesiredAttributes[catId] || [];
              if (!existing.some((e) => e.toLowerCase() === termLower)) {
                suggestedDesired[catId] = suggestedDesired[catId] || [];
                if (!suggestedDesired[catId].includes(term)) {
                  suggestedDesired[catId].push(term);
                }
              }
            } else {
              const existing = existingCreatorAttributes[catId] || [];
              if (!existing.some((e) => e.toLowerCase() === termLower)) {
                suggestedCreator[catId] = suggestedCreator[catId] || [];
                if (!suggestedCreator[catId].includes(term)) {
                  suggestedCreator[catId].push(term);
                }
              }
            }
          }
        }
      }
    }

    return {
      suggestedCreatorAttributes: suggestedCreator,
      suggestedDesiredAttributes: suggestedDesired,
      reasoning:
        matchedTerms.length > 0
          ? `Local inference matched taxonomy keywords: ${matchedTerms.join(', ')}`
          : 'No taxonomy terms identified in wish text',
    };
  }
}

/**
 * Deterministic local feature-hashing embedding provider.
 * Generates unit-normalized vectors of dimension N without external libraries or network calls.
 */
export class LocalEmbeddingProvider extends EmbeddingProvider {
  /**
   * @param {Object} [options]
   * @param {number} [options.dimensions=64]
   * @param {boolean} [options.enabled=true]
   */
  constructor(options = {}) {
    super();
    this.dimensions = options.dimensions || 64;
    this.enabled = options.enabled ?? true;
  }

  isAvailable() {
    return this.enabled;
  }

  /**
   * Generates a normalized feature vector using hashing trick over character 3-grams and tokens.
   *
   * @param {string} text
   * @returns {Promise<number[]>}
   */
  async generateEmbedding(text = '') {
    const vector = new Array(this.dimensions).fill(0);
    const cleaned = text.toLowerCase().trim();
    if (!cleaned) return vector;

    // Tokens
    const tokens = cleaned.split(/\s+/);
    for (const token of tokens) {
      const idx = Math.abs(hashString(token)) % this.dimensions;
      vector[idx] += 1.0;
    }

    // 3-grams for substring / typo tolerance
    for (let i = 0; i <= cleaned.length - 3; i++) {
      const gram = cleaned.slice(i, i + 3);
      const idx = Math.abs(hashString(gram)) % this.dimensions;
      vector[idx] += 0.5;
    }

    // L2 normalize
    const norm = Math.hypot(...vector);
    if (norm > 0) {
      for (let i = 0; i < this.dimensions; i++) {
        vector[i] = Number((vector[i] / norm).toFixed(6));
      }
    }

    return vector;
  }
}

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0; // Convert to 32bit integer
  }
  return hash;
}
