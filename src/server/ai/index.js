import { NoopInferenceProvider, NoopEmbeddingProvider } from './NoopProvider.js';
import { LocalInferenceProvider, LocalEmbeddingProvider } from './LocalProvider.js';
import {
  CloudInferenceProvider,
  CloudEmbeddingProvider,
  DEFAULT_GEMINI_MODEL,
} from './CloudProvider.js';

let customInferenceProvider = null;
let customEmbeddingProvider = null;

/**
 * Returns true if AI features are enabled in the current environment.
 */
export function isAiEnabled() {
  return process.env.ENABLE_AI_FEATURES === 'true';
}

/**
 * Returns public, non-secret AI runtime status for /api/config and Admin System Overview.
 */
export function getAiStatus() {
  const enabled = isAiEnabled();
  const provider = enabled ? (process.env.AI_PROVIDER || 'noop').toLowerCase() : 'noop';
  const model = provider === 'cloud' ? process.env.AI_MODEL || DEFAULT_GEMINI_MODEL : null;
  return {
    enabled: enabled && provider !== 'noop',
    provider,
    model,
  };
}

/**
 * Resolves the active InferenceProvider based on configuration.
 *
 * @returns {import('./interfaces.js').InferenceProvider}
 */
export function getInferenceProvider() {
  if (customInferenceProvider) {
    return customInferenceProvider;
  }

  if (!isAiEnabled()) {
    return new NoopInferenceProvider();
  }

  const providerType = (process.env.AI_PROVIDER || 'noop').toLowerCase();
  switch (providerType) {
    case 'local':
      return new LocalInferenceProvider();
    case 'cloud':
      return new CloudInferenceProvider();
    default:
      return new NoopInferenceProvider();
  }
}

/**
 * Resolves the active EmbeddingProvider based on configuration.
 *
 * @returns {import('./interfaces.js').EmbeddingProvider}
 */
export function getEmbeddingProvider() {
  if (customEmbeddingProvider) {
    return customEmbeddingProvider;
  }

  if (!isAiEnabled()) {
    return new NoopEmbeddingProvider();
  }

  const providerType = (process.env.AI_PROVIDER || 'noop').toLowerCase();
  switch (providerType) {
    case 'local':
      return new LocalEmbeddingProvider();
    case 'cloud':
      return new CloudEmbeddingProvider();
    default:
      return new NoopEmbeddingProvider();
  }
}

/**
 * Testing overrides
 */
export function setInferenceProvider(provider) {
  customInferenceProvider = provider;
}

export function setEmbeddingProvider(provider) {
  customEmbeddingProvider = provider;
}

export function resetProviders() {
  customInferenceProvider = null;
  customEmbeddingProvider = null;
}

export * from './interfaces.js';
export * from './NoopProvider.js';
export * from './LocalProvider.js';
export * from './CloudProvider.js';
export * from './vectorSearch.js';
export * from './taggingWorker.js';
