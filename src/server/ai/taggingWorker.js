import crypto from 'node:crypto';
import db from '../db.js';
import logger from '../logger.js';
import { getEventProfile } from '../configManager.js';
import { getInferenceProvider, getEmbeddingProvider, isAiEnabled } from './index.js';
import { getIO } from '../socket.js';

let pendingTasks = [];

/**
 * Queues a wish for asynchronous AI analysis, attribute suggestion, and vector embedding.
 * Does not block caller or throw on background errors.
 *
 * @param {Object} wishData
 * @param {string} wishData.wishId
 * @param {string} wishData.content
 * @param {Record<string, string[]>} [wishData.creatorAttributes]
 * @param {Record<string, string[]>} [wishData.desiredAttributes]
 */
export function queueWishForTagging({
  wishId,
  content,
  creatorAttributes = {},
  desiredAttributes = {},
}) {
  if (!wishId || !content?.trim()) {
    return;
  }

  const taskPromise = processWishJob({
    wishId,
    content: content.trim(),
    creatorAttributes,
    desiredAttributes,
  }).catch((err) => {
    logger.warn('Failed background AI tagging job for wish', {
      wish_id: wishId,
      error: err.message,
    });
  });

  pendingTasks.push(taskPromise);
  void taskPromise.finally(() => {
    pendingTasks = pendingTasks.filter((p) => p !== taskPromise);
  });
}

function notifyAiSuggestionsReady(wishId, suggestionId) {
  try {
    const io = getIO();
    if (io) {
      io.emit('wish:ai_suggestions_ready', {
        wish_id: wishId,
        suggestion_id: suggestionId,
      });
    }
  } catch {
    // Socket may not be initialized in non-socket environments (e.g. serverless)
  }
}

async function processInferenceJob(wishId, provider, params) {
  if (!provider.isAvailable()) {
    return;
  }

  const inferenceResult = await provider.suggestAttributes(params);
  const suggestedCreator = inferenceResult?.suggestedCreatorAttributes || {};
  const suggestedDesired = inferenceResult?.suggestedDesiredAttributes || {};
  const reasoning = inferenceResult?.reasoning || '';

  const hasCreatorSuggestions = Object.keys(suggestedCreator).some(
    (k) => Array.isArray(suggestedCreator[k]) && suggestedCreator[k].length > 0
  );
  const hasDesiredSuggestions = Object.keys(suggestedDesired).some(
    (k) => Array.isArray(suggestedDesired[k]) && suggestedDesired[k].length > 0
  );

  if (!hasCreatorSuggestions && !hasDesiredSuggestions) {
    return;
  }

  const now = new Date().toISOString();
  const suggestionId = `sugg-${crypto.randomBytes(6).toString('hex')}`;

  await db
    .prepare('DELETE FROM wish_ai_suggestions WHERE wish_id = ? AND status = ?')
    .run(wishId, 'pending');

  await db
    .prepare(
      'INSERT INTO wish_ai_suggestions (id, wish_id, suggested_creator_attributes, suggested_desired_attributes, reasoning, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .run(
      suggestionId,
      wishId,
      JSON.stringify(suggestedCreator),
      JSON.stringify(suggestedDesired),
      reasoning,
      'pending',
      now,
      now
    );

  logger.info('Generated AI suggestions for wish', {
    wish_id: wishId,
    suggestion_id: suggestionId,
  });

  notifyAiSuggestionsReady(wishId, suggestionId);
}

async function processEmbeddingJob(wishId, provider, content) {
  if (!provider.isAvailable()) {
    return;
  }

  const embedding = await provider.generateEmbedding(content);
  if (!Array.isArray(embedding) || embedding.length === 0) {
    return;
  }

  const now = new Date().toISOString();
  await db.prepare('DELETE FROM wish_embeddings WHERE wish_id = ?').run(wishId);
  await db
    .prepare('INSERT INTO wish_embeddings (wish_id, embedding, created_at) VALUES (?, ?, ?)')
    .run(wishId, JSON.stringify(embedding), now);

  logger.info('Generated AI vector embedding for wish', {
    wish_id: wishId,
    dimensions: embedding.length,
  });
}

/**
 * Processes an individual wish tagging job.
 */
async function processWishJob({ wishId, content, creatorAttributes, desiredAttributes }) {
  if (!isAiEnabled()) {
    return;
  }

  const inferenceProvider = getInferenceProvider();
  const embeddingProvider = getEmbeddingProvider();

  if (!inferenceProvider.isAvailable() && !embeddingProvider.isAvailable()) {
    return;
  }

  const profile = getEventProfile() || {};
  const taxonomy = profile.categories || [];

  await processInferenceJob(wishId, inferenceProvider, {
    content,
    existingCreatorAttributes: creatorAttributes,
    existingDesiredAttributes: desiredAttributes,
    taxonomy,
  });

  await processEmbeddingJob(wishId, embeddingProvider, content);
}

/**
 * Awaits all currently active background tagging tasks.
 * Primarily used in integration and unit tests to ensure all asynchronous work completes.
 */
export async function drainQueue() {
  await Promise.all(pendingTasks);
}
