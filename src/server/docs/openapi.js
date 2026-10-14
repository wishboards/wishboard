import { z } from 'zod';
import {
  extendZodWithOpenApi,
  OpenAPIRegistry,
  OpenApiGeneratorV3,
} from '@asteasolutions/zod-to-openapi';

extendZodWithOpenApi(z);

const registry = new OpenAPIRegistry();

// ── Security Schemes ──────────────────────────────────────────────────────────

registry.registerComponent('securitySchemes', 'BearerAuth', {
  type: 'http',
  scheme: 'bearer',
  description: 'Session token obtained from POST /api/users/login (stored in session database).',
});

registry.registerComponent('securitySchemes', 'PassphraseAuth', {
  type: 'apiKey',
  in: 'header',
  name: 'X-Passphrase',
  description: 'Three-word local passphrase used to manage created wishes and wishmail.',
});

// ── Common Schemas ────────────────────────────────────────────────────────────

export const ErrorResponseSchema = registry.register(
  'ErrorResponse',
  z.object({
    error: z.string().openapi({ example: 'Invalid request or resource not found.' }),
    details: z.array(z.any()).optional(),
  })
);

export const SuccessResponseSchema = registry.register(
  'SuccessResponse',
  z.object({
    success: z.boolean().openapi({ example: true }),
    message: z.string().optional().openapi({ example: 'Operation completed successfully.' }),
    id: z.string().optional().openapi({ example: 'rule_a1b2c3d4' }),
    newSecret: z.string().nullable().optional().openapi({ example: 'apple-river-forest' }),
  })
);

// ── Wish Schemas ──────────────────────────────────────────────────────────────

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

export const ManageWishInputSchema = registry.register(
  'ManageWishInput',
  z.object({
    secret: z.string().optional().openapi({ example: 'apple-river-forest' }),
    action: z.enum(['update', 'delete']).optional().openapi({ example: 'update' }),
    content: z.string().max(500).optional().openapi({ example: 'Updated wish text' }),
    contacts: z.any().optional(),
    wishmail_enabled: z.boolean().optional(),
    new_passphrase: z.string().optional().openapi({ example: 'ocean-sun-meadow' }),
  })
);

export const ClaimWishInputSchema = registry.register(
  'ClaimWishInput',
  z.object({
    passphrase: z
      .string({ required_error: 'Passphrase is required.' })
      .trim()
      .min(1, { message: 'Passphrase is required.' })
      .openapi({ example: 'apple-river-forest' }),
  })
);

export const ExclusionImportInputSchema = registry.register(
  'ExclusionImportInput',
  z.object({
    exclusions: z.array(z.string()).openapi({ example: ['wish_k9x2m', 'wish_abc12'] }),
  })
);

// ── Wishmail Schemas ──────────────────────────────────────────────────────────

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

// ── User Schemas ──────────────────────────────────────────────────────────────

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
    username: z
      .string({ required_error: 'Username and passphrase are required.' })
      .trim()
      .min(1, { message: 'Username and passphrase are required.' })
      .openapi({ example: 'admin' }),
    passphrase: z
      .string({ required_error: 'Username and passphrase are required.' })
      .trim()
      .min(1, { message: 'Username and passphrase are required.' })
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

export const UpdateUserInputSchema = registry.register(
  'UpdateUserInput',
  z.object({
    contacts: z.any().optional(),
    wishmail_enabled: z.union([z.boolean(), z.number()]).optional(),
    identity_attributes: z.record(z.string(), z.any()).optional(),
  })
);

export const UserDeletePreviewSchema = registry.register(
  'UserDeletePreview',
  z.object({
    wishes_count: z.number().openapi({ example: 2 }),
    wishmails_count: z.number().openapi({ example: 5 }),
  })
);

// ── Rule Schemas ──────────────────────────────────────────────────────────────

export const RuleSchema = registry.register(
  'MatchmakingRule',
  z.object({
    id: z.string().openapi({ example: 'rule_k7m2x9' }),
    rule_type: z
      .enum(['enrichment', 'acceptance', 'expansion', 'cross_match'])
      .openapi({ example: 'expansion' }),
    trigger_attribute: z.string().openapi({ example: 'orientation' }),
    trigger_value: z.string().openapi({ example: 'pansexual' }),
    context_attribute: z.string().nullable().optional(),
    context_value: z.string().nullable().optional(),
    target_attribute: z.string().openapi({ example: 'orientation' }),
    target_value: z.string().openapi({ example: 'all' }),
  })
);

