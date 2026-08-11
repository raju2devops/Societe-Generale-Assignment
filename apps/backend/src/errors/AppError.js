/**
 * Application error taxonomy.
 *
 * OWASP A10:2025 "Mishandling of Exceptional Conditions" and Mandatory Control
 * "User-friendly error responses - no internal details".
 *
 * Every error carries TWO messages:
 *   - `message`     : safe, generic, shown to the caller.
 *   - `logDetail`   : verbose, internal, only ever written to the server log.
 *
 * The error handler never promotes `logDetail` into an HTTP response.
 */
export class AppError extends Error {
  constructor(message, { status = 500, code = 'INTERNAL_ERROR', logDetail, details } = {}) {
    super(message);
    this.name = new.target.name;
    this.status = status;
    this.code = code;
    this.logDetail = logDetail;
    this.details = details;
    this.isOperational = true;
    Error.captureStackTrace?.(this, new.target);
  }
}

export class ValidationError extends AppError {
  constructor(details, logDetail) {
    super('The request payload failed validation.', {
      status: 400,
      code: 'VALIDATION_FAILED',
      details,
      logDetail,
    });
  }
}

export class AuthenticationError extends AppError {
  constructor(logDetail) {
    // Deliberately generic. Mandatory Control: "Avoid specific login error
    // messages - do not reveal whether the username or password was wrong."
    super('Invalid credentials.', { status: 401, code: 'AUTHENTICATION_FAILED', logDetail });
  }
}

export class SessionError extends AppError {
  constructor(logDetail) {
    super('Your session is no longer valid. Please sign in again.', {
      status: 401,
      code: 'SESSION_INVALID',
      logDetail,
    });
  }
}

export class AuthorizationError extends AppError {
  constructor(logDetail) {
    super('You do not have permission to perform this action.', {
      status: 403,
      code: 'FORBIDDEN',
      logDetail,
    });
  }
}

export class NotFoundError extends AppError {
  constructor(resource = 'Resource', logDetail) {
    super(`${resource} not found.`, { status: 404, code: 'NOT_FOUND', logDetail });
  }
}

export class ConflictError extends AppError {
  constructor(message = 'The request conflicts with the current state.', logDetail) {
    super(message, { status: 409, code: 'CONFLICT', logDetail });
  }
}

export class LockedError extends AppError {
  constructor(logDetail) {
    super('This account is locked. Contact the system administrator.', {
      status: 423,
      code: 'ACCOUNT_LOCKED',
      logDetail,
    });
  }
}

export class BusinessRuleError extends AppError {
  constructor(message, logDetail) {
    super(message, { status: 422, code: 'BUSINESS_RULE_VIOLATION', logDetail });
  }
}
