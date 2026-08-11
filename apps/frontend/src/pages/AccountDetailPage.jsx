import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import {
  Alert,
  Button,
  Card,
  Modal,
  Spinner,
  StatusPill,
  formatDate,
  formatMoney,
} from '../components/ui.jsx';

const STATUS_OPTIONS = ['ACTIVE', 'DORMANT', 'FROZEN'];

function Row({ label, value, mono = false }) {
  return (
    <div className="detail-row">
      <dt>{label}</dt>
      <dd className={mono ? 'mono' : undefined}>{value ?? '—'}</dd>
    </div>
  );
}

export default function AccountDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();

  const [account, setAccount] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [banner, setBanner] = useState(null);

  const [closing, setClosing] = useState(false);
  const [closeReason, setCloseReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [revealed, setRevealed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getAccount(id);
      setAccount(res.data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function onChangeStatus(status) {
    setBusy(true);
    setBanner(null);
    try {
      const res = await api.changeStatus(id, { status, expectedVersion: account.version });
      setAccount(res.data);
      setBanner({ tone: 'success', text: `Status changed to ${status}.` });
    } catch (err) {
      setBanner({ tone: 'error', text: err.message });
    } finally {
      setBusy(false);
    }
  }

  async function onClose() {
    setBusy(true);
    setBanner(null);
    try {
      await api.closeAccount(id, { reason: closeReason.trim(), expectedVersion: account.version });
      setClosing(false);
      navigate('/accounts', {
        replace: true,
        state: { flash: 'Account closed. The record is retained for audit.' },
      });
    } catch (err) {
      setBanner({ tone: 'error', text: err.message });
      setClosing(false);
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Spinner label="Loading account" />;
  if (error) {
    return (
      <div className="page page--narrow">
        <Alert tone="error" title="Cannot show this account">
          {error}
        </Alert>
        <Button variant="ghost" onClick={() => navigate('/accounts')}>
          &larr; Back to accounts
        </Button>
      </div>
    );
  }

  const editable = ['ACTIVE', 'DORMANT', 'FROZEN'].includes(account.status);

  return (
    <div className="page">
      <button type="button" className="backlink" onClick={() => navigate('/accounts')}>
        &larr; All accounts
      </button>

      <div className="page__head">
        <div>
          <h1 className="page__title">{account.holderName}</h1>
          <p className="page__lede mono">
            {revealed ? account.accountNumber : account.accountNumberMasked}{' '}
            <button type="button" className="linkbtn" onClick={() => setRevealed((v) => !v)}>
              {revealed ? 'hide' : 'reveal'}
            </button>
          </p>
        </div>
        <div className="page__actions">
          {can('account:update') && editable && (
            <Button variant="secondary" onClick={() => navigate(`/accounts/${id}/edit`)}>
              Edit
            </Button>
          )}
          {can('account:delete') && editable && (
            <Button variant="danger" onClick={() => setClosing(true)}>
              Close account
            </Button>
          )}
        </div>
      </div>

      {banner && (
        <Alert tone={banner.tone} onDismiss={() => setBanner(null)}>
          {banner.text}
        </Alert>
      )}

      <div className="detail-grid">
        <Card title="Account">
          <dl className="detail">
            <Row label="Status" value={<StatusPill status={account.status} />} />
            <Row label="Type" value={account.accountType.replace('_', ' ')} />
            <Row label="Balance" value={formatMoney(account.balance)} mono />
            <Row label="Branch" value={account.branchCode} mono />
            <Row label="Opened" value={formatDate(account.openedAt)} />
            <Row label="Version" value={account.version} mono />
          </dl>
        </Card>

        <Card title="Holder">
          <dl className="detail">
            <Row label="Name" value={account.holderName} />
            <Row label="E-mail" value={account.email} />
            <Row label="Phone" value={account.phone} />
            <Row label="Address" value={account.address} />
          </dl>
          <p className="fineprint">
            These fields are stored encrypted (AES-256-GCM) and are decrypted only for
            authorised readers. Access to this page is written to the audit trail.
          </p>
        </Card>

        {can('account:update') && editable && (
          <Card title="Operational status">
            <p className="card__lede">
              Freezing an account blocks activity without closing it. Status changes are
              versioned and audited.
            </p>
            <div className="statusbar">
              {STATUS_OPTIONS.map((status) => (
                <Button
                  key={status}
                  variant={account.status === status ? 'primary' : 'ghost'}
                  size="sm"
                  busy={busy}
                  disabled={account.status === status}
                  onClick={() => onChangeStatus(status)}
                >
                  {status}
                </Button>
              ))}
            </div>
          </Card>
        )}

        <Card title="Record">
          <dl className="detail">
            <Row label="Created" value={formatDate(account.createdAt)} />
            <Row label="Last updated" value={formatDate(account.updatedAt)} />
            <Row label="Closed" value={account.closedAt ? formatDate(account.closedAt) : '—'} />
            <Row label="Closure reason" value={account.closureReason} />
          </dl>
        </Card>
      </div>

      <Modal
        open={closing}
        title="Close this account?"
        onClose={() => setClosing(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setClosing(false)}>
              Cancel
            </Button>
            <Button variant="danger" busy={busy} disabled={closeReason.trim().length < 3} onClick={onClose}>
              Close account
            </Button>
          </>
        }
      >
        <p>
          The account will be marked <strong>CLOSED</strong> and hidden from the working
          list. The record itself is retained for audit and regulatory retention — this is
          not an erasure.
        </p>
        {account.balance.amountMinor !== 0 && (
          <Alert tone="warn" title="Balance is not zero">
            This account holds {formatMoney(account.balance)}. The server will refuse the
            closure until the funds are transferred.
          </Alert>
        )}
        <label className="field__label" htmlFor="closeReason">
          Reason (recorded in the audit trail)
        </label>
        <textarea
          id="closeReason"
          className="input textarea"
          rows={3}
          value={closeReason}
          maxLength={500}
          onChange={(e) => setCloseReason(e.target.value)}
        />
      </Modal>
    </div>
  );
}
