/**
 * Validation middleware.
 *
 * Replaces `req.body` / `req.query` / `req.params` with the PARSED value, so
 * downstream code physically cannot read an unvalidated property. Anything not
 * declared in the schema was already rejected by `.strict()`.
 */
import { ValidationError } from '../errors/AppError.js';

const TARGETS = ['body', 'query', 'params'];

function formatIssues(error) {
  return error.issues.map((issue) => ({
    field: issue.path.join('.') || '(root)',
    message: issue.message,
  }));
}

/**
 * @param {{body?: import('zod').ZodTypeAny, query?: import('zod').ZodTypeAny, params?: import('zod').ZodTypeAny}} schemas
 */
export function validate(schemas) {
  return (req, _res, next) => {
    for (const target of TARGETS) {
      const schema = schemas[target];
      if (!schema) continue;
      const result = schema.safeParse(req[target]);
      if (!result.success) {
        return next(
          new ValidationError(formatIssues(result.error), `validation failed on req.${target}`)
        );
      }
      // Express 5 makes req.query a getter; define instead of assign.
      Object.defineProperty(req, target, {
        value: result.data,
        writable: true,
        configurable: true,
        enumerable: true,
      });
    }
    return next();
  };
}

export default validate;
