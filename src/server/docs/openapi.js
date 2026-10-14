import { z } from 'zod';
import {
  extendZodWithOpenApi,
  OpenAPIRegistry,
  OpenApiGeneratorV3,
} from '@asteasolutions/zod-to-openapi';

extendZodWithOpenApi(z);

const registry = new OpenAPIRegistry();

// Security Schemes
registry.registerComponent('securitySchemes', 'PassphraseAuth', {
  type: 'apiKey',
  in: 'header',
  name: 'X-Passphrase',
  description: 'Three-word local passphrase used to manage created wishes and wishmail.',
});

registry.registerComponent('securitySchemes', 'AdminAuth', {
  type: 'apiKey',
  in: 'header',
  name: 'X-Admin-Token',
  description: 'Admin session token received after logging in via /api/admin/login.',
});

// Common Schemas
export const ErrorResponseSchema = registry.register(
  'ErrorResponse',
  z.object({
    error: z.string().openapi({ example: 'Invalid request or resource not found.' }),
  })
);

export const WishSchema = registry.register(
  'Wish',
  z.object({
    id: z.string().openapi({ example: 'wish_k9x2m' }),
    content: z.string().openapi({ example: 'Looking for a board game group on Saturday evening!' }),
    author: z.string().optional().openapi({ example: 'Alex' }),
    created_at: z.string().openapi({ example: '2026-10-13T20:00:00.000Z' }),
    status: z.enum(['active', 'flagged', 'hidden', 'fulfilled']).openapi({ example: 'active' }),
    creator_genders: z
      .array(z.string())
      .optional()
      .openapi({ example: ['non-binary'] }),
    creator_orientations: z
      .array(z.string())
      .optional()
      .openapi({ example: ['queer'] }),
    creator_roles: z
      .array(z.string())
      .optional()
      .openapi({ example: ['switch'] }),
    desired_genders: z
      .array(z.string())
      .optional()
      .openapi({ example: ['any'] }),
    desired_orientations: z.array(z.string()).optional(),
    desired_roles: z.array(z.string()).optional(),
    contact: z.string().optional().openapi({ example: 'alex@example.com' }),
    allow_wishmail: z.boolean().default(true).openapi({ example: true }),
    image_url: z.string().nullable().optional().openapi({ example: '/images/card_123.jpg' }),
  })
);

export const CreateWishInputSchema = registry.register(
  'CreateWishInput',
  z.object({
    content: z.string().min(1).max(500).openapi({ example: 'Looking for board game buddies!' }),
    author: z.string().max(100).optional().openapi({ example: 'Alex' }),
    creator_genders: z.union([z.string(), z.array(z.string())]).optional(),
    creator_orientations: z.union([z.string(), z.array(z.string())]).optional(),
    creator_roles: z.union([z.string(), z.array(z.string())]).optional(),
    desired_genders: z.union([z.string(), z.array(z.string())]).optional(),
    desired_orientations: z.union([z.string(), z.array(z.string())]).optional(),
    desired_roles: z.union([z.string(), z.array(z.string())]).optional(),
    contact: z.string().max(255).optional().openapi({ example: 'Discord: @alex' }),
    allow_wishmail: z.union([z.boolean(), z.string()]).optional().default(true),
    passphrase: z.string().optional().openapi({ example: 'apple-river-forest' }),
  })
);

export const WishmailMessageSchema = registry.register(
  'WishmailMessage',
  z.object({
    id: z.string().openapi({ example: 'mail_7z1q' }),
    wish_id: z.string().openapi({ example: 'wish_k9x2m' }),
    message: z
      .string()
      .openapi({ example: 'Hey! I saw your wish and would love to join your game.' }),
    sender_contact: z.string().optional().openapi({ example: 'Signal: @sam' }),
    created_at: z.string().openapi({ example: '2026-10-13T20:15:00.000Z' }),
    read: z.boolean().default(false),
  })
);

export const SendWishmailInputSchema = registry.register(
  'SendWishmailInput',
  z.object({
    message: z
      .string()
      .min(1)
      .max(1000)
      .openapi({ example: 'Hey! Would love to fulfill your wish.' }),
    senderContact: z.string().max(255).optional().openapi({ example: 'Telegram: @gamer' }),
  })
);

