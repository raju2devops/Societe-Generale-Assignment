/**
 * Cookie policy - one place, so no route can accidentally set a weaker flag.
 *
 * Mandatory Controls / OWASP A07:2025:
 *   HttpOnly  - JavaScript (and therefore any XSS payload) cannot read the token
 *   Secure    - never sent over plain HTTP (relaxed only outside production, so
 *               `http://localhost` still works for development)
 *   SameSite  - 'strict' on the auth cookies: the browser will not attach them
 *               to any cross-site request, which is the first CSRF layer
 *   Path      - the refresh cookie is scoped to the auth routes only, so it is
 *               not attached to ordinary API calls and cannot leak from them
 */
import { config } from '../config/env.js';

export const ACCESS_COOKIE = '__Host-sg_at';
export const REFRESH_COOKIE = '__Host-sg_rt';
export const CSRF_COOKIE = '__Host-sg_csrf';

// The `__Host-` prefix is a browser-enforced guarantee: Secure, Path=/ and no
// Domain attribute. A sub-domain takeover therefore cannot overwrite the
// cookie. It requires HTTPS, so plain-HTTP local development uses bare names.
const usePrefix = config.isProduction;
const name = (n) => (usePrefix ? n : n.replace('__Host-', ''));

export const COOKIE_NAMES = Object.freeze({
  access: name(ACCESS_COOKIE),
  refresh: name(REFRESH_COOKIE),
  csrf: name(CSRF_COOKIE),
});

const base = Object.freeze({
  httpOnly: true,
  secure: config.isProduction,
  sameSite: 'strict',
  path: '/',
});

export function setAuthCookies(res, { accessToken, accessExpiresAt, refreshToken, refreshExpiresAt, csrfToken }) {
  res.cookie(COOKIE_NAMES.access, accessToken, {
    ...base,
    expires: accessExpiresAt,
  });

  res.cookie(COOKIE_NAMES.refresh, refreshToken, {
    ...base,
    // `__Host-` forbids a narrowed Path, so the refresh cookie is scoped by
    // path only when the prefix is not in use. In production the protection
    // comes from the prefix + SameSite=strict instead.
    path: usePrefix ? '/' : '/api/v1/auth',
    expires: refreshExpiresAt,
  });

  // Double-submit CSRF token. Deliberately NOT HttpOnly - the SPA must read it
  // to echo it back in the x-csrf-token header. It is not a credential on its
  // own: it only proves the caller could read a same-origin cookie.
  res.cookie(COOKIE_NAMES.csrf, csrfToken, {
    ...base,
    httpOnly: false,
    expires: refreshExpiresAt,
  });
}

export function clearAuthCookies(res) {
  const opts = { ...base, path: '/' };
  res.clearCookie(COOKIE_NAMES.access, opts);
  res.clearCookie(COOKIE_NAMES.refresh, { ...opts, path: usePrefix ? '/' : '/api/v1/auth' });
  res.clearCookie(COOKIE_NAMES.csrf, { ...opts, httpOnly: false });
}

export default { COOKIE_NAMES, setAuthCookies, clearAuthCookies };
