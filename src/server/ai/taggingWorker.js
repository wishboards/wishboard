import crypto from 'node:crypto';
import db from '../db.js';
import logger from '../logger.js';
import { getEventProfile } from '../configManager.js';
import { getInferenceProvider, getEmbeddingProvider, isAiEnabled } from './index.js';
import { getIO } from '../socket.js';

let pendingTasks = [];
let customLambdaDispatcher = null;

export const ASYNC_TAGGING_EVENT_KEY = '__wishboardAsyncTask';

export function setLambdaDispatcher(fn) {
  customLambdaDispatcher = fn;
}

export function resetLambdaDispatcher() {
  customLambdaDispatcher = null;
}

async function dispatchAsyncLambdaTagging(payload) {
  const functionName = process.env.AWS_LAMBDA_FUNCTION_NAME;
  if (!functionName) {
    return false;
  }

  const eventPayload = {
    [ASYNC_TAGGING_EVENT_KEY]: 'aiTagging',
    payload,
  };

  if (customLambdaDispatcher) {
    await customLambdaDispatcher(functionName, eventPayload);
    return true;
  }

  const lambdaSdkModule = '@aws-sdk/client-lambda';
  const { LambdaClient, InvokeCommand } = await import(/* @vite-ignore */ lambdaSdkModule);
  const client = new LambdaClient({ region: process.env.AWS_REGION || 'us-east-1' });
  await client.send(
    new InvokeCommand({
      FunctionName: functionName,
      InvocationType: 'Event',
      Payload: Buffer.from(JSON.stringify(eventPayload)),
    })
  );
  return true;
}

/**
 * Queues a wish for asynchronous AI analysis, attribute suggestion, and vector embedding.
 * On AWS Lambda, dispatches an asynchronous self-invocation (InvocationType: 'Event') so
 * POST /api/wishes returns immediately without waiting for outbound LLM inference.
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
  skipInference = false,
}) {
  if (!wishId || !content?.trim() || !isAiEnabled()) {
    return;
  }

  const payload = {
    wishId,
    content: content.trim(),
    creatorAttributes,
    desiredAttributes,
    skipInference: Boolean(skipInference),
  };

  const runTask = async () => {
    if (process.env.AWS_LAMBDA_FUNCTION_NAME) {
      try {
        const dispatched = await dispatchAsyncLambdaTagging(payload);
        if (dispatched) {
          logger.info('Dispatched async Lambda AI tagging job for wish', {
            wish_id: wishId,
            skip_inference: payload.skipInference,
          });
          return;
        }
      } catch (err) {
        logger.warn(
          'Failed to dispatch async Lambda AI job; falling back to in-process execution',
          {
            wish_id: wishId,
            error: err.message,
          }
        );
      }
    }
    await processWishJob(payload);
  };

  const taskPromise = runTask().catch((err) => {
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
  const rawSuggestedContent =
    typeof inferenceResult?.suggestedContent === 'string'
      ? inferenceResult.suggestedContent.trim().slice(0, 500)
      : null;
  const suggestedContent =
    rawSuggestedContent && rawSuggestedContent !== params.content.trim()
      ? rawSuggestedContent
      : null;
  const reasoning = inferenceResult?.reasoning || '';

  const hasCreatorSuggestions = Object.keys(suggestedCreator).some(
    (k) => Array.isArray(suggestedCreator[k]) && suggestedCreator[k].length > 0
  );
  const hasDesiredSuggestions = Object.keys(suggestedDesired).some(
    (k) => Array.isArray(suggestedDesired[k]) && suggestedDesired[k].length > 0
  );

  if (!hasCreatorSuggestions && !hasDesiredSuggestions && !suggestedContent) {
    logger.info('Completed AI inference for wish with no new attribute or wording suggestions', {
      wish_id: wishId,
      model: provider.model || null,
      reasoning,
    });
    return;
  }

  const now = new Date().toISOString();
  const suggestionId = `sugg-${crypto.randomBytes(6).toString('hex')}`;

  await db
    .prepare('DELETE FROM wish_ai_suggestions WHERE wish_id = ? AND status = ?')
    .run(wishId, 'pending');

  await db
    .prepare(
      'INSERT INTO wish_ai_suggestions (id, wish_id, suggested_creator_attributes, suggested_desired_attributes, suggested_content, reasoning, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .run(
      suggestionId,
      wishId,
      JSON.stringify(suggestedCreator),
      JSON.stringify(suggestedDesired),
      suggestedContent,
      reasoning,
      'pending',
      now,
      now
    );

  logger.info('Generated AI suggestions for wish', {
    wish_id: wishId,
    suggestion_id: suggestionId,
    model: provider.model || null,
    has_streamlined_content: Boolean(suggestedContent),
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
 * Processes an individual wish tagging job (inference + vector embedding in parallel).
 */
export async function processWishJob({
  wishId,
  content,
  creatorAttributes,
  desiredAttributes,
  skipInference = false,
}) {
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
  const stickers = profile.stickers || {};

  const jobs = [processEmbeddingJob(wishId, embeddingProvider, content)];
  if (!skipInference) {
    jobs.unshift(
      processInferenceJob(wishId, inferenceProvider, {
        content,
        existingCreatorAttributes: creatorAttributes,
        existingDesiredAttributes: desiredAttributes,
        taxonomy,
        stickers,
      })
    );
  }

  await Promise.allSettled(jobs);
}

/**
 * Awaits all currently active background tagging tasks.
 * Primarily used in integration and unit tests to ensure all asynchronous work completes.
 */
export async function drainQueue() {
  await Promise.all(pendingTasks);
}
