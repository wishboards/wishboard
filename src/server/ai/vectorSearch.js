/**
 * Vector similarity and semantic search utilities (ADR 0007).
 */

/**
 * Computes cosine similarity between two numeric vectors.
 *
 * @param {number[]} a
 * @param {number[]} b
 * @returns {number} Value between -1.0 and 1.0 (or 0 if invalid/empty)
 */
export function cosineSimilarity(a, b) {
  if (!a || !b || a.length === 0 || b.length === 0 || a.length !== b.length) {
    return 0;
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    const valA = a[i];
    const valB = b[i];
    dotProduct += valA * valB;
    normA += valA * valA;
    normB += valB * valB;
  }

  if (normA === 0 || normB === 0) {
    return 0;
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Ranks a collection of wish embeddings against a query embedding.
 *
 * @param {number[]} queryEmbedding
 * @param {Array<{ wish_id: string, embedding: number[] | string }>} candidateEmbeddings
 * @param {Object} [options]
 * @param {number} [options.minScore=0.1]
 * @param {number} [options.limit=50]
 * @returns {Array<{ wish_id: string, score: number }>}
 */
export function rankWishesBySimilarity(queryEmbedding, candidateEmbeddings, options = {}) {
  const minScore = options.minScore ?? 0.1;
  const limit = options.limit ?? 50;

  if (!queryEmbedding || queryEmbedding.length === 0 || !Array.isArray(candidateEmbeddings)) {
    return [];
  }

  const scored = [];

  for (const item of candidateEmbeddings) {
    let emb = item.embedding;
    if (typeof emb === 'string') {
      try {
        emb = JSON.parse(emb);
      } catch {
        continue;
      }
    }

    if (Array.isArray(emb)) {
      const score = cosineSimilarity(queryEmbedding, emb);
      if (score >= minScore) {
        scored.push({ wish_id: item.wish_id, score });
      }
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}
