import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { submitProblemReport } from '@shared/api/problemReports';

/**
 * Quiet "Report a problem" link at the foot of every app screen. The report
 * carries the path the user was on (no query string), and nothing from their logs.
 */
export default function ReportProblem({ submit = submitProblemReport }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="report-problem">
      <button type="button" className="btn-ghost report-problem__trigger" onClick={() => setOpen(true)}>
        Report a problem
      </button>
      {open && <ReportProblemDialog submit={submit} onClose={() => setOpen(false)} />}
    </div>
  );
}

function ReportProblemDialog({ submit, onClose }) {
  const ref = useRef(null);
  const { pathname } = useLocation();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  useEffect(() => {
    ref.current?.showModal?.();
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    if (busy) return;
    if (!text.trim()) return setError('Tell us what went wrong.');
    setBusy(true);
    setError('');
    try {
      await submit({ text: text.trim(), route: pathname });
      setSent(true);
    } catch (err) {
      setError(err.message || 'Could not send the report.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog ref={ref} onClose={onClose} aria-labelledby="report-problem-title" style={{ width: 'min(440px, 94vw)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 4 }}>
        <h2 id="report-problem-title" className="section-title" style={{ margin: 0 }}>Report a problem</h2>
        <button type="button" className="modal-close-x" aria-label="Close" onClick={() => ref.current?.close()}>
          ✕
        </button>
      </div>

      {sent ? (
        <>
          <p role="status" style={{ margin: '8px 0 16px' }}>Thanks — it&apos;s on the list.</p>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button type="button" className="btn-primary" onClick={() => ref.current?.close()}>Done</button>
          </div>
        </>
      ) : (
        <form onSubmit={handleSubmit}>
          <p style={{ margin: '0 0 14px', fontSize: 13, color: 'var(--color-text-muted)' }}>
            What happened? We attach this page ({pathname}) and the app version — nothing from your logs.
          </p>
          <label htmlFor="report-problem-text">What went wrong</label>
          <textarea
            id="report-problem-text"
            rows={4}
            maxLength={2000}
            value={text}
            autoFocus
            onChange={e => setText(e.target.value)}
            placeholder="e.g. Saving a meal on a past day does nothing"
            style={{ fontFamily: 'inherit', resize: 'vertical' }}
          />
          {error && <p className="error" style={{ marginBottom: 0 }}>{error}</p>}
          <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <button type="submit" className="btn-primary" disabled={busy}>
              {busy ? 'Sending…' : 'Send report'}
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}
