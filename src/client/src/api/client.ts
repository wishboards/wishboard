import createClient, { type Client } from 'openapi-fetch';
import type { paths, components } from './schema';

export type ApiPaths = paths;
export type ApiComponents = components;
export type ApiSchemas = components['schemas'];

/**
 * Contract-typed fetch adapter that delegates directly to `globalThis.fetch(url, init)`
 * without wrapping in a DOM `Request` object, preserving full compatibility with
 * unit-test `globalThis.fetch` mocks while providing compile-time OpenAPI type safety.
 */
function createGlobalFetchClient(): Client<paths> {
  return createClient<paths>({
    baseUrl: '',
    Request: class ContractRequestShim {
      url: string;
      method: string;
      headers: Headers;
      init: RequestInit;
      constructor(url: string | URL, init: RequestInit = {}) {
        this.url = String(url);
        this.method = (init.method || 'GET').toUpperCase();
        this.headers =
          init.headers instanceof Headers ? init.headers : new Headers(init.headers ?? {});
        this.init = init;
      }
    } as unknown as typeof globalThis.Request,
    fetch: (async (req: unknown) => {
      const shim = req as { url: string; method: string; headers: Headers; init: RequestInit };
      const plainHeaders: Record<string, string> = {};
      shim.headers.forEach((value, key) => {
        plainHeaders[key] = value;
      });
      const init: RequestInit = {
        ...shim.init,
        method: shim.method,
        headers: plainHeaders,
      };
      const rawRes = await globalThis.fetch(shim.url, init);
      return normalizeFetchResponse(rawRes);
    }) as typeof globalThis.fetch,
  });
}

function normalizeFetchResponse(rawRes: Response): Response {
  const headers =
    rawRes.headers instanceof Headers
      ? rawRes.headers
      : new Headers(
          rawRes.headers && typeof rawRes.headers === 'object'
            ? (rawRes.headers as Record<string, string>)
            : {}
        );

  const status = typeof rawRes.status === 'number' ? rawRes.status : rawRes.ok ? 200 : 500;

  return {
    ok: Boolean(rawRes.ok),
    status,
    statusText: rawRes.statusText ?? '',
    headers,
    url: rawRes.url ?? '',
    redirected: Boolean(rawRes.redirected),
    type: rawRes.type ?? 'basic',
    body: rawRes.body ?? null,
    bodyUsed: Boolean(rawRes.bodyUsed),
    clone: () => normalizeFetchResponse(rawRes),
    arrayBuffer: () =>
      typeof rawRes.arrayBuffer === 'function'
        ? rawRes.arrayBuffer()
        : Promise.resolve(new ArrayBuffer(0)),
    blob: () => (typeof rawRes.blob === 'function' ? rawRes.blob() : Promise.resolve(new Blob())),
    formData: () =>
      typeof rawRes.formData === 'function' ? rawRes.formData() : Promise.resolve(new FormData()),
    bytes: () =>
      typeof (rawRes as { bytes?: () => Promise<Uint8Array> }).bytes === 'function'
        ? (rawRes as { bytes: () => Promise<Uint8Array> }).bytes()
        : Promise.resolve(new Uint8Array()),
    json: async () => {
      if (typeof rawRes.json === 'function') {
        return rawRes.json();
      }
      if (typeof rawRes.text === 'function') {
        const text = await rawRes.text();
        return text ? JSON.parse(text) : undefined;
      }
      return undefined;
    },
    text: async () => {
      if (typeof rawRes.text === 'function') {
        return rawRes.text();
      }
      if (typeof rawRes.json === 'function') {
        const data = await rawRes.json();
        return data === undefined ? '' : JSON.stringify(data);
      }
      return '';
    },
  } as Response;
}

export const apiClient: Client<paths> = createGlobalFetchClient();

/**
 * Helper to convert a Bearer token string into an Authorization header record.
 */
export function bearerHeader(token?: string | null): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export { createGlobalFetchClient };
