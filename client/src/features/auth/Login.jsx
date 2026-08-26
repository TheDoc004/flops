import { useState } from 'react';
import { Link } from 'react-router-dom';
import { requestOtp, verifyOtp } from '@shared/api/auth';
import { useAuth } from '@shared/context/AuthContext';
import styles from './Login.module.css';

function friendlyAuthError(raw) {
  const msg = String(raw || '');
  if (/not configured|RESEND|SMTP|Could not send login email|Could not send your login/i.test(msg)) {
    return 'Could not send your login code yet. Email delivery may still be setting up. Try again in a few minutes.';
  }
  if (/Apple/i.test(msg)) {
    return 'Use email on the web for now. Apple Sign In is for the iOS app.';
  }
  return msg || 'Something went wrong. Try again.';
}

export default function Login() {
  const { refresh } = useAuth();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState('');
  const [step, setStep] = useState('email'); // email | code
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function sendCode(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const data = await requestOtp(email.trim());
      if (data.dev_code) setDevCode(data.dev_code);
      setStep('code');
    } catch (err) {
      setError(friendlyAuthError(err.message));
    } finally {
      setBusy(false);
    }
  }

  async function confirmCode(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await verifyOtp(email.trim(), code.trim());
      await refresh();
    } catch (err) {
      setError(friendlyAuthError(err.message));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <p className={styles.back}>
          <Link to="/">What is Flops?</Link>
        </p>
        <div className={styles.brand}>
          <img src="/flops-badge.png" alt="" className={styles.badge} />
          <h1>Flops</h1>
        </div>
        <p className={styles.lede}>
          Your nutrition notebook. Free to start. We email you a six-digit code. No password.
        </p>

        {error && <p className={styles.error} role="alert">{error}</p>}

        {step === 'email' ? (
          <form onSubmit={sendCode} className={styles.form}>
            <label htmlFor="login-email">Email</label>
            <input
              id="login-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
            />
            <button type="submit" className="btn-primary" disabled={busy}>
              {busy ? 'Sending…' : 'Email me a code'}
            </button>
          </form>
        ) : (
          <form onSubmit={confirmCode} className={styles.form}>
            <p className={styles.hint}>
              Enter the 6-digit code sent to <strong>{email}</strong>
              {devCode ? (
                <>
                  {' '}
                  <span className={styles.dev}>
                    (dev code: <code>{devCode}</code>)
                  </span>
                </>
              ) : null}
            </p>
            <label htmlFor="login-code">Code</label>
            <input
              id="login-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="123456"
              required
            />
            <button type="submit" className="btn-primary" disabled={busy}>
              {busy ? 'Checking…' : 'Sign in'}
            </button>
            <button
              type="button"
              className={styles.linkBtn}
              onClick={() => {
                setStep('email');
                setCode('');
                setDevCode('');
              }}
            >
              Use a different email
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
