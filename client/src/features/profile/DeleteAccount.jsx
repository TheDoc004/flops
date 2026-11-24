import { useEffect, useRef, useState } from 'react';
import { deleteAccount, requestAccountDelete } from '@shared/api/profile';

/**
 * "Delete my account" row for Profile. Two steps in one dialog: first what it
 * means (with a way to download the data before), then the emailed code.
 */
export default function DeleteAccount({ email, onDownload, onDeleted, api }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="data-export-row">
        <div className="data-export-row__copy">
          <div className="data-export-row__title">Delete my account</div>
          <div className="data-export-row__sub">Closes this notebook and signs you out everywhere.</div>
        </div>
        <button type="button" className="btn-danger-ghost" onClick={() => setOpen(true)}>
          Delete…
        </button>
      </div>
      {open && (
        <DeleteAccountDialog
          email={email}
          onDownload={onDownload}
          onDeleted={onDeleted}
          api={api}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

const defaultApi = { request: requestAccountDelete, confirm: deleteAccount };

function DeleteAccountDialog({ email, onDownload, onDeleted, onClose, api = defaultApi }) {
  const ref = useRef(null);
  const [step, setStep] = useState('explain');
  const [method, setMethod] = useState('email');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    ref.current?.showModal?.();
  }, []);

  async function sendCode() {
    setBusy(true);
    setError('');
    try {
      const r = await api.request();
      setMethod(r?.method || 'email');
      setCode('');
      setStep('confirm');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirm(e) {
    e.preventDefault();
    if (busy) return;
    if (!/^\d{6}$/.test(code.trim())) return setError('Enter the 6-digit code from the email.');
    setBusy(true);
    setError('');
    try {
      await api.confirm({ code: code.trim() });
      onDeleted?.();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <dialog ref={ref} onClose={onClose} aria-labelledby="delete-account-title" style={{ width: 'min(440px, 94vw)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 4 }}>
        <h2 id="delete-account-title" className="section-title" style={{ margin: 0 }}>Delete my account</h2>
        <button type="button" className="modal-close-x" aria-label="Close" onClick={() => ref.current?.close()}>
          ✕
        </button>
      </div>

      {step === 'explain' ? (
        <>
          <p style={{ margin: '8px 0 10px', fontSize: 13, color: 'var(--color-text-muted)' }}>
            Your notebook closes: meals, weights, workouts and everything else stop showing up,
            you are signed out on every device, and any coach you share with loses access.
            You can&apos;t sign back in to this account afterwards.
          </p>
          <p style={{ margin: '0 0 6px', fontSize: 13, color: 'var(--color-text-muted)' }}>
            Want a copy first?
          </p>
          <button type="button" className="btn-ghost" style={{ paddingLeft: 0 }} onClick={() => onDownload?.()}>
            Download your data first
          </button>
          {error && <p className="error" style={{ marginBottom: 0 }}>{error}</p>}
          <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
            <button type="button" className="btn-secondary" onClick={() => ref.current?.close()}>Keep my account</button>
            <button type="button" className="btn-danger" disabled={busy} onClick={() => { void sendCode(); }}>
              {busy ? 'Sending…' : 'Email me a code'}
            </button>
          </div>
        </>
      ) : method === 'apple' ? (
        <p style={{ margin: '8px 0 0', fontSize: 13 }}>
          This account signs in with Apple. Confirming with Apple is not available on the web yet.
        </p>
      ) : (
        <form onSubmit={handleConfirm}>
          <p style={{ margin: '8px 0 14px', fontSize: 13, color: 'var(--color-text-muted)' }}>
            We sent a 6-digit code to {email || 'your email'}. Enter it to delete the account.
          </p>
          <label htmlFor="delete-account-code">Code</label>
          <input
            id="delete-account-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            autoFocus
            onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
          />
          {error && <p className="error" style={{ marginBottom: 0 }}>{error}</p>}
          <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
            <button type="button" className="btn-ghost" disabled={busy} onClick={() => { void sendCode(); }}>
              Send a new code
            </button>
            <button type="submit" className="btn-danger" disabled={busy}>
              {busy ? 'Deleting…' : 'Delete my account'}
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}
