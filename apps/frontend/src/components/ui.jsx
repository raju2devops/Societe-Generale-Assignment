/**
 * Small presentational primitives.
 *
 * Nothing here uses `dangerouslySetInnerHTML`. Every value that reaches the DOM
 * goes through JSX text interpolation, which React escapes - so a holder name
 * containing markup renders as characters, never as nodes (OWASP A05:2025,
 * output encoding).
 */
import { useEffect, useRef } from 'react';

export function Card({ title, actions, children, className = '' }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <header className="card__head">
          {title && <h2 className="card__title">{title}</h2>}
          {actions && <div className="card__actions">{actions}</div>}
        </header>
      )}
      <div className="card__body">{children}</div>
    </section>
  );
}

export function Button({ variant = 'primary', size = 'md', busy = false, children, ...rest }) {
  return (
    <button
      type="button"
      className={`btn btn--${variant} btn--${size}`}
      disabled={busy || rest.disabled}
      {...rest}
    >
      {busy && <span className="btn__spinner" aria-hidden="true" />}
      {children}
    </button>
  );
}

export function Field({ label, error, hint, required, children, htmlFor }) {
  return (
    <div className={`field ${error ? 'field--error' : ''}`}>
      <label className="field__label" htmlFor={htmlFor}>
        {label}
        {required && <span className="field__req" aria-hidden="true"> *</span>}
      </label>
      {children}
      {hint && !error && <p className="field__hint">{hint}</p>}
      {error && (
        <p className="field__error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function StatusPill({ status }) {
  return <span className={`pill pill--${String(status).toLowerCase()}`}>{status}</span>;
}

export function Alert({ tone = 'info', title, children, onDismiss }) {
  return (
    <div className={`alert alert--${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      <div className="alert__content">
        {title && <strong className="alert__title">{title}</strong>}
        <div>{children}</div>
      </div>
      {onDismiss && (
        <button type="button" className="alert__close" onClick={onDismiss} aria-label="Dismiss">
          &times;
        </button>
      )}
    </div>
  );
}

export function EmptyState({ title, children }) {
  return (
    <div className="empty">
      <div className="empty__mark" aria-hidden="true" />
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}

export function Spinner({ label = 'Loading' }) {
  return (
    <div className="spinner" role="status" aria-live="polite">
      <span className="spinner__ring" aria-hidden="true" />
      <span className="spinner__label">{label}...</span>
    </div>
  );
}

/** Accessible modal: focus is moved in on open and Escape closes it. */
export function Modal({ open, title, onClose, children, footer }) {
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    document.addEventListener('keydown', onKey);
    ref.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="modal__backdrop" onMouseDown={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={ref}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="modal__head">
          <h2>{title}</h2>
          <button type="button" className="modal__close" onClick={onClose} aria-label="Close">
            &times;
          </button>
        </header>
        <div className="modal__body">{children}</div>
        {footer && <footer className="modal__foot">{footer}</footer>}
      </div>
    </div>
  );
}

export function formatMoney({ amount, currency }) {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: currency || 'EUR',
    minimumFractionDigits: 2,
  }).format(amount ?? 0);
}

export function formatDate(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value)
  );
}
