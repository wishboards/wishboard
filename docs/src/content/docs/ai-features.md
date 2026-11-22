---
title: Optional AI Features & Semantic Search
---

# Optional AI Features & Semantic Search

Wishboard includes an optional, privacy-first AI integration designed for convention deployments. It assists attendees by extracting taxonomy tags from freeform wish text and providing semantic vector search, while preserving complete privacy and offline operation.

:::tip[Zero-Cost & Offline by Default]
AI functionality is **completely optional and disabled by default** (`ENABLE_AI_FEATURES=false`). When disabled, the system operates with the zero-cost, inert `NoopProvider` requiring $0.00/mo and zero external network access.
:::

---

## 1. Core Principles

1. **Human-in-the-Loop Review**:
   - AI suggestions **never mutate wishes automatically**.
   - Suggestions are staged in a dedicated `wish_ai_suggestions` table with a `pending` status.
   - The wish creator sees an interactive "✨ AI Suggestions" badge on their wish cards in the **Account** and **Manage Wish** pages.
   - Creators can open the review modal to **Accept All**, **Modify**, or **Reject** suggestions. Only explicitly accepted attributes are applied to the wish.

2. **Privacy & Offline First**:
   - The default `local` provider runs entirely in-process using taxonomy heuristics and deterministic feature-hashing embeddings. No attendee data leaves the local hardware (e.g. Raspberry Pi).
   - In `cloud` mode, requests can be pointed to Google Gemini's free tier ($0/mo for low-volume demo/event usage) or an internal LLM endpoint.

3. **Graceful Fallbacks**:
   - If an AI provider is unreachable or returns an error, the background worker logs the failure and leaves the wish untouched.
   - If semantic search has no matching vectors or the provider is unavailable, search automatically falls back to standard SQL `LIKE` substring filtering.

---

## 2. Supported Providers

Wishboard supports three inference and embedding providers via the `AI_PROVIDER` environment variable:

| Provider         | Inference Mechanism                        | Embedding Mechanism                    | Network Requirements | Typical Monthly Cost  | Best For                                                |
| :--------------- | :----------------------------------------- | :------------------------------------- | :------------------- | :-------------------- | :------------------------------------------------------ |
| `noop` (default) | Returns empty suggestions                  | Returns `null`                         | None (Disconnected)  | **$0.00**             | Air-gapped kiosks, minimal resource environments        |
| `local`          | Taxonomy regex & polarity heuristic parser | 64-dim unit-normalized feature hashing | None (Offline CPU)   | **$0.00**             | Raspberry Pi 4/5 kiosks with zero external internet     |
| `cloud`          | Gemini / OpenAI REST prompt completion     | Gemini / OpenAI embedding model        | Outbound HTTPS       | **$0.00** (Free Tier) | AWS Serverless deployments, connected demo environments |

---

## 3. Configuration & Environment Variables

To enable AI features in your deployment, set the following environment variables in your `.env` file (for local kiosks) or Lambda environment (for AWS Serverless):

```ini
# Enable or disable AI processing (default: false)
ENABLE_AI_FEATURES=true

# Choose provider: "local", "cloud", or "noop" (default: "noop")
AI_PROVIDER=local

# -------------------------------------------------------------
# Cloud Provider Configuration (Only required when AI_PROVIDER=cloud)
# -------------------------------------------------------------
# API Key for Google Gemini or OpenAI (direct string or resolved from AWS SSM)
AI_API_KEY=your_api_key_here

# AWS SSM Parameter path for secure serverless API key storage (recommended for AWS)
AI_API_KEY_SSM=/wishboard/ai/gemini-api-key

# Model name (default: "gemini-2.0-flash")
AI_MODEL=gemini-2.0-flash

# Custom API endpoint (optional; defaults to Google Generative Language API)
# AI_API_ENDPOINT=https://generativelanguage.googleapis.com/v1beta
```

### Turnkey Cloud Setup with `wishboard bootstrap`

For AWS Serverless deployments, plaintext API keys in environment variables are discouraged. Wishboard supports resolving API keys lazily from AWS Systems Manager (SSM) Parameter Store:

1. **Obtain a Free Gemini API Key**:
   Visit [Google AI Studio](https://aistudio.google.com) and click **Get API key** (free tier: 15 RPM, 1M TPM, 1,500 RPD).
2. **Run Turnkey Bootstrap**:
   Pass the API key to `wishboard bootstrap` to automatically store it as an encrypted `SecureString` in AWS SSM and configure GitHub Actions deployment variables:
   ```bash
   npx wishboard bootstrap \
     --ai-api-key "your_gemini_api_key" \
     --enable-ai \
     --ai-provider cloud
   ```
3. **Manual SSM Storage (Alternative)**:
   Alternatively, store the key manually in your AWS account using the AWS CLI:
   ```bash
   aws ssm put-parameter \
     --name "/wishboard/ai/gemini-api-key" \
     --type "SecureString" \
     --value "your_gemini_api_key"
   ```

---

## 4. How Semantic Search Works

When AI features are enabled and embeddings are generated for wishes, users can perform semantic queries:

- **API Request**:
  ```http
  GET /api/wishes?q=looking+for+switch+gamers&mode=semantic
  ```
- **Execution Flow**:
  1. The server generates an embedding vector for the search query using the configured `EmbeddingProvider`.
  2. It computes cosine similarities against candidate wish vectors stored in the `wish_embeddings` table.
  3. Candidates exceeding a similarity threshold (`0.15`) are ranked and returned in order.
  4. If no vector matches are found or the embedding provider is unavailable, the query falls back to `content LIKE ?`.

---

## 5. Architectural Boundaries

Per **ADR 0007**, the AI functionality is cleanly decoupled:

- **Host Application (`wishboard`)**:
  - Owns asynchronous background task queue (`src/server/ai/taggingWorker.js`).
  - Owns database persistence (`wish_ai_suggestions`, `wish_embeddings`).
  - Owns client UI components (`AiSuggestionBadge`, `AiSuggestionModal`).
  - Owns HTTP routes and OpenAPI specifications (`/api/wishes/:id/suggestions`).
- **Matching Engine (`@wishboards/matching-engine`)**:
  - Vector similarity algorithms (`cosineSimilarity`, `rankWishesBySimilarity` in `src/server/ai/vectorSearch.js`) are pure mathematical calculations with zero external dependencies, designed for clean future extraction into the engine library.
