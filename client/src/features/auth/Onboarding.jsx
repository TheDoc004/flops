import { useState } from 'react';
import { useAuth } from '@shared/context/AuthContext';
import { saveProfile } from '@shared/api/profile';
import styles from './Onboarding.module.css';

const STEPS = ['welcome', 'role', 'basics', 'done'];

export default function Onboarding() {
  const { user, updateMe, refresh } = useAuth();
  const [step, setStep] = useState(0);
  const [role, setRole] = useState('me'); // me | coach | both
  const [displayName, setDisplayName] = useState(user?.display_name || '');
  const [units, setUnits] = useState('metric');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function finish() {
    setBusy(true);
    setError('');
    try {
      const isCoach = role === 'coach' || role === 'both';
      await updateMe({
        display_name: displayName.trim() || undefined,
        is_coach: isCoach,
        onboarding_completed: true,
      });
      await saveProfile({
        macro_units: units,
        body_units: units,
      });
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const id = STEPS[step];

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <p className={styles.progress}>
          Step {step + 1} of {STEPS.length}
        </p>

        {id === 'welcome' && (
          <>
            <h1>Welcome to FLOPS</h1>
            <p className={styles.lede}>
              FLOPS is a <strong>notebook</strong>, not a nag. You write ingredients, meals, lifts, and
              supplements. The day you are writing on stays put until you flip it. AI adds insight when you ask.
            </p>
            <button type="button" className="btn-primary" onClick={() => setStep(1)}>
              Continue
            </button>
          </>
        )}

        {id === 'role' && (
          <>
            <h1>How will you use FLOPS?</h1>
            <p className={styles.lede}>You can change this later in Profile. Coach tools never see others&apos; data until they consent.</p>
            <div className={styles.choices}>
              {[
                { id: 'me', title: 'Just for me', sub: 'Personal notebook only' },
                { id: 'coach', title: 'I’m a coach', sub: 'Unlock coaching tools + keep my own log' },
                { id: 'both', title: 'Both', sub: 'Train myself and coach others' },
              ].map(c => (
                <button
                  key={c.id}
                  type="button"
                  className={`${styles.choice} ${role === c.id ? styles.choiceOn : ''}`}
                  onClick={() => setRole(c.id)}
                >
                  <strong>{c.title}</strong>
                  <span>{c.sub}</span>
                </button>
              ))}
            </div>
            <div className={styles.row}>
              <button type="button" className={styles.ghost} onClick={() => setStep(0)}>
                Back
              </button>
              <button type="button" className="btn-primary" onClick={() => setStep(2)}>
                Continue
              </button>
            </div>
          </>
        )}

        {id === 'basics' && (
          <>
            <h1>A few basics</h1>
            <label htmlFor="ob-name">Display name</label>
            <input
              id="ob-name"
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              placeholder="Your name"
            />
            <p className={styles.label}>Units</p>
            <div className={styles.choices}>
              <button
                type="button"
                className={`${styles.choice} ${units === 'metric' ? styles.choiceOn : ''}`}
                onClick={() => setUnits('metric')}
              >
                <strong>Metric</strong>
                <span>g / cm / kg</span>
              </button>
              <button
                type="button"
                className={`${styles.choice} ${units === 'us' ? styles.choiceOn : ''}`}
                onClick={() => setUnits('us')}
              >
                <strong>US-style</strong>
                <span>oz / ft / lb</span>
              </button>
            </div>
            <div className={styles.row}>
              <button type="button" className={styles.ghost} onClick={() => setStep(1)}>
                Back
              </button>
              <button type="button" className="btn-primary" onClick={() => setStep(3)}>
                Continue
              </button>
            </div>
          </>
        )}

        {id === 'done' && (
          <>
            <h1>You’re set</h1>
            <p className={styles.lede}>
              Head to Today and log what you ate. If you turned on coaching, you’ll find a Coach tab after this.
            </p>
            {error && <p className={styles.error}>{error}</p>}
            <div className={styles.row}>
              <button type="button" className={styles.ghost} onClick={() => setStep(2)}>
                Back
              </button>
              <button type="button" className="btn-primary" onClick={finish} disabled={busy}>
                {busy ? 'Saving…' : 'Go to Today'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
