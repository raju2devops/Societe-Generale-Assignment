import { Navigate, Route, Routes, useLocation, NavLink } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext.jsx';
import { BrandLockup } from './components/BrandMark.jsx';
import { Alert, Button, Spinner } from './components/ui.jsx';
import LoginPage from './pages/LoginPage.jsx';
import AccountsPage from './pages/AccountsPage.jsx';
import AccountDetailPage from './pages/AccountDetailPage.jsx';
import AccountFormPage from './pages/AccountFormPage.jsx';

/**
 * Route guard. This is a usability control, not a security control - it stops
 * an anonymous user seeing a broken shell. The API enforces authentication and
 * authorisation independently on every single request.
 */
function RequireAuth({ children, permission }) {
  const { status, can } = useAuth();
  const location = useLocation();

  if (status === 'loading') return <Spinner label="Restoring session" />;
  if (status !== 'authenticated') {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  if (permission && !can(permission)) {
    return (
      <div className="page page--narrow">
        <Alert tone="error" title="Not permitted">
          Your role does not allow this action.
        </Alert>
      </div>
    );
  }
  return children;
}

function Shell({ children }) {
  const { user, notice, logout, dismissNotice } = useAuth();

  return (
    <div className="shell">
      <header className="topbar">
        <BrandLockup />
        <nav className="topnav" aria-label="Main">
          <NavLink to="/accounts" className={({ isActive }) => (isActive ? 'active' : '')}>
            Accounts
          </NavLink>
        </nav>
        <div className="topbar__user">
          <div className="userchip">
            <span className="userchip__name">{user?.displayName}</span>
            <span className="userchip__role">{user?.role}</span>
          </div>
          <Button variant="ghost" size="sm" onClick={logout}>
            Sign out
          </Button>
        </div>
      </header>

      {notice && (
        <div className="notice-bar">
          <Alert tone="info" onDismiss={dismissNotice}>
            {notice.lastLoginAt
              ? `Last sign-in ${new Date(notice.lastLoginAt).toLocaleString('en-GB')}.`
              : 'This is your first sign-in.'}{' '}
            {notice.failedAttemptsSinceLastLogin > 0 &&
              `${notice.failedAttemptsSinceLastLogin} failed attempt(s) since. `}
            {notice.mustChangePassword
              ? 'Your password must be changed.'
              : `Password expires in ${notice.passwordExpiresInDays} day(s).`}
          </Alert>
        </div>
      )}

      <main className="main">{children}</main>

      <footer className="footer">
        <span>
          Demonstration application. &ldquo;Societe Generale&rdquo; and its logo are
          trademarks of Societe Generale S.A.; the mark used here is an original
          placeholder.
        </span>
      </footer>
    </div>
  );
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/accounts"
        element={
          <RequireAuth permission="account:read">
            <Shell>
              <AccountsPage />
            </Shell>
          </RequireAuth>
        }
      />
      <Route
        path="/accounts/new"
        element={
          <RequireAuth permission="account:create">
            <Shell>
              <AccountFormPage />
            </Shell>
          </RequireAuth>
        }
      />
      <Route
        path="/accounts/:id"
        element={
          <RequireAuth permission="account:read">
            <Shell>
              <AccountDetailPage />
            </Shell>
          </RequireAuth>
        }
      />
      <Route
        path="/accounts/:id/edit"
        element={
          <RequireAuth permission="account:update">
            <Shell>
              <AccountFormPage />
            </Shell>
          </RequireAuth>
        }
      />
      <Route path="*" element={<Navigate to="/accounts" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}
