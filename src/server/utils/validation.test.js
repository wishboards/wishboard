import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { z } from 'zod';
import { validateBody, validateQuery, validateParams } from './validation.js';

describe('Validation Middleware', () => {
  const bodySchema = z.object({
    title: z.string().min(3, { message: 'Title must be at least 3 chars.' }),
    count: z.number().optional(),
  });

  const querySchema = z.object({
    page: z.string().transform((v) => parseInt(v, 10)),
  });

  const paramsSchema = z.object({
    id: z.string().min(1, { message: 'ID is required.' }),
  });

  it('passes valid request body and sets req.validatedBody', async () => {
    const app = express();
    app.use(express.json());
    app.post('/test', validateBody(bodySchema), (req, res) => {
      res.json({ validated: req.validatedBody });
    });

    const res = await request(app).post('/test').send({ title: 'Hello', count: 5 });
    expect(res.status).toBe(200);
    expect(res.body.validated).toEqual({ title: 'Hello', count: 5 });
  });

  it('rejects invalid request body with 400 and first issue message', async () => {
    const app = express();
    app.use(express.json());
    app.post('/test', validateBody(bodySchema), (req, res) => {
      res.json({ ok: true });
    });

    const res = await request(app).post('/test').send({ title: 'Hi' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Title must be at least 3 chars.');
    expect(res.body.details).toBeDefined();
  });

  it('handles default error message when issue has no message in validateBody', async () => {
    const app = express();
    app.use(express.json());
    const mockSchema = {
      safeParse: () => ({ success: false, error: { issues: [{}] } }),
    };
    app.post('/test', validateBody(mockSchema), (req, res) => res.json({ ok: true }));

    const res = await request(app).post('/test').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid request body.');
  });

  it('passes valid query and sets req.validatedQuery', async () => {
    const app = express();
    app.get('/test', validateQuery(querySchema), (req, res) => {
      res.json({ page: req.validatedQuery.page });
    });

    const res = await request(app).get('/test?page=2');
    expect(res.status).toBe(200);
    expect(res.body.page).toBe(2);
  });

  it('rejects invalid query parameters with 400', async () => {
    const app = express();
    const strictQuery = z.object({
      filter: z.string().min(1, { message: 'Filter cannot be empty.' }),
    });
    app.get('/test', validateQuery(strictQuery), (req, res) => res.json({ ok: true }));

    const res = await request(app).get('/test?filter=');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Filter cannot be empty.');
  });

  it('handles default error message in validateQuery', async () => {
    const app = express();
    const mockSchema = {
      safeParse: () => ({ success: false, error: { issues: [{}] } }),
    };
    app.get('/test', validateQuery(mockSchema), (req, res) => res.json({ ok: true }));

    const res = await request(app).get('/test');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid query parameters.');
  });

  it('passes valid params and sets req.validatedParams', async () => {
    const app = express();
    app.get('/test/:id', validateParams(paramsSchema), (req, res) => {
      res.json({ id: req.validatedParams.id });
    });

    const res = await request(app).get('/test/item_123');
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('item_123');
  });

  it('rejects invalid params with 400', async () => {
    const app = express();
    const strictParams = z.object({
      id: z.string().regex(/^\d+$/, { message: 'ID must be numeric.' }),
    });
    app.get('/test/:id', validateParams(strictParams), (req, res) => res.json({ ok: true }));

    const res = await request(app).get('/test/abc');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('ID must be numeric.');
  });

  it('handles default error message in validateParams', async () => {
    const app = express();
    const mockSchema = {
      safeParse: () => ({ success: false, error: { issues: [{}] } }),
    };
    app.get('/test/:id', validateParams(mockSchema), (req, res) => res.json({ ok: true }));

    const res = await request(app).get('/test/123');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid URL parameters.');
  });
});
