import { describe, it, expect } from 'vitest';
import {
  createContractFetchMock,
  matchOpenApiOperation,
  resolveSchemaRef,
  validateAgainstOpenApiSchema,
} from './contractFetch';
import { apiClient } from '../api/client';

describe('Contract-Validated Fetch Mock Helper (contractFetch)', () => {
  it('resolves $ref schema pointers and handles undefined schemas', () => {
    expect(resolveSchemaRef(undefined)).toBeUndefined();
    const resolved = resolveSchemaRef({ $ref: '#/components/schemas/ResetPasswordResponse' });
    expect(resolved?.properties).toHaveProperty('new_passphrase');
    expect(resolved?.required).toContain('new_passphrase');
  });

  it('matches exact and parameterized OpenAPI operations', () => {
    const exact = matchOpenApiOperation('GET', '/api/wishes/exclusions');
    expect(exact?.pathTemplate).toBe('/api/wishes/exclusions');

    const paramMatch = matchOpenApiOperation('POST', '/api/admin/users/alice/reset-password');
    expect(paramMatch?.pathTemplate).toBe('/api/admin/users/{username}/reset-password');

    const unknown = matchOpenApiOperation('POST', '/api/users/me/exclusions');
    expect(unknown).toBeNull();
  });

  it('validates primitive, array, enum, nullable, union, and object schemas', () => {
    expect(validateAgainstOpenApiSchema('ok', undefined)).toEqual([]);
    expect(validateAgainstOpenApiSchema(null, { type: 'string', nullable: true })).toEqual([]);
    expect(validateAgainstOpenApiSchema(null, { type: 'string' })).toEqual([
      'response: expected non-null value',
    ]);
    expect(validateAgainstOpenApiSchema('invalid', { enum: ['user', 'admin'] })).toEqual([
      'response: "invalid" is not one of [user, admin]',
    ]);
    expect(validateAgainstOpenApiSchema('not-array', { type: 'array' })).toEqual([
      'response: expected array, got string',
    ]);
    expect(
      validateAgainstOpenApiSchema([123], { type: 'array', items: { type: 'string' } })
    ).toEqual(['response[0]: expected string, got number']);
    expect(validateAgainstOpenApiSchema([], { type: 'object' })).toEqual([
      'response: expected object, got array',
    ]);
    expect(validateAgainstOpenApiSchema(42, { type: 'boolean' })).toEqual([
      'response: expected boolean, got number',
    ]);
    expect(validateAgainstOpenApiSchema('abc', { type: 'number' })).toEqual([
      'response: expected number, got string',
    ]);
    expect(
      validateAgainstOpenApiSchema('ok', {
        anyOf: [{ type: 'number' }, { type: 'string' }],
      })
    ).toEqual([]);
    expect(
      validateAgainstOpenApiSchema(true, {
        oneOf: [{ type: 'number' }, { type: 'string' }],
      })
    ).toEqual(['response: value did not match any allowed schema union variant']);
  });

  it('allows valid contract requests and responses end-to-end with apiClient', async () => {
    globalThis.fetch = createContractFetchMock([
      {
        method: 'POST',
        path: '/api/admin/users/{username}/reset-password',
        response: () => ({
          success: true,
          new_passphrase: 'maple-river-cloud',
        }),
      },
      {
        method: 'POST',
        path: '/api/admin/users/{id}/role',
        response: { success: true },
      },
    ]);

    const resetRes = await apiClient.POST('/api/admin/users/{username}/reset-password', {
      params: { path: { username: 'tester' } },
    });
    expect(resetRes.data).toEqual({
      success: true,
      new_passphrase: 'maple-river-cloud',
    });

    const roleRes = await apiClient.POST('/api/admin/users/{id}/role', {
      params: { path: { id: 'u1' } },
      body: { role: 'admin' },
    });
    expect(roleRes.data).toEqual({ success: true });
  });

  it('throws ContractViolation when calling an undocumented endpoint (like the historical /api/users/me/exclusions bug)', async () => {
    const mockFetch = createContractFetchMock([]);

    await expect(
      mockFetch('/api/users/me/exclusions', {
        method: 'POST',
        body: JSON.stringify({ wish_id: 'w1' }),
      })
    ).rejects.toThrow(
      /\[ContractViolation\] Undocumented API call: POST \/api\/users\/me\/exclusions/
    );
  });

  it('throws ContractViolation when a mock response omits a required OpenAPI property (like camelCase newPassphrase instead of new_passphrase)', async () => {
    const mockFetch = createContractFetchMock([
      {
        method: 'POST',
        path: '/api/admin/users/{username}/reset-password',
        // Historical bug: mock returned { newPassphrase: '...' } instead of { success: true, new_passphrase: '...' }
        response: { newPassphrase: 'wrong-casing-passphrase' },
      },
    ]);

    await expect(
      mockFetch('/api/admin/users/tester/reset-password', { method: 'POST' })
    ).rejects.toThrow(
      /\[ContractViolation\] Mock response for POST \/api\/admin\/users\/\{username\}\/reset-password \(200\) violates OpenAPI schema/
    );
  });

  it('throws ContractViolation when request body violates the OpenAPI request schema', async () => {
    const mockFetch = createContractFetchMock([
      {
        method: 'POST',
        path: '/api/admin/users/{id}/role',
        response: { success: true },
      },
    ]);

    await expect(
      mockFetch('/api/admin/users/u1/role', {
        method: 'POST',
        body: JSON.stringify({ role: 'superadmin' }),
      })
    ).rejects.toThrow(
      /\[ContractViolation\] Invalid request body for POST \/api\/admin\/users\/\{id\}\/role/
    );
  });

  it('throws ContractViolation when no mock route is registered for a valid OpenAPI path', async () => {
    const mockFetch = createContractFetchMock([]);

    await expect(mockFetch('/api/config')).rejects.toThrow(
      /\[ContractViolation\] No mock route registered in createContractFetchMock for GET \/api\/config/
    );
  });
});
