/**
 * Reusable Express middleware factories for Zod schema validation.
 * Sets req.validatedBody, req.validatedQuery, or req.validatedParams upon success.
 * Responds with HTTP 400 and standard { error: string } on failure.
 */

/**
 * Validates req.body against a Zod schema.
 * @param {import('zod').ZodTypeAny} schema
 */
export function validateBody(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const firstIssue = result.error.issues[0];
      const message = firstIssue?.message || 'Invalid request body.';
      return res.status(400).json({ error: message, details: result.error.issues });
    }
    req.validatedBody = result.data;
    next();
  };
}

/**
 * Validates req.query against a Zod schema.
 * @param {import('zod').ZodTypeAny} schema
 */
export function validateQuery(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      const firstIssue = result.error.issues[0];
      const message = firstIssue?.message || 'Invalid query parameters.';
      return res.status(400).json({ error: message, details: result.error.issues });
    }
    req.validatedQuery = result.data;
    next();
  };
}

/**
 * Validates req.params against a Zod schema.
 * @param {import('zod').ZodTypeAny} schema
 */
export function validateParams(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.params);
    if (!result.success) {
      const firstIssue = result.error.issues[0];
      const message = firstIssue?.message || 'Invalid URL parameters.';
      return res.status(400).json({ error: message, details: result.error.issues });
    }
    req.validatedParams = result.data;
    next();
  };
}
