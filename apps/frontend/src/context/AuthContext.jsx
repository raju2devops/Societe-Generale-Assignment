/**
 * Session state.
 *
 * Holds the *profile* only - never a token. On mount it asks the server who it
 * is talking to (`GET /auth/me`), because the cookies are HttpOnly and the SPA
 * genuinely cannot introspect them. That is the point: the server remains the
 * single source of truth about the session.
 *
 * Permissions are mirrored here purely to hide controls the user cannot use.
 * They are NOT a security boundary - the API enforces the same rules again on
 * every request.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '../api/client.js';

const AuthContext = createContext(null);

const ROLE_PERMISSIONS = {
  viewer: ['account:read'],
  officer: ['account:read', 'account:create', 'account:update'],
  admin: [
    'account:read',
    'account:create',
    'account:update',
    'account:delete',
    'account:purge',
    'audit:read',
  ],
};

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [notice, setNotice] = useState(null);
  const [status, setStatus] = useState('loading'); // loading | anonymous | authenticated

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // On a hard reload the access cookie may already have expired while the
        // refresh cookie is still good. Try /me, and on failure attempt exactly
        // one refresh before concluding the visitor is anonymous.
        let res;
        try {
          res = await api.me();
        } catch {
          await api.refresh();
          res = await api.me();
        }
        if (!cancelled) {
          setUser(res.data);
          setStatus('authenticated');
        }
      } catch {
        if (!cancelled) {
          setUser(null);
          setStatus('anonymous');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email, password) => {
    const res = await api.login(email, password);
    setUser(res.data.user);
    setNotice(res.data.notice);
    setStatus('authenticated');
    return res.data;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      setUser(null);
      setNotice(null);
      setStatus('anonymous');
    }
  }, []);

  const can = useCallback(
    (permission) => (ROLE_PERMISSIONS[user?.role] ?? []).includes(permission),
    [user]
  );

  const value = useMemo(
    () => ({ user, notice, status, login, logout, can, dismissNotice: () => setNotice(null) }),
    [user, notice, status, login, logout, can]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

export default AuthContext;