export const ConfigResponseSchema = registry.register(
  'ConfigResponse',
  z.object({
    domain: z.string().openapi({ example: 'wishboards.local' }),
    realtimeProvider: z.string().openapi({ example: 'socketio' }),
    apIp: z.string().openapi({ example: '192.168.4.1' }),
    isServerless: z.boolean().openapi({ example: false }),
  })
);

export const RuleSchema = registry.register(
  'MatchmakingRule',
  z.object({
    id: z.union([z.string(), z.number()]).openapi({ example: 1 }),
    type: z
      .enum(['enrichment', 'acceptance', 'expansion', 'cross_match'])
      .openapi({ example: 'expansion' }),
    trigger_category: z.string().openapi({ example: 'orientation' }),
    trigger_value: z.string().openapi({ example: 'pansexual' }),
    target_category: z.string().openapi({ example: 'orientation' }),
    target_value: z.string().openapi({ example: 'all' }),
    active: z.union([z.boolean(), z.number()]).openapi({ example: 1 }),
  })
);

export const UserAccountSchema = registry.register(
  'UserAccount',
  z.object({
    passphrase: z.string().openapi({ example: 'apple-river-forest' }),
    wish_count: z.number().openapi({ example: 2 }),
    wishes: z.array(WishSchema),
  })
);

export const AdminOverviewSchema = registry.register(
  'AdminOverview',
  z.object({
    totalWishes: z.number().openapi({ example: 42 }),
    activeWishes: z.number().openapi({ example: 38 }),
    flaggedWishes: z.number().openapi({ example: 2 }),
    userCount: z.number().openapi({ example: 15 }),
    rulesCount: z.number().openapi({ example: 24 }),
  })
);

// Register Paths

// /api/config
registry.registerPath({
  method: 'get',
  path: '/api/config',
  summary: 'Retrieve runtime configuration',
  description:
    'Returns network, domain, and realtime WebSocket provider settings for kiosks and clients.',
  responses: {
    200: {
      description: 'Domain and runtime configuration',
      content: { 'application/json': { schema: ConfigResponseSchema } },
    },
  },
});

