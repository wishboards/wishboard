import { describe, it, expect, vi, afterEach } from 'vitest';
import { apiClient, bearerHeader, createGlobalFetchClient } from './client';

describe('Contract-Typed API Client (apiClient)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('constructs Authorization header via bearerHeader helper', () => {
    expect(bearerHeader('tok_123')).toEqual({ Authorization: 'Bearer tok_123' });
    expect(bearerHeader(null)).toEqual({});
    expect(bearerHeader(undefined)).toEqual({});
    expect(bearerHeader('')).toEqual({});
  });

  it('delegates GET requests with query parameters to globalThis.fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ exists: true }),
    } as Response);

    const { data, response } = await apiClient.GET('/api/users/exists', {
      params: { query: { username: 'alice' } },
    });

    expect(fetchSpy).toHaveBeenCalledWith('/api/users/exists?username=alice');
    expect(response.ok).toBe(true);
    expect(data).toEqual({ exists: true });
  });

  it('delegates POST requests with path params and JSON body to globalThis.fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ success: true, new_passphrase: 'alpha-bravo-charlie' }),
    } as Response);

    const { data, response } = await apiClient.POST('/api/admin/users/{username}/reset-password', {
      params: { path: { username: 'bob' } },
      headers: bearerHeader('admin-token'),
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/admin/users/bob/reset-password',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ authorization: 'Bearer admin-token' }),
      })
    );
    expect(response.ok).toBe(true);
    expect(data).toEqual({ success: true, new_passphrase: 'alpha-bravo-charlie' });
  });

  it('parses error payloads when response.ok is false', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: async () => ({ error: 'Forbidden' }),
    } as Response);

    const { data, error, response } = await apiClient.POST('/api/users/me/delete', {
      headers: bearerHeader('user-token'),
    });

    expect(response.ok).toBe(false);
    expect(response.status).toBe(403);
    expect(data).toBeUndefined();
    expect(error).toEqual({ error: 'Forbidden' });
  });

  it('normalizes partial mock responses lacking status, headers, or text() methods', async () => {
    const client = createGlobalFetchClient();

    // Case 1: Only ok + text() provided
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      headers: { 'x-custom': '1' } as unknown as Headers,
      text: async () => JSON.stringify({ exists: false }),
    } as Response);

    const res1 = await client.GET('/api/users/exists', {
      params: { query: { username: 'test' } },
    });
    expect(res1.response.status).toBe(200);
    expect(res1.data).toEqual({ exists: false });
    expect(res1.response.clone().ok).toBe(true);
    await expect(res1.response.arrayBuffer()).resolves.toBeInstanceOf(ArrayBuffer);
    await expect(res1.response.blob()).resolves.toBeInstanceOf(Blob);
    await expect(res1.response.formData()).resolves.toBeInstanceOf(FormData);
    await expect(
      (res1.response as unknown as { bytes: () => Promise<Uint8Array> }).bytes()
    ).resolves.toBeInstanceOf(Uint8Array);

    // Case 2: Non-ok without status or json() / text()
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
    } as Response);

    const res2 = await client.GET('/api/admin/users');
    expect(res2.response.status).toBe(500);
    expect(res2.error).toBe('');
  });
});
