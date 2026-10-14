import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { getOpenApiDocument, registry } from './openapi.js';
import app from '../index.js';

describe('OpenAPI Specification Generator', () => {
  it('generates a valid OpenAPI 3.0 document with expected metadata', () => {
    const doc = getOpenApiDocument();
    expect(doc).toBeDefined();
    expect(doc.openapi).toBe('3.0.0');
    expect(doc.info.title).toBe('Wishboard REST API');
    expect(doc.info.version).toBeDefined();
    expect(doc.servers).toHaveLength(1);
    expect(doc.servers[0].url).toBe('/');
  });

  it('registers core schema components in OpenAPI definitions', () => {
    const doc = getOpenApiDocument();
    const schemas = doc.components.schemas;
    expect(schemas).toBeDefined();
    expect(schemas).toHaveProperty('Wish');
    expect(schemas).toHaveProperty('CreateWishInput');
    expect(schemas).toHaveProperty('ManageWishInput');
    expect(schemas).toHaveProperty('ClaimWishInput');
    expect(schemas).toHaveProperty('ExclusionImportInput');
    expect(schemas).toHaveProperty('WishmailMessage');
    expect(schemas).toHaveProperty('SendWishmailInput');
    expect(schemas).toHaveProperty('ConfigResponse');
    expect(schemas).toHaveProperty('MatchmakingRule');
    expect(schemas).toHaveProperty('CheckRuleConflictsInput');
    expect(schemas).toHaveProperty('CreateRuleInput');
    expect(schemas).toHaveProperty('UsernameCheckQuery');
    expect(schemas).toHaveProperty('RegisterUserInput');
    expect(schemas).toHaveProperty('LoginInput');
    expect(schemas).toHaveProperty('UserProfile');
    expect(schemas).toHaveProperty('UpdateUserInput');
    expect(schemas).toHaveProperty('UserDeletePreview');
    expect(schemas).toHaveProperty('AdminUserRoleInput');
    expect(schemas).toHaveProperty('ResetPasswordInput');
    expect(schemas).toHaveProperty('CaptivePortalStatus');
    expect(schemas).toHaveProperty('ErrorResponse');
    expect(schemas).toHaveProperty('SuccessResponse');
  });

  it('registers authentication security schemes', () => {
    const doc = getOpenApiDocument();
    const securitySchemes = doc.components.securitySchemes;
    expect(securitySchemes).toBeDefined();
    expect(securitySchemes).toHaveProperty('BearerAuth');
    expect(securitySchemes).toHaveProperty('PassphraseAuth');
    expect(securitySchemes.BearerAuth.type).toBe('http');
    expect(securitySchemes.BearerAuth.scheme).toBe('bearer');
    expect(securitySchemes.PassphraseAuth.type).toBe('apiKey');
    expect(securitySchemes.PassphraseAuth.name).toBe('X-Passphrase');
  });

  it('defines all major endpoints and HTTP methods across all domains', () => {
    const doc = getOpenApiDocument();
    const paths = doc.paths;
    expect(paths).toBeDefined();

    // Configuration
    expect(paths).toHaveProperty('/api/config');
    expect(paths['/api/config']).toHaveProperty('get');

    // Wishes
    expect(paths).toHaveProperty('/api/wishes');
    expect(paths['/api/wishes']).toHaveProperty('get');
    expect(paths['/api/wishes']).toHaveProperty('post');
    expect(paths).toHaveProperty('/api/wishes/random');
    expect(paths['/api/wishes/random']).toHaveProperty('get');
    expect(paths).toHaveProperty('/api/wishes/{id}');
    expect(paths['/api/wishes/{id}']).toHaveProperty('get');
    expect(paths).toHaveProperty('/api/wishes/{id}/manage');
    expect(paths['/api/wishes/{id}/manage']).toHaveProperty('post');
    expect(paths).toHaveProperty('/api/wishes/{id}/deactivate');
    expect(paths['/api/wishes/{id}/deactivate']).toHaveProperty('post');
    expect(paths).toHaveProperty('/api/wishes/{id}/reactivate');
    expect(paths['/api/wishes/{id}/reactivate']).toHaveProperty('post');
    expect(paths).toHaveProperty('/api/wishes/{id}/claim');
    expect(paths['/api/wishes/{id}/claim']).toHaveProperty('post');
    expect(paths).toHaveProperty('/api/wishes/{id}/flag');
    expect(paths['/api/wishes/{id}/flag']).toHaveProperty('post');
    expect(paths).toHaveProperty('/api/wishes/exclusions');
    expect(paths['/api/wishes/exclusions']).toHaveProperty('get');
    expect(paths).toHaveProperty('/api/wishes/exclusions/list');
    expect(paths['/api/wishes/exclusions/list']).toHaveProperty('get');
    expect(paths).toHaveProperty('/api/wishes/exclusions/import');
    expect(paths['/api/wishes/exclusions/import']).toHaveProperty('post');
    expect(paths).toHaveProperty('/api/wishes/{id}/exclude');
    expect(paths['/api/wishes/{id}/exclude']).toHaveProperty('post');
    expect(paths['/api/wishes/{id}/exclude']).toHaveProperty('delete');

    // Wishmail
    expect(paths).toHaveProperty('/api/wishes/{id}/mail');
    expect(paths['/api/wishes/{id}/mail']).toHaveProperty('get');
    expect(paths['/api/wishes/{id}/mail']).toHaveProperty('post');
    expect(paths).toHaveProperty('/api/wishes/{id}/mail/{mailId}/read');
    expect(paths['/api/wishes/{id}/mail/{mailId}/read']).toHaveProperty('post');
    expect(paths).toHaveProperty('/api/wishes/{id}/mail/{mailId}');
    expect(paths['/api/wishes/{id}/mail/{mailId}']).toHaveProperty('delete');

    // Users & Auth
    expect(paths).toHaveProperty('/api/users/exists');
    expect(paths['/api/users/exists']).toHaveProperty('get');
    expect(paths).toHaveProperty('/api/users/register');
    expect(paths['/api/users/register']).toHaveProperty('post');
    expect(paths).toHaveProperty('/api/users/login');
    expect(paths['/api/users/login']).toHaveProperty('post');
    expect(paths).toHaveProperty('/api/users/logout');
    expect(paths['/api/users/logout']).toHaveProperty('post');
    expect(paths).toHaveProperty('/api/users/me');
    expect(paths['/api/users/me']).toHaveProperty('get');
    expect(paths['/api/users/me']).toHaveProperty('put');
    expect(paths).toHaveProperty('/api/users/me/wishes');
    expect(paths['/api/users/me/wishes']).toHaveProperty('get');
    expect(paths).toHaveProperty('/api/users/me/delete-preview');
    expect(paths['/api/users/me/delete-preview']).toHaveProperty('get');
    expect(paths).toHaveProperty('/api/users/me/delete');
    expect(paths['/api/users/me/delete']).toHaveProperty('post');
    expect(paths).toHaveProperty('/api/users/me/deactivate');
    expect(paths['/api/users/me/deactivate']).toHaveProperty('post');
    expect(paths).toHaveProperty('/api/users/me/reactivate');
    expect(paths['/api/users/me/reactivate']).toHaveProperty('post');

    // Rules Engine
    expect(paths).toHaveProperty('/api/rules');
    expect(paths['/api/rules']).toHaveProperty('get');
    expect(paths['/api/rules']).toHaveProperty('post');
    expect(paths).toHaveProperty('/api/rules/check-conflicts');
    expect(paths['/api/rules/check-conflicts']).toHaveProperty('post');
    expect(paths).toHaveProperty('/api/rules/{id}');
    expect(paths['/api/rules/{id}']).toHaveProperty('put');
    expect(paths['/api/rules/{id}']).toHaveProperty('delete');

    // Admin
    expect(paths).toHaveProperty('/api/admin/flags');
    expect(paths['/api/admin/flags']).toHaveProperty('get');
    expect(paths).toHaveProperty('/api/admin/wishes/{id}/remove');
    expect(paths['/api/admin/wishes/{id}/remove']).toHaveProperty('post');
    expect(paths).toHaveProperty('/api/admin/wishes/{id}/clear-flag');
    expect(paths['/api/admin/wishes/{id}/clear-flag']).toHaveProperty('post');
    expect(paths).toHaveProperty('/api/admin/wishes/clear-all-flags');
    expect(paths['/api/admin/wishes/clear-all-flags']).toHaveProperty('post');
    expect(paths).toHaveProperty('/api/admin/users');
    expect(paths['/api/admin/users']).toHaveProperty('get');
    expect(paths).toHaveProperty('/api/admin/users/{id}/role');
    expect(paths['/api/admin/users/{id}/role']).toHaveProperty('post');
    expect(paths).toHaveProperty('/api/admin/users/{id}/delete-preview');
    expect(paths['/api/admin/users/{id}/delete-preview']).toHaveProperty('get');
    expect(paths).toHaveProperty('/api/admin/users/{id}/delete');
    expect(paths['/api/admin/users/{id}/delete']).toHaveProperty('post');
    expect(paths).toHaveProperty('/api/admin/users/{username}/reset-password');
    expect(paths['/api/admin/users/{username}/reset-password']).toHaveProperty('post');
    expect(paths).toHaveProperty('/api/admin/reset-demo');
    expect(paths['/api/admin/reset-demo']).toHaveProperty('post');
    expect(paths).toHaveProperty('/api/admin/reset-rules');
    expect(paths['/api/admin/reset-rules']).toHaveProperty('post');
    expect(paths).toHaveProperty('/api/admin/logs');
    expect(paths['/api/admin/logs']).toHaveProperty('get');
    expect(paths).toHaveProperty('/api/admin/config');
    expect(paths['/api/admin/config']).toHaveProperty('get');
    expect(paths).toHaveProperty('/api/admin/local-metrics');
    expect(paths['/api/admin/local-metrics']).toHaveProperty('get');
    expect(paths).toHaveProperty('/api/admin/aws-metrics');
    expect(paths['/api/admin/aws-metrics']).toHaveProperty('get');

    // Captive Portal
    expect(paths).toHaveProperty('/api/captive-portal');
    expect(paths['/api/captive-portal']).toHaveProperty('get');
    expect(paths).toHaveProperty('/api/captive-portal/accept');
    expect(paths['/api/captive-portal/accept']).toHaveProperty('post');
  });

  it('caches the document in production environment', () => {
    const originalEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'production';
      const doc1 = getOpenApiDocument();
      const doc2 = getOpenApiDocument();
      expect(doc1).toBe(doc2);
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });

  it('exposes the underlying OpenAPIRegistry instance', () => {
    expect(registry).toBeDefined();
    expect(registry.definitions).toBeDefined();
  });
});

describe('OpenAPI & Scalar HTTP Routes', () => {
  it('GET /openapi.json returns 200 and application/json with spec', async () => {
    const res = await request(app).get('/openapi.json');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body.openapi).toBe('3.0.0');
    expect(res.body.info.title).toBe('Wishboard REST API');
  });

  it('GET /api-docs returns 200 and text/html serving Scalar UI', async () => {
    const res = await request(app).get('/api-docs');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain('Wishboard API Reference');
  });

  it('GET /api/docs returns 200 and text/html serving Scalar UI directly', async () => {
    const res = await request(app).get('/api/docs');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain('Wishboard API Reference');
  });

  it('GET /api/openapi.json returns 200 and application/json with spec', async () => {
    const res = await request(app).get('/api/openapi.json');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body.openapi).toBe('3.0.0');
    expect(res.body.info.title).toBe('Wishboard REST API');
  });
});