// /api/wishes
registry.registerPath({
  method: 'get',
  path: '/api/wishes',
  summary: 'List and search active wishes',
  description:
    'Search active wishes with identity filtering, matchmaking rules, and text query matching.',
  parameters: [
    { name: 'search', in: 'query', schema: { type: 'string' }, description: 'Text search query' },
    {
      name: 'gender',
      in: 'query',
      schema: { type: 'string' },
      description: 'Filter by creator gender',
    },
    {
      name: 'orientation',
      in: 'query',
      schema: { type: 'string' },
      description: 'Filter by creator orientation',
    },
    {
      name: 'role',
      in: 'query',
      schema: { type: 'string' },
      description: 'Filter by creator role',
    },
    {
      name: 'limit',
      in: 'query',
      schema: { type: 'integer', default: 50 },
      description: 'Page limit',
    },
    {
      name: 'offset',
      in: 'query',
      schema: { type: 'integer', default: 0 },
      description: 'Page offset',
    },
  ],
  responses: {
    200: {
      description: 'List of matching wishes',
      content: { 'application/json': { schema: z.array(WishSchema) } },
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/wishes',
  summary: 'Submit a new wish',
  description:
    'Submits a new wish to the board. Generates or claims a local three-word passphrase for management.',
  request: {
    body: {
      content: {
        'application/json': { schema: CreateWishInputSchema },
        'multipart/form-data': { schema: CreateWishInputSchema },
      },
    },
  },
  responses: {
    201: {
      description: 'Wish successfully created',
      content: {
        'application/json': {
          schema: z.object({
            message: z.string(),
            wish: WishSchema,
            passphrase: z.string(),
          }),
        },
      },
    },
    400: {
      description: 'Validation error',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/wishes/{id}',
  summary: 'Retrieve single wish details',
  parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
  responses: {
    200: {
      description: 'Wish details',
      content: { 'application/json': { schema: WishSchema } },
    },
    404: {
      description: 'Wish not found',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/wishes/{id}',
  summary: 'Delete or withdraw a wish',
  security: [{ PassphraseAuth: [] }],
  parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({ passphrase: z.string() }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Wish deleted',
      content: { 'application/json': { schema: z.object({ message: z.string() }) } },
    },
    403: {
      description: 'Incorrect passphrase',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/wishes/{id}/flag',
  summary: 'Report / flag an inappropriate wish',
  parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({ reason: z.string().optional() }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Wish flagged for admin review',
      content: { 'application/json': { schema: z.object({ message: z.string() }) } },
    },
  },
});

// /api/wishes/{id}/mail
registry.registerPath({
  method: 'post',
  path: '/api/wishes/{id}/mail',
  summary: 'Send Wishmail to a wish author',
  parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
  request: {
    body: {
      content: {
        'application/json': { schema: SendWishmailInputSchema },
      },
    },
  },
  responses: {
    201: {
      description: 'Wishmail sent successfully',
      content: {
        'application/json': {
          schema: z.object({ message: z.string(), mail: WishmailMessageSchema }),
        },
      },
    },
    400: {
      description: 'Wishmail disabled or invalid request',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/wishes/{id}/mail',
  summary: 'Retrieve Wishmail for a wish',
  security: [{ PassphraseAuth: [] }],
  parameters: [
    { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
    {
      name: 'passphrase',
      in: 'query',
      schema: { type: 'string' },
      description: 'Passphrase for authentication',
    },
  ],
  responses: {
    200: {
      description: 'List of wishmail messages',
      content: { 'application/json': { schema: z.array(WishmailMessageSchema) } },
    },
    403: {
      description: 'Forbidden / invalid passphrase',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
  },
});

// /api/users
registry.registerPath({
  method: 'post',
  path: '/api/users/auth',
  summary: 'Authenticate with a passphrase',
  description: 'Validates a three-word passphrase and returns account summary.',
  request: {
    body: {
      content: {
        'application/json': { schema: z.object({ passphrase: z.string() }) },
      },
    },
  },
  responses: {
    200: {
      description: 'Authenticated user account',
      content: { 'application/json': { schema: UserAccountSchema } },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/users/me/wishes',
  summary: 'Get all wishes associated with authenticated passphrase',
  security: [{ PassphraseAuth: [] }],
  responses: {
    200: {
      description: 'User wishes list',
      content: { 'application/json': { schema: z.array(WishSchema) } },
    },
  },
});

// /api/rules
registry.registerPath({
  method: 'get',
  path: '/api/rules',
  summary: 'List active matchmaking rules',
  description: 'Returns identity enrichment, acceptance, expansion, and cross-matching rules.',
  responses: {
    200: {
      description: 'Active matchmaking rules',
      content: { 'application/json': { schema: z.array(RuleSchema) } },
    },
  },
});

// /api/admin
registry.registerPath({
  method: 'post',
  path: '/api/admin/login',
  summary: 'Admin login',
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            username: z.string().default('admin'),
            passphrase: z.string(),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Admin authenticated',
      content: {
        'application/json': { schema: z.object({ message: z.string(), token: z.string() }) },
      },
    },
    401: {
      description: 'Invalid credentials',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/admin/overview',
  summary: 'System statistics and overview',
  security: [{ AdminAuth: [] }],
  responses: {
    200: {
      description: 'System overview statistics',
      content: { 'application/json': { schema: AdminOverviewSchema } },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/admin/local-metrics',
  summary: 'Retrieve local performance and request metrics',
  security: [{ AdminAuth: [] }],
  responses: {
    200: {
      description: 'Local metrics summary',
      content: { 'application/json': { schema: z.record(z.string(), z.any()) } },
    },
  },
});

let cachedDocument = null;

/**
 * Generates and caches the OpenAPI 3.0 specification for the Wishboard API.
 * @returns {object} OpenAPI document
 */
export function getOpenApiDocument() {
  if (cachedDocument && process.env.NODE_ENV === 'production') {
    return cachedDocument;
  }

  const generator = new OpenApiGeneratorV3(registry.definitions);
  cachedDocument = generator.generateDocument({
    openapi: '3.0.0',
    info: {
      title: 'Wishboard REST API',
      version: '1.30.1',
      description:
        'Interactive OpenAPI reference for the Wishboard event matchmaking platform. Provides endpoints for wish submissions, identity matching, Wishmail messaging, admin moderation, and runtime configuration.',
      contact: {
        name: 'Wishboard Project',
        url: 'https://wishboards.app',
      },
    },
    servers: [
      {
        url: '/',
        description: 'Current Wishboard Server Instance',
      },
    ],
  });

  return cachedDocument;
}

export { registry };
