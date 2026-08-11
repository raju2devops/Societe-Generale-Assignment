import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import {
  Alert,
  Button,
  Card,
  EmptyState,
  Field,
  Spinner,
  StatusPill,
  formatDate,
  formatMoney,
} from '../components/ui.jsx';

const STATUSES = ['ACTIVE', 'DORMANT', 'FROZEN', 'CLOSED'];
const TYPES = ['SAVINGS', 'CURRENT', 'FIXED_DEPOSIT', 'JOINT'];

export default function AccountsPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [flash, setFlash] = useState(location.state?.flash ?? null);
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState({ total: 0, page: 1, pageSize: 10, totalPages: 1 });
  const [filters, setFilters] = useState({ status: '', accountType: '', page: 1, pageSize: 10 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [lookup, setLookup] = useState('');
  const [lookupError, setLookupError] = useState(null);
  const [lookupBusy, setLookupBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.listAccounts(filters);
      setRows(res.data);
      setMeta(res.meta);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    load();
  }, [load]);

  async function onLookup(event) {
    event.preventDefault();
    const value = lookup.trim().replace(/\s+/g, '').toUpperCase();
    if (!value) return;
    setLookupBusy(true);
    setLookupError(null);
    try {
      const res = await api.getAccountByNumber(value);
      navigate(`/accounts/${res.data.id}`);
    } catch (err) {
      setLookupError(
        err instanceof ApiError && err.status === 404
          ? 'No account matches that number.'
          : err.message
      );
    } finally {
      setLookupBusy(false);
    }
  }

  return (
    <div className="page">
      <div className="page__head">
        <div>
          <h1 className="page__title">Accounts</h1>
          <p className="page__lede">
            {meta.total} account{meta.total === 1 ? '' : 's'} on file
          </p>
        </div>
        {can('account:create') && (
          <Button size="lg" onClick={() => navigate('/accounts/new')}>
            + New account
          </Button>
        )}
      </div>

      {flash && (
        <Alert tone="success" onDismiss={() => setFlash(null)}>
          {flash}
        </Alert>
      )}

      <Card title="Find an account by number" className="card--lookup">
        <form className="lookup" onSubmit={onLookup}>
          <Field
            label="Account number (IBAN)"
            htmlFor="lookup"
            error={lookupError}
            hint="Example: FR76 3000 3012 3456 7890 123"
          >
            <input
              id="lookup"
              className="input input--mono"
              value={lookup}
              onChange={(e) => setLookup(e.target.value)}
              placeholder="FR76…"
              maxLength={40}
              spellCheck={false}
              autoComplete="off"
            />
          </Field>
          <Button type="submit" variant="secondary" busy={lookupBusy}>
            Look up
          </Button>
        </form>
      </Card>

      <Card
        title="All accounts"
        actions={
          <div className="filters">
            <select
              className="select"
              aria-label="Filter by status"
              value={filters.status}
              onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value, page: 1 }))}
            >
              <option value="">All statuses</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <select
              className="select"
              aria-label="Filter by type"
              value={filters.accountType}
              onChange={(e) => setFilters((f) => ({ ...f, accountType: e.target.value, page: 1 }))}
            >
              <option value="">All types</option>
              {TYPES.map((t) => (
                <option key={t} value={t}>
                  {t.replace('_', ' ')}
                </option>
              ))}
            </select>
          </div>
        }
      >
        {error && <Alert tone="error">{error}</Alert>}

        {loading ? (
          <Spinner label="Loading accounts" />
        ) : rows.length === 0 ? (
          <EmptyState title="No accounts match">
            Adjust the filters, or create the first account for this branch.
          </EmptyState>
        ) : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Account number</th>
                    <th scope="col">Holder</th>
                    <th scope="col">Type</th>
                    <th scope="col">Status</th>
                    <th scope="col" className="num">
                      Balance
                    </th>
                    <th scope="col">Opened</th>
                    <th scope="col" className="sr-only">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} onClick={() => navigate(`/accounts/${row.id}`)} tabIndex={0}
                        onKeyDown={(e) => e.key === 'Enter' && navigate(`/accounts/${row.id}`)}>
                      <td className="mono">{row.accountNumberMasked}</td>
                      <td>
                        <span className="cell-strong">{row.holderName}</span>
                        <span className="cell-sub">{row.emailMasked}</span>
                      </td>
                      <td>{row.accountType.replace('_', ' ')}</td>
                      <td>
                        <StatusPill status={row.status} />
                      </td>
                      <td className="num mono">{formatMoney(row.balance)}</td>
                      <td className="muted">{formatDate(row.openedAt)}</td>
                      <td className="row-cta" aria-hidden="true">
                        &rsaquo;
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <nav className="pager" aria-label="Pagination">
              <Button
                variant="ghost"
                disabled={meta.page <= 1}
                onClick={() => setFilters((f) => ({ ...f, page: f.page - 1 }))}
              >
                &larr; Previous
              </Button>
              <span className="pager__label">
                Page {meta.page} of {Math.max(1, meta.totalPages)}
              </span>
              <Button
                variant="ghost"
                disabled={meta.page >= meta.totalPages}
                onClick={() => setFilters((f) => ({ ...f, page: f.page + 1 }))}
              >
                Next &rarr;
              </Button>
            </nav>
          </>
        )}
      </Card>
    </div>
  );
}
