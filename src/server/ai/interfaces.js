/**
 * Abstract interfaces for Wishboard AI capabilities (ADR 0007).
 */

export class InferenceProvider {
  /**
   * Analyzes wish content and suggests relevant taxonomy-aligned attributes.
   *
   * @param {Object} params
   * @param {string} params.content
   * @param {Record<string, string[]>} [params.existingCreatorAttributes]
   * @param {Record<string, string[]>} [params.existingDesiredAttributes]
   * @param {Array<{ id: string, label: string, suggestions: string[] }>} [params.taxonomy]
   * @returns {Promise<{ suggestedCreatorAttributes: Record<string, string[]>, suggestedDesiredAttributes: Record<string, string[]>, reasoning?: string }>}
   */
  async suggestAttributes(_params) {
    throw new Error('suggestAttributes must be implemented by subclass');
  }

  /**
   * Indicates whether this inference provider is configured and available.
   * @returns {boolean}
   */
  isAvailable() {
    return false;
  }
}

export class EmbeddingProvider {
  /**
   * Generates a floating point vector embedding for the given text.
   *
   * @param {string} _text
   * @returns {Promise<number[]>}
   */
  async generateEmbedding(_text) {
    throw new Error('generateEmbedding must be implemented by subclass');
  }

  /**
   * Indicates whether this embedding provider is configured and available.
   * @returns {boolean}
   */
  isAvailable() {
    return false;
  }
}
