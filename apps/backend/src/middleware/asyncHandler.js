/**
 * Wraps an async route handler so a rejected promise reaches the central error
 * handler instead of becoming an unhandled rejection (which, in Node 22, kills
 * the process). Fail securely - never let an error path silently vanish.
 */
export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

export default asyncHandler;
