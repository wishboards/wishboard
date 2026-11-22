import { InferenceProvider, EmbeddingProvider } from './interfaces.js';

function isTermAssignedToDesired(
  text,
  termIdx,
  seekingIndicators,
  hasSeekingContext,
  hasSelfContext
) {
  for (const ind of seekingIndicators) {
    const indIdx = text.indexOf(ind);
    if (indIdx !== -1 && indIdx < termIdx) {
      return true;
    }
  }
  return hasSeekingContext && !hasSelfContext;
}

function appendAttributeSuggestion(targetObj, catId, term, existingArr = []) {
  const termLower = term.toLowerCase();
  if (existingArr.some((e) => e.toLowerCase() === termLower)) {
    return;
  }
  targetObj[catId] = targetObj[catId] || [];
  if (!targetObj[catId].includes(term)) {
    targetObj[catId].push(term);
  }
}

function processCategoryTerms(category, text, context, state) {
  const catId = category.id;
  const suggestions = category.suggestions || [];

  for (const term of suggestions) {
    const termLower = term.toLowerCase();
    const regexPattern = String.raw`\b${escapeRegExp(termLower)}\b`;
    const matches = [...text.matchAll(new RegExp(regexPattern, 'gi'))];
    if (matches.length === 0) continue;

    state.matchedTerms.push(term);

    for (const match of matches) {
      const termIdx = match.index ?? 0;
      const assignedToDesired = isTermAssignedToDesired(
        text,
        termIdx,
        context.seekingIndicators,
        context.hasSeekingContext,
        context.hasSelfContext
      );

      if (assignedToDesired) {
        appendAttributeSuggestion(
          state.suggestedDesired,
          catId,
          term,
          state.existingDesired[catId]
        );
      } else {
        appendAttributeSuggestion(
          state.suggestedCreator,
          catId,
          term,
          state.existingCreator[catId]
        );
      }
    }
  }
}

const GREETING_FILLER_REGEX =
  /^(?:hey|hi|hello)\s+(?:all|everyone|everybody|folks|y'all|yall|there|wishboard)[,!.:;\-\s]+/i;
const FORMAL_GREETING_FILLER_REGEX =
  /^greetings\s+(?:all|everyone|everybody|folks|wishboard)[,!.:;\-\s]+/i;

/**
 * Strips demonstrable card-redundant greeting filler (e.g., "Hey all,") while strictly
 * preserving unstructured details (such as age) and non-stickered attributes.
 */
export function streamlineWishText(content = '') {
  const trimmed = String(content || '').trim();
  if (!trimmed) return null;

  const stripped = trimmed
    .replace(GREETING_FILLER_REGEX, '')
    .replace(FORMAL_GREETING_FILLER_REGEX, '')
    .trim();
  if (!stripped || stripped.length === trimmed.length) {
    return null;
  }

  return stripped.charAt(0).toUpperCase() + stripped.slice(1);
}

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
   * @param {Record<string, Record<string, unknown>>} [params.stickers]
   */
  async suggestAttributes({
    content = '',
    existingCreatorAttributes = {},
    existingDesiredAttributes = {},
    taxonomy = [],
  }) {
    const text = content.toLowerCase();
    const seekingIndicators = ['looking for', 'seeking', 'want', 'interested in', 'iso', 'desired'];
    const selfIndicators = ['i am', "i'm", 'myself', 'as a'];

    const context = {
      seekingIndicators,
      hasSeekingContext: seekingIndicators.some((indicator) => text.includes(indicator)),
      hasSelfContext: selfIndicators.some((indicator) => text.includes(indicator)),
    };

    const state = {
      suggestedCreator: {},
      suggestedDesired: {},
      matchedTerms: [],
      existingCreator: existingCreatorAttributes,
      existingDesired: existingDesiredAttributes,
    };

    for (const category of taxonomy) {
      processCategoryTerms(category, text, context, state);
    }

    const suggestedContent = streamlineWishText(content);
    const reasons = [];
    if (state.matchedTerms.length > 0) {
      reasons.push(`Local inference matched taxonomy keywords: ${state.matchedTerms.join(', ')}`);
    }
    if (suggestedContent) {
      reasons.push('Removed redundant greeting filler for card conciseness');
    }

    return {
      suggestedCreatorAttributes: state.suggestedCreator,
      suggestedDesiredAttributes: state.suggestedDesired,
      suggestedContent,
      reasoning:
        reasons.length > 0 ? reasons.join('. ') : 'No taxonomy terms identified in wish text',
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
  return str.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.codePointAt(i) || 0;
    hash = Math.trunc((hash << 5) - hash + char);
  }
  return hash;
}
