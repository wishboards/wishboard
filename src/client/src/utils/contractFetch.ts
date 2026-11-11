import openapiSpec from '../../../../api/openapi.json';

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

interface OpenApiSchemaObject {
  $ref?: string;
  type?: string;
  properties?: Record<string, OpenApiSchemaObject>;
  required?: string[];
  items?: OpenApiSchemaObject;
  enum?: unknown[];
  nullable?: boolean;
  anyOf?: OpenApiSchemaObject[];
  oneOf?: OpenApiSchemaObject[];
}

interface OpenApiOperation {
  parameters?: Array<{
    name: string;
    in: string;
    required?: boolean;
    schema?: OpenApiSchemaObject;
  }>;
  requestBody?: {
    content?: Record<string, { schema?: OpenApiSchemaObject }>;
  };
  responses?: Record<
    string,
    {
      description?: string;
      content?: Record<string, { schema?: OpenApiSchemaObject }>;
    }
  >;
}

interface OpenApiDocument {
  paths: Record<string, Partial<Record<Lowercase<HttpMethod>, OpenApiOperation>>>;
  components?: {
    schemas?: Record<string, OpenApiSchemaObject>;
  };
}

const spec = openapiSpec as unknown as OpenApiDocument;

/**
 * Resolves a `$ref` pointer (e.g. `#/components/schemas/ResetPasswordResponse`)
 * against `spec.components.schemas`.
 */
export function resolveSchemaRef(schema?: OpenApiSchemaObject): OpenApiSchemaObject | undefined {
  if (!schema) return undefined;
  if (schema.$ref) {
    const prefix = '#/components/schemas/';
    if (schema.$ref.startsWith(prefix)) {
      const name = schema.$ref.slice(prefix.length);
      return resolveSchemaRef(spec.components?.schemas?.[name]);
    }
  }
  return schema;
}

/**
 * Matches a concrete request URL (such as `/api/admin/users/alice/reset-password?foo=1`)
 * against the OpenAPI specification's `paths` map for the given HTTP method.
 */
export function matchOpenApiOperation(
  method: string,
  rawUrl: string
): { pathTemplate: string; operation: OpenApiOperation } | null {
  const cleanPath = rawUrl.split('?')[0].replace(/^https?:\/\/[^/]+/, '');
  const lowerMethod = method.toLowerCase() as Lowercase<HttpMethod>;

  // 1. Check exact path match first (avoids `{id}` swallowing static subpaths like `/exclusions`)
  const exactItem = spec.paths[cleanPath];
  if (exactItem?.[lowerMethod]) {
    return { pathTemplate: cleanPath, operation: exactItem[lowerMethod]! };
  }

  // 2. Check parameterized path templates
  for (const [pathTemplate, pathItem] of Object.entries(spec.paths)) {
    const operation = pathItem?.[lowerMethod];
    if (!operation) continue;
    const regexStr = '^' + pathTemplate.replaceAll(/\{[^}]+\}/g, '[^/]+') + '$';
    if (new RegExp(regexStr).test(cleanPath)) {
      return { pathTemplate, operation };
    }
  }

  return null;
}

/**
 * Validates a value against an OpenAPI 3.0 Schema Object, returning an array
 * of human-readable contract violation messages (empty if valid).
 */
export function validateAgainstOpenApiSchema(
  value: unknown,
  rawSchema?: OpenApiSchemaObject,
  pathPrefix = 'response'
): string[] {
  const schema = resolveSchemaRef(rawSchema);
  if (!schema) return [];

  if (value === null) {
    return schema.nullable ? [] : [`${pathPrefix}: expected non-null value`];
  }

  if (schema.anyOf || schema.oneOf) {
    const variants = schema.anyOf ?? schema.oneOf ?? [];
    const passesAny = variants.some(
      (variant) => validateAgainstOpenApiSchema(value, variant, pathPrefix).length === 0
    );
    return passesAny ? [] : [`${pathPrefix}: value did not match any allowed schema union variant`];
  }

  if (schema.enum && !schema.enum.includes(value)) {
    return [`${pathPrefix}: "${String(value)}" is not one of [${schema.enum.join(', ')}]`];
  }

  if (schema.type === 'array') {
    if (!Array.isArray(value)) {
      return [`${pathPrefix}: expected array, got ${typeof value}`];
    }
    const errors: string[] = [];
    for (let i = 0; i < value.length; i++) {
      errors.push(...validateAgainstOpenApiSchema(value[i], schema.items, `${pathPrefix}[${i}]`));
    }
    return errors;
  }

  if (schema.type === 'object' || schema.properties) {
    if (typeof value !== 'object' || Array.isArray(value)) {
      return [
        `${pathPrefix}: expected object, got ${Array.isArray(value) ? 'array' : typeof value}`,
      ];
    }
    const record = value as Record<string, unknown>;
    const errors: string[] = [];

    for (const reqKey of schema.required ?? []) {
      if (!(reqKey in record) || record[reqKey] === undefined) {
        errors.push(`${pathPrefix}.${reqKey}: required property is missing`);
      }
    }

    for (const [propKey, propSchema] of Object.entries(schema.properties ?? {})) {
      if (propKey in record && record[propKey] !== undefined) {
        errors.push(
          ...validateAgainstOpenApiSchema(record[propKey], propSchema, `${pathPrefix}.${propKey}`)
        );
      }
    }

    return errors;
  }

  if (schema.type === 'string' && typeof value !== 'string') {
    return [`${pathPrefix}: expected string, got ${typeof value}`];
  }
  if ((schema.type === 'number' || schema.type === 'integer') && typeof value !== 'number') {
    return [`${pathPrefix}: expected ${schema.type}, got ${typeof value}`];
  }
  if (schema.type === 'boolean' && typeof value !== 'boolean') {
    return [`${pathPrefix}: expected boolean, got ${typeof value}`];
  }

  return [];
}

