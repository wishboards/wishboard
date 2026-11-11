import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { app } from '../../src/server/index.js';
import { getOpenApiDocument } from '../../src/server/docs/openapi.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const CLIENT_SRC_DIR = path.join(PROJECT_ROOT, 'src/client/src');

/**
 * Recursively walks the Express 5 `app.router` stack and returns the matched
 * route metadata `{ fullPath, methods }` for a given HTTP method and concrete URL path.
 */
export function findMatchingExpressRoute(expressApp, method, urlPath) {
  function checkRouter(router, prefix, target) {
    for (const layer of router.stack) {
      if (layer.route) {
        if (layer.match(target) && layer.route.methods[method.toLowerCase()]) {
          return {
            fullPath: prefix + (layer.route.path === '/' ? '' : layer.route.path),
            methods: Object.keys(layer.route.methods),
          };
        }
      } else if (layer.name === 'router' && layer.handle?.stack) {
        if (layer.match(target)) {
          const matchedPrefix = layer.path;
          const remaining = target.slice(matchedPrefix.length) || '/';
          const res = checkRouter(layer.handle, prefix + matchedPrefix, remaining);
          if (res) return res;
        }
      }
    }
    return null;
  }
  return checkRouter(expressApp.router, '', urlPath);
}

/**
 * Matches a concrete URL path (e.g. `/api/admin/users/test-id/role`) against
 * the OpenAPI `paths` map for a given HTTP method.
 */
export function findMatchingOpenApiPath(openApiPaths, method, concreteUrlPath) {
  const lowerMethod = method.toLowerCase();
  for (const [openApiPath, pathItem] of Object.entries(openApiPaths)) {
    if (!pathItem[lowerMethod]) continue;
    const regexStr = '^' + openApiPath.replaceAll(/\{[^}]+\}/g, '[^/]+') + '$';
    if (new RegExp(regexStr).test(concreteUrlPath)) {
      return openApiPath;
    }
  }
  return null;
}

/**
 * Recursively collects all non-test `.ts` and `.tsx` source files under `dir`.
 */
function walkClientSourceFiles(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkClientSourceFiles(fullPath));
    } else if (
      /\.(tsx?|jsx?)$/.test(entry.name) &&
      !entry.name.includes('.test.') &&
      !entry.name.endsWith('.d.ts')
    ) {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Normalizes a client URL expression (template literal or OpenAPI path template)
 * into a concrete path suitable for Express router matching.
 */
function normalizeClientUrl(rawUrl) {
  const withoutQuery = rawUrl.split('?')[0];
  return withoutQuery.replaceAll(/\$\{[^}]+\}/g, 'test-id').replaceAll(/\{[^}]+\}/g, 'test-id');
}

/**
 * Extracts all literal `fetch(...)` and `apiClient.<METHOD>(...)` API calls
 * from client source files.
 */
export function extractClientApiCalls(clientDir = CLIENT_SRC_DIR) {
  const files = walkClientSourceFiles(clientDir);
  const calls = [];

  for (const file of files) {
    const relFile = path.relative(PROJECT_ROOT, file).replaceAll('\\', '/');
    const content = fs.readFileSync(file, 'utf8');

    // 1. Match typed apiClient.<METHOD>('/api/...') calls (including multiline calls)
    const apiClientRegex =
      /apiClient\s*\.\s*(GET|POST|PUT|DELETE|PATCH)\s*\(\s*['"`]([^'"`]+)['"`]/g;
    let match;
    while ((match = apiClientRegex.exec(content)) !== null) {
      const method = match[1].toUpperCase();
      const rawUrl = match[2];
      const line = content.slice(0, match.index).split('\n').length;
      calls.push({
        source: 'apiClient',
        file: relFile,
        line,
        method,
        rawUrl,
        concretePath: normalizeClientUrl(rawUrl),
      });
    }

    // 2. Match raw fetch('/api/...') or fetch(`/api/...`) calls
    const lines = content.split('\n');
    for (let idx = 0; idx < lines.length; idx++) {
      const lineText = lines[idx];
      if (!lineText.includes('fetch(')) continue;
      // Match literal or template-literal /api/... calls
      const templateOrLiteral = lineText.match(/\bfetch\(\s*([`'"])(\/api\/[^`'"]+)\1/);
      if (!templateOrLiteral) continue;

      const rawUrl = templateOrLiteral[2];
      const windowSnippet = lines.slice(idx, Math.min(lines.length, idx + 12)).join(' ');
      const methodMatch = windowSnippet.match(/method:\s*['"](GET|POST|PUT|DELETE|PATCH)['"]/i);
      const method = methodMatch ? methodMatch[1].toUpperCase() : 'GET';

      calls.push({
        source: 'fetch',
        file: relFile,
        line: idx + 1,
        method,
        rawUrl,
        concretePath: normalizeClientUrl(rawUrl),
      });
    }
  }

  return calls;
}

describe('Client ↔ Server ↔ OpenAPI Contract Seam Guard', () => {
  const openApiDoc = getOpenApiDocument();
  const openApiPaths = openApiDoc.paths;
  const clientCalls = extractClientApiCalls();

  it('discovers client API call sites across src/client/src', () => {
    expect(clientCalls.length).toBeGreaterThanOrEqual(40);
  });

  it('verifies every client fetch/apiClient call resolves to a mounted Express route (excluding SPA *path fallback)', () => {
    const failures = [];

    for (const call of clientCalls) {
      const match = findMatchingExpressRoute(app, call.method, call.concretePath);
      if (!match) {
        failures.push(
          `${call.file}:${call.line} [${call.source}] ${call.method} ${call.rawUrl} -> NO EXPRESS ROUTE MATCH`
        );
      } else if (match.fullPath === '*path') {
        failures.push(
          `${call.file}:${call.line} [${call.source}] ${call.method} ${call.rawUrl} -> FELL THROUGH TO SPA CATCH-ALL (*path)`
        );
      }
    }

    expect(failures).toEqual([]);
  });

  it('verifies every client fetch/apiClient call is documented in the OpenAPI specification', () => {
    const failures = [];

    for (const call of clientCalls) {
      const openApiMatch = findMatchingOpenApiPath(openApiPaths, call.method, call.concretePath);
      if (!openApiMatch) {
        failures.push(
          `${call.file}:${call.line} [${call.source}] ${call.method} ${call.rawUrl} -> MISSING FROM OPENAPI SPEC`
        );
      }
    }

    expect(failures).toEqual([]);
  });

  it('verifies every documented OpenAPI path+method is mounted on the Express app', () => {
    const failures = [];
    const httpMethods = ['get', 'post', 'put', 'delete', 'patch'];

    for (const [oPath, pathItem] of Object.entries(openApiPaths)) {
      for (const method of httpMethods) {
        if (!pathItem[method]) continue;
        const concretePath = oPath.replaceAll(/\{[^}]+\}/g, 'test-id');
        const expressMatch = findMatchingExpressRoute(app, method.toUpperCase(), concretePath);
        if (!expressMatch || expressMatch.fullPath === '*path') {
          failures.push(`OpenAPI ${method.toUpperCase()} ${oPath} -> NOT MOUNTED ON EXPRESS`);
        }
      }
    }

    expect(failures).toEqual([]);
  });
});