export const CheckRuleConflictsInputSchema = registry.register(
  'CheckRuleConflictsInput',
  z.object({
    attributes: z
      .record(z.string(), z.any(), { required_error: 'Attributes object is required.' })
      .openapi({ example: { gender: ['woman'], orientation: ['lesbian'] } }),
  })
);

export const CreateRuleInputSchema = registry.register(
  'CreateRuleInput',
  z.object({
    rule_type: z
      .enum(['enrichment', 'acceptance', 'expansion', 'cross_match'])
      .openapi({ example: 'expansion' }),
    trigger_attribute: z.string().openapi({ example: 'orientation' }),
    trigger_value: z.string().openapi({ example: 'pansexual' }),
    context_attribute: z.string().optional(),
    context_value: z.string().optional(),
    target_attribute: z.string().openapi({ example: 'orientation' }),
    target_value: z.string().openapi({ example: 'all' }),
  })
);

// ── Admin & Hardware Schemas ──────────────────────────────────────────────────

export const AdminUserRoleInputSchema = registry.register(
  'AdminUserRoleInput',
  z.object({
    role: z.enum(['user', 'admin']).openapi({ example: 'admin' }),
  })
);

export const ResetPasswordInputSchema = registry.register(
  'ResetPasswordInput',
  z.object({
    passphrase: z.string().optional().openapi({ example: 'new-passphrase' }),
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

export const CaptivePortalStatusSchema = registry.register(
  'CaptivePortalStatus',
  z.object({
    captive: z.boolean().openapi({ example: false }),
    'user-portal-url': z.string().openapi({ example: 'https://wishboards.local/' }),
    'venue-info-url': z.string().openapi({ example: 'https://wishboards.local/' }),
  })
);

// ── Registration Helpers (Prevents SonarQube Duplicate Blocks) ────────────────

const createRouteHelper =
  (tag, security = []) =>
  ({
    method,
    path,
    summary,
    description,
    requestSchema,
    responseSchema,
    status = 200,
    params = [],
  }) => {
    const responses = {
      [status]: {
        description: `${summary} response`,
        content: responseSchema ? { 'application/json': { schema: responseSchema } } : undefined,
      },
    };

    if (security.length > 0) {
      responses[401] = {
        description: 'Unauthorized',
        content: { 'application/json': { schema: ErrorResponseSchema } },
      };
      responses[403] = {
        description: 'Forbidden',
        content: { 'application/json': { schema: ErrorResponseSchema } },
      };
    }

    const pathItem = {
      method,
      path,
      tags: [tag],
      summary,
      description: description ?? summary,
      parameters: params,
      responses,
    };

    if (security.length > 0) {
      pathItem.security = security;
    }

    if (requestSchema) {
      pathItem.request = {
        body: { content: { 'application/json': { schema: requestSchema } } },
      };
    }

    registry.registerPath(pathItem);
  };

const addWishRoute = createRouteHelper('Wishes');
const addWishmailRoute = createRouteHelper('Wishmail');
const addUserRoute = createRouteHelper('Users & Auth');
const addAuthUserRoute = createRouteHelper('Users & Auth', [{ BearerAuth: [] }]);
const addRuleRoute = createRouteHelper('Rules Engine');
const addAdminRuleRoute = createRouteHelper('Rules Engine', [{ BearerAuth: [] }]);
const addAdminRoute = createRouteHelper('Admin', [{ BearerAuth: [] }]);
const addPortalRoute = createRouteHelper('Captive Portal');

// ── 1. Configuration ──────────────────────────────────────────────────────────

registry.registerPath({
  method: 'get',
  path: '/api/config',
  tags: ['Configuration'],
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

// ── 2. Wishes Domain ──────────────────────────────────────────────────────────

addWishRoute({
  method: 'get',
  path: '/api/wishes',
  summary: 'List and search active wishes',
  responseSchema: z.array(WishSchema),
  params: [
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
    { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } },
    { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
  ],
});

registry.registerPath({
  method: 'post',
  path: '/api/wishes',
  tags: ['Wishes'],
  summary: 'Submit a new wish',
  description: 'Submits a new wish to the board with optional image upload.',
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
      description: 'Wish created successfully',
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

addWishRoute({
  method: 'get',
  path: '/api/wishes/random',
  summary: 'Retrieve random active wish',
  description:
    'Fetches a single active wish at random, ideal for kiosk screensavers or hero carousels.',
  responseSchema: WishSchema,
});

addWishRoute({
  method: 'get',
  path: '/api/wishes/{id}',
  summary: 'Retrieve single wish details',
  responseSchema: WishSchema,
  params: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
});

addWishRoute({
  method: 'post',
  path: '/api/wishes/{id}/manage',
  summary: 'Manage wish (update or delete)',
  description:
    'Updates or deletes an existing wish using its creator secret passphrase or authenticated session.',
  requestSchema: ManageWishInputSchema,
  responseSchema: SuccessResponseSchema,
  params: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
});

const registerWishState = (action, desc) => {
  addWishRoute({
    method: 'post',
    path: `/api/wishes/{id}/${action}`,
    summary: `${action.charAt(0).toUpperCase() + action.slice(1)} a wish`,
    description: desc,
    requestSchema: z.object({ secret: z.string().optional() }),
    responseSchema: SuccessResponseSchema,
    params: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
  });
};

registerWishState('deactivate', 'Hides a wish from the public board without deleting its data.');
registerWishState('reactivate', 'Restores a deactivated wish to the active public board.');

addWishRoute({
  method: 'post',
  path: '/api/wishes/{id}/claim',
  summary: 'Claim wish into user account',
  description:
    'Links an anonymously submitted wish to the authenticated user account via secret passphrase.',
  requestSchema: ClaimWishInputSchema,
  responseSchema: SuccessResponseSchema,
  params: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
});

addWishRoute({
  method: 'post',
  path: '/api/wishes/{id}/flag',
  summary: 'Report / flag an inappropriate wish',
  requestSchema: z.object({ reason: z.string().optional() }),
  responseSchema: SuccessResponseSchema,
  params: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
});

addAuthUserRoute({
  method: 'get',
  path: '/api/wishes/exclusions',
  summary: 'List user wish exclusions',
  description: 'Returns full wish objects excluded/hidden by the current user.',
  responseSchema: z.array(WishSchema),
});

addAuthUserRoute({
  method: 'get',
  path: '/api/wishes/exclusions/list',
  summary: 'List user exclusion IDs',
  description:
    'Returns an array of string IDs corresponding to wishes excluded by the current user.',
  responseSchema: z.array(z.string()),
});

addAuthUserRoute({
  method: 'post',
  path: '/api/wishes/exclusions/import',
  summary: 'Bulk import wish exclusions',
  description:
    'Synchronizes client-side localStorage exclusion lists into the persistent user account.',
  requestSchema: ExclusionImportInputSchema,
  responseSchema: SuccessResponseSchema,
});

addAuthUserRoute({
  method: 'post',
  path: '/api/wishes/{id}/exclude',
  summary: 'Exclude / hide a wish',
  description: 'Mutes a specific wish from appearing in the authenticated user feed.',
  responseSchema: SuccessResponseSchema,
  params: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
});

addAuthUserRoute({
  method: 'delete',
  path: '/api/wishes/{id}/exclude',
  summary: 'Remove wish exclusion',
  description: 'Un-mutes a previously excluded wish, restoring it to the user feed.',
  responseSchema: SuccessResponseSchema,
  params: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
});

// ── 3. Wishmail Domain ────────────────────────────────────────────────────────

addWishmailRoute({
  method: 'post',
  path: '/api/wishes/{id}/mail',
  summary: 'Send Wishmail to a wish author',
  status: 201,
  requestSchema: SendWishmailInputSchema,
  responseSchema: z.object({ message: z.string(), mail: WishmailMessageSchema }),
  params: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
});

registry.registerPath({
  method: 'get',
  path: '/api/wishes/{id}/mail',
  tags: ['Wishmail'],
  summary: 'Retrieve Wishmail for a wish',
  security: [{ PassphraseAuth: [] }, { BearerAuth: [] }],
  parameters: [
    { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
    {
      name: 'passphrase',
      in: 'query',
      schema: { type: 'string' },
      description: 'Passphrase for auth',
    },
  ],
  responses: {
    200: {
      description: 'List of wishmail messages',
      content: { 'application/json': { schema: z.array(WishmailMessageSchema) } },
    },
    403: {
      description: 'Forbidden: invalid passphrase',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
  },
});

const addWishmailItemAction = (method, pathSuffix, summary) => {
  registry.registerPath({
    method,
    path: `/api/wishes/{id}/mail/{mailId}${pathSuffix}`,
    tags: ['Wishmail'],
    summary,
    security: [{ PassphraseAuth: [] }, { BearerAuth: [] }],
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
      { name: 'mailId', in: 'path', required: true, schema: { type: 'string' } },
    ],
    responses: {
      200: {
        description: summary,
        content: { 'application/json': { schema: SuccessResponseSchema } },
      },
    },
  });
};

addWishmailItemAction('post', '/read', 'Mark wishmail message as read');
addWishmailItemAction('delete', '', 'Delete wishmail message');

// ── 4. Users & Auth Domain ────────────────────────────────────────────────────

addUserRoute({
  method: 'get',
  path: '/api/users/exists',
  summary: 'Check if a username exists',
  responseSchema: z.object({ exists: z.boolean() }),
  params: [{ name: 'username', in: 'query', required: true, schema: { type: 'string' } }],
});

addUserRoute({
  method: 'post',
  path: '/api/users/register',
  summary: 'Register a new user account',
  status: 201,
  requestSchema: RegisterUserInputSchema,
  responseSchema: UserProfileSchema,
});

addUserRoute({
  method: 'post',
  path: '/api/users/login',
  summary: 'User & Admin login',
  description:
    'Authenticates credentials and returns an active session token for Bearer authentication.',
  requestSchema: LoginInputSchema,
  responseSchema: UserProfileSchema,
});

addAuthUserRoute({
  method: 'post',
  path: '/api/users/logout',
  summary: 'Logout current session',
  description: 'Destroys the current active session token in the database.',
  responseSchema: SuccessResponseSchema,
});

addAuthUserRoute({
  method: 'get',
  path: '/api/users/me',
  summary: 'Get current user profile',
  responseSchema: UserProfileSchema,
});

addAuthUserRoute({
  method: 'put',
  path: '/api/users/me',
  summary: 'Update current user profile',
  requestSchema: UpdateUserInputSchema,
  responseSchema: UserProfileSchema,
});

addAuthUserRoute({
  method: 'get',
  path: '/api/users/me/wishes',
  summary: 'Get all wishes for current user',
  responseSchema: z.array(WishSchema),
});

addAuthUserRoute({
  method: 'get',
  path: '/api/users/me/delete-preview',
  summary: 'Preview user deletion impact',
  responseSchema: UserDeletePreviewSchema,
});

addAuthUserRoute({
  method: 'post',
  path: '/api/users/me/delete',
  summary: 'Permanently delete user account',
  responseSchema: SuccessResponseSchema,
});

addAuthUserRoute({
  method: 'post',
  path: '/api/users/me/deactivate',
  summary: 'Deactivate user account',
  responseSchema: SuccessResponseSchema,
});

addAuthUserRoute({
  method: 'post',
  path: '/api/users/me/reactivate',
  summary: 'Reactivate user account',
  responseSchema: SuccessResponseSchema,
});

// ── 5. Rules Engine Domain ────────────────────────────────────────────────────

addRuleRoute({
  method: 'get',
  path: '/api/rules',
  summary: 'List active matchmaking rules',
  responseSchema: z.array(RuleSchema),
});

addRuleRoute({
  method: 'post',
  path: '/api/rules/check-conflicts',
  summary: 'Check matchmaking rule conflicts',
  requestSchema: CheckRuleConflictsInputSchema,
  responseSchema: z.object({ conflicts: z.array(z.any()) }),
});

addAdminRuleRoute({
  method: 'post',
  path: '/api/rules',
  summary: 'Create matchmaking rule',
  status: 201,
  requestSchema: CreateRuleInputSchema,
  responseSchema: SuccessResponseSchema,
});

addAdminRuleRoute({
  method: 'put',
  path: '/api/rules/{id}',
  summary: 'Update matchmaking rule',
  requestSchema: CreateRuleInputSchema,
  responseSchema: SuccessResponseSchema,
  params: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
});

addAdminRuleRoute({
  method: 'delete',
  path: '/api/rules/{id}',
  summary: 'Delete matchmaking rule',
  responseSchema: SuccessResponseSchema,
  params: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
});

// ── 6. Administration Domain ──────────────────────────────────────────────────

addAdminRoute({
  method: 'get',
  path: '/api/admin/flags',
  summary: 'List flagged wishes',
  responseSchema: z.array(z.any()),
});

addAdminRoute({
  method: 'post',
  path: '/api/admin/wishes/{id}/remove',
  summary: 'Admin remove wish',
  responseSchema: SuccessResponseSchema,
  params: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
});

addAdminRoute({
  method: 'post',
  path: '/api/admin/wishes/{id}/clear-flag',
  summary: 'Admin clear wish flag',
  responseSchema: SuccessResponseSchema,
  params: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
});

addAdminRoute({
  method: 'post',
  path: '/api/admin/wishes/clear-all-flags',
  summary: 'Admin clear all wish flags',
  responseSchema: SuccessResponseSchema,
});

addAdminRoute({
  method: 'get',
  path: '/api/admin/users',
  summary: 'Admin list all users',
  responseSchema: z.array(UserProfileSchema),
});

addAdminRoute({
  method: 'post',
  path: '/api/admin/users/{id}/role',
  summary: 'Admin update user role',
  requestSchema: AdminUserRoleInputSchema,
  responseSchema: SuccessResponseSchema,
  params: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
});

addAdminRoute({
  method: 'get',
  path: '/api/admin/users/{id}/delete-preview',
  summary: 'Admin preview user deletion',
  responseSchema: UserDeletePreviewSchema,
  params: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
});

addAdminRoute({
  method: 'post',
  path: '/api/admin/users/{id}/delete',
  summary: 'Admin delete user',
  responseSchema: SuccessResponseSchema,
  params: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
});

addAdminRoute({
  method: 'post',
  path: '/api/admin/users/{username}/reset-password',
  summary: 'Admin reset user passphrase',
  requestSchema: ResetPasswordInputSchema,
  responseSchema: SuccessResponseSchema,
  params: [{ name: 'username', in: 'path', required: true, schema: { type: 'string' } }],
});

addAdminRoute({
  method: 'post',
  path: '/api/admin/reset-demo',
  summary: 'Admin seed demo wishes',
  responseSchema: SuccessResponseSchema,
});

addAdminRoute({
  method: 'post',
  path: '/api/admin/reset-rules',
  summary: 'Admin reload default rules',
  responseSchema: SuccessResponseSchema,
});

addAdminRoute({
  method: 'get',
  path: '/api/admin/logs',
  summary: 'Retrieve recent server logs',
  responseSchema: z.array(z.any()),
});

addAdminRoute({
  method: 'get',
  path: '/api/admin/config',
  summary: 'Admin inspect server profile & config',
  responseSchema: z.record(z.string(), z.any()),
});

addAdminRoute({
  method: 'get',
  path: '/api/admin/local-metrics',
  summary: 'Retrieve local performance metrics',
  description:
    'In-process CPU/memory/HTTP metrics. Note: Available in Kiosk/Local mode only; returns 400 in Serverless mode.',
  responseSchema: z.record(z.string(), z.any()),
});

addAdminRoute({
  method: 'get',
  path: '/api/admin/aws-metrics',
  summary: 'Retrieve AWS CloudWatch metrics',
  description:
    'CloudWatch metrics time-series. Note: Available in AWS Serverless mode only; returns 400 in Kiosk/Local mode.',
  responseSchema: z.record(z.string(), z.any()),
});

// ── 7. Captive Portal Domain ──────────────────────────────────────────────────

addPortalRoute({
  method: 'get',
  path: '/api/captive-portal',
  summary: 'RFC 8908 Captive Portal JSON status',
  description:
    'Returns captive network state and portal URLs. Active during local Wi-Fi kiosk operation.',
  responseSchema: CaptivePortalStatusSchema,
});

addPortalRoute({
  method: 'post',
  path: '/api/captive-portal/accept',
  summary: 'Accept terms and admit client',
  description: 'Admits client IP to access local network.',
  responseSchema: SuccessResponseSchema,
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
