import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { BrandMark } from '../components/BrandMark.jsx';
import { Alert, Button, Field } from '../components/ui.jsx';

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email.trim(), password);
      navigate(location.state?.from ?? '/accounts', { replace: true });
    } catch (err) {
      // The server sends one generic message for every credential failure, so
      // there is nothing here to translate into "user not found".
      setError(err.message);
      setPassword('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth">
      <div className="auth__panel">
        <div className="auth__brand">
          <BrandMark size={56} />
          <div>
            <h1 className="auth__name">SOCIETE GENERALE</h1>
            <p className="auth__sub">Account Management Console</p>
          </div>
        </div>

        <form className="auth__form" onSubmit={onSubmit} noValidate>
          <h2 className="auth__heading">Sign in</h2>

          {error && (
            <Alert tone="error" title="Sign-in failed">
              {error}
            </Alert>
          )}

          <Field label="Work e-mail" htmlFor="email" required>
            <input
              id="email"
              className="input"
              type="email"
              name="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              maxLength={254}
              required
            />
          </Field>

          <Field label="Password" htmlFor="password" required>
            <input
              id="password"
              className="input"
              type="password"
              name="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              maxLength={128}
              required
            />
          </Field>

          <Button type="submit" busy={busy} size="lg">
            {busy ? 'Signing in' : 'Sign in'}
          </Button>

          <p className="auth__note">
            Accounts lock after three failed attempts. Access is logged and audited.
          </p>
        </form>
      </div>

      <aside className="auth__aside">
        <div className="auth__aside-inner">
          <h2>Secure by default</h2>
          <ul>
            <li>Session tokens in HttpOnly cookies — never readable by scripts</li>
            <li>Customer data encrypted field-by-field with AES-256-GCM</li>
            <li>Role-based access control, re-checked on every request</li>
            <li>Every create, read, update and close written to an audit trail</li>
          </ul>
        </div>
      </aside>
    </div>
  );
}
