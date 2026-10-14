import { z } from 'zod';
import {
  extendZodWithOpenApi,
  OpenAPIRegistry,
  OpenApiGeneratorV3,
} from '@asteasolutions/zod-to-openapi';

extendZodWithOpenApi(z);

const registry = new OpenAPIRegistry();

// Security Schemes
registry.registerComponent('securitySchemes', 'BearerAuth', {
  type: 'http',
  scheme: 'bearer',
  description: 'Session token obtained from POST /api/users/login.',
});

registry.registerComponent('securitySchemes', 'PassphraseAuth', {
  type: 'apiKey',
  in: 'header',
  name: 'X-Passphrase',
  description: 'Three-word local passphrase used to manage created wishes and wishmail.',
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
    content: z
      .string({ required_error: 'Wish content is required.' })
      .trim()
      .min(1, { message: 'Wish content is required.' })
      .max(500)
      .openapi({ example: 'Looking for board game buddies!' }),
    author: z.string().max(100).optional().openapi({ example: 'Alex' }),
    creator_genders: z.union([z.string(), z.array(z.string())]).optional(),
    creator_orientations: z.union([z.string(), z.array(z.string())]).optional(),
    creator_roles: z.union([z.string(), z.array(z.string())]).optional(),
    desired_genders: z.union([z.string(), z.array(z.string())]).optional(),
    desired_orientations: z.union([z.string(), z.array(z.string())]).optional(),
    desired_roles: z.union([z.string(), z.array(z.string())]).optional(),
    creator_attributes: z.any().optional(),
    desired_attributes: z.any().optional(),
    contacts: z.any().optional(),
    contact: z.string().max(255).optional().openapi({ example: 'Discord: @alex' }),
    allow_wishmail: z.union([z.boolean(), z.string(), z.number()]).optional().default(true),
    wishmail_enabled: z.union([z.boolean(), z.string(), z.number()]).optional(),
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
  z
    .object({
      content: z
        .string()
        .trim()
        .min(1, { message: 'Mail content is required.' })
        .max(1000)
        .optional()
        .openapi({ example: 'Hey! Would love to fulfill your wish.' }),
      message: z.string().trim().max(1000).optional(),
      return_contacts: z.any().optional(),
      senderContact: z.string().max(255).optional().openapi({ example: 'Telegram: @gamer' }),
    })
    .refine((data) => Boolean(data.content?.trim() || data.message?.trim()), {
      message: 'Mail content is required.',
      path: ['content'],
    })
);

export const UsernameCheckQuerySchema = registry.register(
  'UsernameCheckQuery',
  z.object({
    username: z
      .string({ required_error: 'Username is required.' })
      .trim()
      .min(1, { message: 'Username is required.' }),
  })
);

export const RegisterUserInputSchema = registry.register(
  'RegisterUserInput',
  z.object({
    username: z
      .string({ required_error: 'Username is required.' })
      .trim()
      .min(1, { message: 'Username is required.' })
      .max(100),
    passphrase: z.string().optional(),
    contacts: z.any().optional(),
    wishmail_enabled: z.any().optional(),
    identity_attributes: z.any().optional(),
  })
);

export const LoginInputSchema = registry.register(
  'LoginInput',
  z.object({
    username: z.string({ required_error: 'Username is required.' }).openapi({ example: 'admin' }),
    passphrase: z
      .string({ required_error: 'Passphrase is required.' })
      .openapi({ example: 'apple-river-forest' }),
  })
);

export const UserProfileSchema = registry.register(
  'UserProfile',
  z.object({
    id: z.string().openapi({ example: 'usr_8a92b' }),
    username: z.string().openapi({ example: 'admin' }),
    role: z.enum(['user', 'admin']).openapi({ example: 'admin' }),
    is_active: z.boolean().openapi({ example: true }),
    token: z.string().optional().openapi({ example: '49f8a29b4e12c...' }),
    contacts: z.array(z.string()).default([]),
    wishmail_enabled: z.boolean().default(true),
    identity_attributes: z.record(z.string(), z.any()).default({}),
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
  method: 'post',
  path: '/api/wishes/{id}/manage',
  summary: 'Manage wish (update or delete)',
  description:
    'Updates or deletes an existing wish using its creator secret passphrase or authenticated user session.',
  parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            secret: z.string().optional().openapi({ example: 'apple-river-forest' }),
            action: z.enum(['update', 'delete']).optional().openapi({ example: 'delete' }),
            content: z.string().optional(),
            contacts: z.any().optional(),
            wishmail_enabled: z.boolean().optional(),
            new_passphrase: z.string().optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Wish updated or deleted successfully',
      content: {
        'application/json': {
          schema: z.object({
            success: z.boolean(),
            newSecret: z.string().nullable().optional(),
          }),
        },
      },
    },
    401: {
      description: 'Secret token required',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
    403: {
      description: 'Invalid secret token or unauthorized',
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
  method: 'get',
  path: '/api/users/exists',
  summary: 'Check if a username exists',
  parameters: [
    {
      name: 'username',
      in: 'query',
      required: true,
      schema: { type: 'string' },
      description: 'Username to check',
    },
  ],
  responses: {
    200: {
      description: 'Username existence status',
      content: { 'application/json': { schema: z.object({ exists: z.boolean() }) } },
    },
    400: {
      description: 'Missing username',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/users/register',
  summary: 'Register a new user account',
  request: {
    body: {
      content: {
        'application/json': { schema: RegisterUserInputSchema },
      },
    },
  },
  responses: {
    201: {
      description: 'User registered successfully',
      content: { 'application/json': { schema: UserProfileSchema } },
    },
    400: {
      description: 'Validation error or username taken',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/users/login',
  summary: 'User & Admin login',
  description:
    'Authenticates user or admin credentials and returns an active session token for Bearer authentication.',
  request: {
    body: {
      content: {
        'application/json': { schema: LoginInputSchema },
      },
    },
  },
  responses: {
    200: {
      description: 'Login successful',
      content: { 'application/json': { schema: UserProfileSchema } },
    },
    401: {
      description: 'Invalid credentials',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/users/me',
  summary: 'Get current user profile',
  security: [{ BearerAuth: [] }],
  responses: {
    200: {
      description: 'Current user profile',
      content: { 'application/json': { schema: UserProfileSchema } },
    },
    401: {
      description: 'Unauthorized',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/users/me/wishes',
  summary: 'Get all wishes associated with authenticated user',
  security: [{ BearerAuth: [] }],
  responses: {
    200: {
      description: 'User wishes list',
      content: { 'application/json': { schema: z.array(WishSchema) } },
    },
    401: {
      description: 'Unauthorized',
      content: { 'application/json': { schema: ErrorResponseSchema } },
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
  method: 'get',
  path: '/api/admin/flags',
  summary: 'List flagged wishes',
  security: [{ BearerAuth: [] }],
  responses: {
    200: {
      description: 'List of flagged wishes awaiting moderation',
      content: { 'application/json': { schema: z.array(z.any()) } },
    },
    403: {
      description: 'Forbidden: requires admin role',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/admin/logs',
  summary: 'Retrieve recent server logs',
  security: [{ BearerAuth: [] }],
  responses: {
    200: {
      description: 'Recent server log entries',
      content: { 'application/json': { schema: z.array(z.any()) } },
    },
    403: {
      description: 'Forbidden: requires admin role',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/admin/local-metrics',
  summary: 'Retrieve local performance and request metrics',
  security: [{ BearerAuth: [] }],
  responses: {
    200: {
      description: 'Local metrics summary',
      content: { 'application/json': { schema: z.record(z.string(), z.any()) } },
    },
    403: {
      description: 'Forbidden: requires admin role',
      content: { 'application/json': { schema: ErrorResponseSchema } },
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
      version: '1.31.0',
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
