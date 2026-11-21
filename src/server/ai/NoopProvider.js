import { InferenceProvider, EmbeddingProvider } from './interfaces.js';

export class NoopInferenceProvider extends InferenceProvider {
  async suggestAttributes() {
    return {
      suggestedCreatorAttributes: {},
      suggestedDesiredAttributes: {},
      reasoning: 'Noop inference provider active',
    };
  }

  isAvailable() {
    return false;
  }
}

export class NoopEmbeddingProvider extends EmbeddingProvider {
  async generateEmbedding() {
    return [];
  }

  isAvailable() {
    return false;
  }
}