export interface ContractMockRoute {
  method?: HttpMethod;
  /** OpenAPI path template (e.g. `/api/admin/users/{username}/reset-password`) or concrete URL */
  path: string;
  status?: number;
  response: unknown | ((req: { url: string; method: HttpMethod; body: unknown }) => unknown);
}

/**
 * Creates a contract-validated `globalThis.fetch` mock function.
 *
 * Every request and mocked response is validated against `api/openapi.json`:
 * 1. Fails immediately if the client calls an undocumented URL or HTTP method.
 * 2. Fails immediately if the client sends a JSON request body that violates the OpenAPI request schema.
 * 3. Fails immediately if the test's mock response body violates the OpenAPI response schema for that status code.
 */
export function createContractFetchMock(routes: ContractMockRoute[]): typeof globalThis.fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : (input as Request).url;
    const method = (
      init?.method ||
      (typeof input === 'object' && 'method' in input ? input.method : 'GET') ||
      'GET'
    ).toUpperCase() as HttpMethod;

    const matchedOp = matchOpenApiOperation(method, url);
    if (!matchedOp) {
      throw new Error(
        `[ContractViolation] Undocumented API call: ${method} ${url} does not match any path in api/openapi.json`
      );
    }

    // Parse & validate JSON request body if present
    let parsedBody: unknown = undefined;
    if (typeof init?.body === 'string' && init.body.length > 0) {
      parsedBody = JSON.parse(init.body);
      const reqSchema = matchedOp.operation.requestBody?.content?.['application/json']?.schema;
      const reqErrors = validateAgainstOpenApiSchema(parsedBody, reqSchema, 'requestBody');
      if (reqErrors.length > 0) {
        throw new Error(
          `[ContractViolation] Invalid request body for ${method} ${matchedOp.pathTemplate}: ${reqErrors.join('; ')}`
        );
      }
    }

    // Find matching mock route handler
    const cleanPath = url.split('?')[0].replace(/^https?:\/\/[^/]+/, '');
    const mockRoute = routes.find((r) => {
      const rMethod = (r.method ?? 'GET').toUpperCase();
      if (rMethod !== method) return false;
      if (r.path === cleanPath || r.path === matchedOp.pathTemplate) return true;
      const regexStr = '^' + r.path.replaceAll(/\{[^}]+\}/g, '[^/]+') + '$';
      return new RegExp(regexStr).test(cleanPath);
    });

    if (!mockRoute) {
      throw new Error(
        `[ContractViolation] No mock route registered in createContractFetchMock for ${method} ${url} (matched OpenAPI ${matchedOp.pathTemplate})`
      );
    }

    const status = mockRoute.status ?? 200;
    const payload =
      typeof mockRoute.response === 'function'
        ? await mockRoute.response({ url, method, body: parsedBody })
        : mockRoute.response;

    // Validate mock response against OpenAPI response schema
    const statusSpec =
      matchedOp.operation.responses?.[String(status)] ??
      matchedOp.operation.responses?.[status >= 200 && status < 300 ? '200' : String(status)];
    const resSchema = statusSpec?.content?.['application/json']?.schema;
    const resErrors = validateAgainstOpenApiSchema(payload, resSchema, `response(${status})`);
    if (resErrors.length > 0) {
      throw new Error(
        `[ContractViolation] Mock response for ${method} ${matchedOp.pathTemplate} (${status}) violates OpenAPI schema: ${resErrors.join('; ')}`
      );
    }

    const ok = status >= 200 && status < 300;
    return {
      ok,
      status,
      headers: new Headers({ 'Content-Type': 'application/json' }),
      json: async () => payload,
      text: async () => JSON.stringify(payload),
    } as Response;
  }) as typeof globalThis.fetch;
}
