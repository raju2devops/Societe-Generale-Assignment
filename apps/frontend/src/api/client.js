/**
 * API client.
 *
 * Security notes:
 *  * `credentials: 'same-origin'` - the browser attaches the HttpOnly auth
 *    cookies. No token is ever held in JavaScript, so an XSS payload has
 *    nothing to steal. There is deliberately NO localStorage / sessionStorage
 *    usage anywhere in this application.
 *  * The CSRF token is read from its (non-HttpOnly) cookie and echoed in the
 *    `x-csrf-token` header on every state-changing request.
 *  * A 401 triggers exactly ONE silent refresh attempt, then gives up. Retrying
 *    in a loop would turn an expired session into a self-inflicted DoS.
 */

const BASE = '/api/v1';
const CSRF_COOKIE_CANDIDATES = ['__Host-sg_csrf', 'sg_csrf'];
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export class ApiError extends Error {
  constructor({ status, code, message, details, correlationId }) {
    super(message || 'Request failed');
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details ?? null;
    this.correlationId = correlationId ?? null;
  }

  /** Field-level messages, keyed by field name, for inline form errors. */
  get fieldErrors() {
    if (!Array.isArray(this.details)) return {};
    return this.details.reduce((acc, d) => ({ ...acc, [d.field]: d.message }), {});
  }
}

function readCsrfToken() {
  for (const name of CSRF_COOKIE_CANDIDATES) {
    const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
    if (match) return decodeURIComponent(match[1]);
  }
  return null;
}

let refreshInFlight = null;

async function refreshSession() {
  // Collapse concurrent 401s into a single refresh call.
  refreshInFlight ??= fetch(`${BASE}/auth/refresh`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'x-csrf-token': readCsrfToken() ?? '' },
  }).finally(() => {
    refreshInFlight = null;
  });
  const res = await refreshInFlight;
  return res.ok;
}

async function parse(res) {
  if (res.status === 204) return null;
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError({ status: res.status, code: 'BAD_RESPONSE', message: 'Malformed server response.' });
  }
}

async function send(path, { method = 'GET', body, signal } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (UNSAFE_METHODS.has(method)) headers['x-csrf-token'] = readCsrfToken() ?? '';

  return fetch(`${BASE}${path}`, {
    method,
    credentials: 'same-origin',
    headers,
    signal,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function request(path, options = {}, { allowRetry = true } = {}) {
  let res = await send(path, options);

  if (res.status === 401 && allowRetry && !path.startsWith('/auth/')) {
    if (await refreshSession()) {
      res = await send(path, options);
    }
  }

  const payload = await parse(res);

  if (!res.ok) {
    const err = payload?.error ?? {};
    throw new ApiError({
      status: res.status,
      code: err.code ?? 'UNKNOWN',
      message: err.message ?? 'Something went wrong. Please try again.',
      details: err.details,
      correlationId: err.correlationId,
    });
  }

  return payload;
}

export const api = {
  // --- auth ---------------------------------------------------------------
  login: (email, password) => request('/auth/login', { method: 'POST', body: { email, password } }),
  logout: () => request('/auth/logout', { method: 'POST' }),
  me: () => request('/auth/me', {}, { allowRetry: true }),
  refresh: () => request('/auth/refresh', { method: 'POST' }, { allowRetry: false }),
  changePassword: (currentPassword, newPassword) =>
    request('/auth/change-password', { method: 'POST', body: { currentPassword, newPassword } }),

  // --- accounts (CRUD) -----------------------------------------------------
  listAccounts: (params = {}) => {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== '' && v !== undefined && v !== null)
    ).toString();
    return request(`/accounts${qs ? `?${qs}` : ''}`);
  },
  getAccount: (id) => request(`/accounts/${encodeURIComponent(id)}`),
  getAccountByNumber: (accountNumber) =>
    request(`/accounts/by-number/${encodeURIComponent(accountNumber)}`),
  createAccount: (payload) => request('/accounts', { method: 'POST', body: payload }),
  updateAccount: (id, payload) =>
    request(`/accounts/${encodeURIComponent(id)}`, { method: 'PUT', body: payload }),
  changeStatus: (id, payload) =>
    request(`/accounts/${encodeURIComponent(id)}/status`, { method: 'PATCH', body: payload }),
  closeAccount: (id, payload) =>
    request(`/accounts/${encodeURIComponent(id)}`, { method: 'DELETE', body: payload }),
  purgeAccount: (id) => request(`/accounts/${encodeURIComponent(id)}/purge`, { method: 'DELETE' }),
};

export default api;
