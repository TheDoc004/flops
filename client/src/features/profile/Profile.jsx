import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchProfile, saveProfile } from '@shared/api/profile';
import { DEFAULT_DASH_LAYOUT, DASH_LAYOUT_VERSION } from '../dashboard/dashboardLayout';
import { getInviteCode, linkCoach, myCoaches, revokeCoach } from '@shared/api/coach';
import { useAuth } from '@shared/context/AuthContext';
import { useMacroUnits } from '@shared/context/MacroUnitsContext';
import {
  cmToFeetInches,
  feetInchesToCm,
  kgToWeightInputValue,
  parseWeightInputToKg,
} from '@shared/utils/bodyUnits';
import Reveal from '@shared/ui/Reveal';

const ACTIVITY_OPTIONS = [
  { value: '', label: '—' },
  { value: 'sedentary', label: 'Sedentary' },
  { value: 'light', label: 'Light' },
  { value: 'moderate', label: 'Moderate' },
  { value: 'active', label: 'Active' },
  { value: 'very_active', label: 'Very active' },
];

export default function Profile() {
  const { macroUnits, setMacroUnits, bodyUnits, setBodyUnits } = useMacroUnits();
  const { user, isCoach, updateMe, logout } = useAuth();
  const [form, setForm] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [dashAdherenceView, setDashAdherenceView] = useState('7d');
  const [dashSupplementsEnabled, setDashSupplementsEnabled] = useState(true);
  const [dashWeightEnabled, setDashWeightEnabled] = useState(true);
  const [dashMealsEnabled, setDashMealsEnabled] = useState(true);
  const [dashWeightChartCardEnabled, setDashWeightChartCardEnabled] = useState(false);
  const [dashPrefsSaved, setDashPrefsSaved] = useState(false);
  const [dashPrefsError, setDashPrefsError] = useState('');
  const [dashResetBusy, setDashResetBusy] = useState(false);
  // Tracks whether the user has interacted with dash prefs yet.
  // Prevents auto-save from firing during the initial data load.
  const dashInteracted = useRef(false);

  const [coachBusy, setCoachBusy] = useState(false);
  const [inviteCode, setInviteCode] = useState('');
  const [linkCode, setLinkCode] = useState('');
  const [scopes, setScopes] = useState({ nutrition: true, training: true, weight: true });
  const [coaches, setCoaches] = useState([]);
  const [coachMsg, setCoachMsg] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const p = await fetchProfile();
        if (cancelled) return;
        setForm({
          height_cm: p.height_cm ?? '',
          weight_kg: p.weight_kg ?? '',
          age: p.age ?? '',
          sex: p.sex ?? '',
          goal_weight_kg: p.goal_weight_kg ?? '',
          activity_level: p.activity_level ?? '',
          maintenance_calories: p.maintenance_calories ?? '',
        });
        setDashAdherenceView(['7d', '2w', '3w', 'calendar'].includes(p.dash_adherence_view) ? p.dash_adherence_view : '7d');
        setDashSupplementsEnabled(p.dash_supplements_enabled !== 0 && p.dash_supplements_enabled !== false);
        setDashWeightEnabled(p.dash_weight_enabled !== 0 && p.dash_weight_enabled !== false);
        setDashMealsEnabled(p.dash_meals_enabled !== 0 && p.dash_meals_enabled !== false);
        setDashWeightChartCardEnabled(
          p.dash_weight_chart_card_enabled === 1
          || p.dash_weight_chart_card_enabled === true
          || p.dash_weight_chart_enabled === 1
          || p.dash_weight_chart_enabled === true,
        );
        const linked = await myCoaches();
        if (!cancelled) setCoaches(linked);
        if (user?.is_coach) {
          const inv = await getInviteCode();
          if (!cancelled) setInviteCode(inv.invite_code || '');
        }
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user?.is_coach]);

  const set = key => e => {
    setForm(f => ({ ...f, [key]: e.target.value }));
    setSaved(false);
  };

  function setHeightFeet(feetStr) {
    setForm(f => {
      const prev = cmToFeetInches(f.height_cm === '' || f.height_cm == null ? null : Number(f.height_cm));
      const cm = feetInchesToCm(feetStr, prev.inches);
      return { ...f, height_cm: cm === null ? '' : cm };
    });
    setSaved(false);
  }

  function setHeightInches(inchesStr) {
    setForm(f => {
      const prev = cmToFeetInches(f.height_cm === '' || f.height_cm == null ? null : Number(f.height_cm));
      const cm = feetInchesToCm(prev.feet, inchesStr);
      return { ...f, height_cm: cm === null ? '' : cm };
    });
    setSaved(false);
  }

  function setWeightField(key) {
    return e => {
      const raw = e.target.value;
      setForm(f => {
        if (bodyUnits === 'us') {
          const kg = parseWeightInputToKg(raw, 'us');
          return { ...f, [key]: kg === null ? '' : kg };
        }
        return { ...f, [key]: raw };
      });
      setSaved(false);
    };
  }

  async function handleSaveProfile(e) {
    e.preventDefault();
    setError('');
    setSaved(false);
    try {
      const body = {
        height_cm: form.height_cm === '' ? null : Number(form.height_cm),
        weight_kg: form.weight_kg === '' ? null : Number(form.weight_kg),
        age: form.age === '' ? null : Number(form.age),
        sex: form.sex || null,
        goal_weight_kg: form.goal_weight_kg === '' ? null : Number(form.goal_weight_kg),
        activity_level: form.activity_level || null,
        maintenance_calories: form.maintenance_calories === '' ? null : Number(form.maintenance_calories),
        macro_units: macroUnits,
        body_units: bodyUnits,
      };
      const updated = await saveProfile(body);
      setForm({
        height_cm: updated.height_cm ?? '',
        weight_kg: updated.weight_kg ?? '',
        age: updated.age ?? '',
        sex: updated.sex ?? '',
        goal_weight_kg: updated.goal_weight_kg ?? '',
        activity_level: updated.activity_level ?? '',
        maintenance_calories: updated.maintenance_calories ?? '',
      });
      setSaved(true);
    } catch (err) {
      setError(err.message);
    }
  }

  async function toggleCoach(next) {
    setCoachBusy(true);
    setCoachMsg('');
    try {
      const u = await updateMe({ is_coach: next });
      if (next) {
        const inv = await getInviteCode();
        setInviteCode(inv.invite_code || u.invite_code || '');
        setCoachMsg('Coaching tools enabled. Share your invite code with clients.');
      } else {
        setCoachMsg('Coaching tools turned off. Existing client links stay until they revoke.');
      }
    } catch (err) {
      setCoachMsg(err.message);
    } finally {
      setCoachBusy(false);
    }
  }

  async function handleLinkCoach(e) {
    e.preventDefault();
    setCoachBusy(true);
    setCoachMsg('');
    try {
      await linkCoach(linkCode.trim().toUpperCase(), {
        scope_nutrition: scopes.nutrition,
        scope_training: scopes.training,
        scope_weight: scopes.weight,
      });
      setLinkCode('');
      setCoaches(await myCoaches());
      setCoachMsg('Coach linked. They can see the scopes you allowed.');
    } catch (err) {
      setCoachMsg(err.message);
    } finally {
      setCoachBusy(false);
    }
  }

  async function handleRevoke(coachId) {
    setCoachBusy(true);
    setCoachMsg('');
    try {
      await revokeCoach(coachId);
      setCoaches(await myCoaches());
      setCoachMsg('Access revoked.');
    } catch (err) {
      setCoachMsg(err.message);
    } finally {
      setCoachBusy(false);
    }
  }

  // Auto-save adherence view only — card visibility is edited in the layout editor.
  useEffect(() => {
    if (!dashInteracted.current) return;
    let cancelled = false;
    setDashPrefsError('');
    setDashPrefsSaved(false);
    saveProfile({ dash_adherence_view: dashAdherenceView }).then(() => {
      if (!cancelled) {
        setDashPrefsSaved(true);
        setTimeout(() => { if (!cancelled) setDashPrefsSaved(false); }, 2000);
      }
    }).catch(err => {
      if (!cancelled) setDashPrefsError(err.message);
    });
    return () => { cancelled = true; };
  }, [dashAdherenceView]);

  async function handleResetDashboardLayout() {
    dashInteracted.current = true;
    setDashResetBusy(true);
    setDashPrefsError('');
    setDashSupplementsEnabled(true);
    setDashWeightEnabled(true);
    setDashMealsEnabled(true);
    setDashWeightChartCardEnabled(false);
    try {
      await saveProfile({
        dash_layout_json: { version: DASH_LAYOUT_VERSION, cards: DEFAULT_DASH_LAYOUT },
        dash_supplements_enabled: 1,
        dash_weight_enabled: 1,
        dash_meals_enabled: 1,
        dash_weight_chart_card_enabled: 0,
      });
      setDashPrefsSaved(true);
      setTimeout(() => setDashPrefsSaved(false), 2000);
    } catch (err) {
      setDashPrefsError(err.message);
    } finally {
      setDashResetBusy(false);
    }
  }

  if (loading) {
    return <p style={{ color: 'var(--color-text-muted)' }}>Loading</p>;
  }

  const heightFeetIn = cmToFeetInches(
    form.height_cm === '' || form.height_cm == null ? null : Number(form.height_cm)
  );

  const heightLabel = bodyUnits === 'us' ? 'Height' : 'Height (cm)';

  const H3 = ({ children }) => (
    <h3 className="section-title" style={{ marginBottom: 10 }}>{children}</h3>
  );

  const UnitOption = ({ name, value, current, onChange, label, sub }) => (
    <label style={{
      display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer',
      padding: '8px 10px', borderRadius: 9,
      border: `1px solid ${current === value ? 'var(--color-primary)' : '#e8e4dc'}`,
      background: current === value ? 'var(--color-primary-subtle)' : 'transparent',
      transition: 'border-color 0.12s, background 0.12s',
    }}>
      <input
        type="radio"
        name={name}
        checked={current === value}
        onChange={() => onChange(value)}
        style={{ flexShrink: 0, marginTop: 3, width: 'auto' }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-primary-ink)', lineHeight: 1.3 }}>{label}</div>
        <div style={{ fontSize: 12, color: 'var(--color-text-faint)', marginTop: 1 }}>{sub}</div>
      </div>
    </label>
  );

  return (
    <div>
      <Reveal>
        <h1 className="page-title" style={{ margin: 0 }}>Profile</h1>
      </Reveal>

      {error && <p className="error">{error}</p>}

      <Reveal delay={40} className="card" style={{ marginBottom: 16 }}>
        <H3>Account</H3>
        <p style={{ margin: '0 0 10px', color: '#6b7280', fontSize: 13 }}>
          Signed in as {user?.email || user?.display_name || `User #${user?.id}`}
        </p>
        <button type="button" className="btn-secondary" onClick={() => logout()}>
          Sign out
        </button>
      </Reveal>

      <Reveal delay={50} className="card" style={{ marginBottom: 16 }}>
        <H3>Coaching tools</H3>
        <p style={{ margin: '0 0 10px', color: '#6b7280', fontSize: 13 }}>
          Unlock a Coach tab to share an invite code and view consented client summaries (read-only).
        </p>
        <label style={{
          display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer',
          padding: '8px 10px', marginBottom: 10, borderRadius: 9,
          border: `1px solid ${isCoach ? 'var(--color-primary)' : '#e8e4dc'}`,
          background: isCoach ? 'var(--color-primary-subtle)' : 'transparent',
        }}>
          <input
            type="checkbox"
            checked={!!isCoach}
            disabled={coachBusy}
            onChange={e => toggleCoach(e.target.checked)}
            style={{ flexShrink: 0, marginTop: 3, width: 'auto' }}
          />
          <div>
            <div style={{ fontSize: 13, fontWeight: 500 }}>Become a coach / coaching tools</div>
            <div style={{ fontSize: 12, color: 'var(--color-text-faint)' }}>
              Instagram-style upgrade — same account, extra tools
            </div>
          </div>
        </label>
        {isCoach && inviteCode ? (
          <p style={{ fontSize: 13, margin: '0 0 8px' }}>
            Your invite code: <code style={{ letterSpacing: '0.08em', fontWeight: 700 }}>{inviteCode}</code>
          </p>
        ) : null}
        {coachMsg && <p style={{ fontSize: 13, color: '#059669', margin: '8px 0 0' }}>{coachMsg}</p>}
      </Reveal>

      <Reveal delay={55} className="card" style={{ marginBottom: 16 }}>
        <H3>Link a coach</H3>
        <p style={{ margin: '0 0 10px', color: '#6b7280', fontSize: 13 }}>
          Paste your coach&apos;s invite code. They only see what you allow; you can revoke anytime.
        </p>
        {coaches.length > 0 && (
          <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 12px' }}>
            {coaches.map(c => (
              <li key={c.id} style={{
                display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center',
                padding: '8px 0', borderBottom: '1px solid #f0ebe3', fontSize: 13,
              }}>
                <div>
                  <strong>{c.coach_name || `Coach #${c.coach_user_id}`}</strong>
                  <div style={{ color: '#6b7280', fontSize: 12 }}>
                    Can see:{' '}
                    {[
                      c.scope_nutrition ? 'nutrition' : null,
                      c.scope_training ? 'training' : null,
                      c.scope_weight ? 'weight' : null,
                    ].filter(Boolean).join(', ') || 'nothing'}
                  </div>
                </div>
                <button type="button" disabled={coachBusy} onClick={() => handleRevoke(c.coach_user_id)}>
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        )}
        <form onSubmit={handleLinkCoach}>
          <label>Invite code</label>
          <input
            value={linkCode}
            onChange={e => setLinkCode(e.target.value.toUpperCase())}
            placeholder="ABCD1234"
            style={{ marginBottom: 8 }}
          />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 10, fontSize: 13 }}>
            {[
              ['nutrition', 'Nutrition'],
              ['training', 'Training'],
              ['weight', 'Weight'],
            ].map(([key, label]) => (
              <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input
                  type="checkbox"
                  checked={scopes[key]}
                  onChange={e => setScopes(s => ({ ...s, [key]: e.target.checked }))}
                  style={{ width: 'auto' }}
                />
                {label}
              </label>
            ))}
          </div>
          <button type="submit" className="btn-primary" disabled={coachBusy || !linkCode.trim()}>
            Link coach
          </button>
        </form>
      </Reveal>

      <Reveal delay={60} className="settings-grid">
        <div className="card settings-grid__card">
          <H3>Nutrition units</H3>
          <p style={{ margin: '0 0 10px', color: '#6b7280', fontSize: 13 }}>
            How protein, carbs &amp; fat appear in goals and the Dashboard.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            <UnitOption name="nutritionUnits" value="metric" current={macroUnits} onChange={setMacroUnits}
              label="Grams" sub="protein, carbs, fat in g" />
            <UnitOption name="nutritionUnits" value="us" current={macroUnits} onChange={setMacroUnits}
              label="Ounces" sub="protein, carbs, fat in oz" />
          </div>
        </div>

        <div className="card settings-grid__card">
          <H3>Body measurements</H3>
          <p style={{ margin: '0 0 10px', color: '#6b7280', fontSize: 13 }}>
            How height and weight appear on this page.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            <UnitOption name="bodyUnits" value="metric" current={bodyUnits} onChange={setBodyUnits}
              label="Metric" sub="cm / kg" />
            <UnitOption name="bodyUnits" value="us" current={bodyUnits} onChange={setBodyUnits}
              label="US-style" sub="ft / in / lb" />
          </div>
        </div>
        <div className="card settings-grid__card">
          <H3>Dashboard</H3>
          <p style={{ margin: '0 0 12px', color: 'var(--color-text-muted)', fontSize: 13 }}>
            Customize which cards appear on Today and how they&apos;re arranged.
          </p>
          <ul className="dash-pref-hints">
            {[
              {
                title: 'Take the same stack daily?',
                sub: 'Show a check-off strip under your macros',
                on: dashSupplementsEnabled,
              },
              {
                title: 'Weigh in on Today?',
                sub: "Show today's weight field on the dashboard",
                on: dashWeightEnabled,
              },
              {
                title: 'Want a quick weight trend?',
                sub: 'Add a 14-day sparkline card (desktop layout)',
                on: dashWeightChartCardEnabled,
              },
              {
                title: 'Log meals from Today?',
                sub: "Show today's meal list on the dashboard",
                on: dashMealsEnabled,
              },
            ].map(hint => (
              <li key={hint.title} className="dash-pref-hint">
                <div className="dash-pref-hint__copy">
                  <div className="dash-pref-hint__title">{hint.title}</div>
                  <div className="dash-pref-hint__sub">{hint.sub}</div>
                </div>
                <span className={`dash-pref-hint__badge${hint.on ? ' is-on' : ''}`}>
                  {hint.on ? 'On Today' : 'Hidden'}
                </span>
              </li>
            ))}
          </ul>
          <div style={{ marginTop: 'auto', paddingTop: 14 }}>
            <Link
              to="/?editLayout=1"
              className="btn-primary"
              style={{ display: 'inline-block', textDecoration: 'none', width: '100%', textAlign: 'center' }}
            >
              Customize dashboard
            </Link>
          </div>
          <div style={{ marginTop: 14 }}>
            <label style={{ marginBottom: 4 }}>Goal adherence view</label>
            <select
              value={dashAdherenceView}
              onChange={e => {
                dashInteracted.current = true;
                setDashAdherenceView(e.target.value);
              }}
            >
              <option value="7d">Last 7 days</option>
              <option value="2w">Last 2 weeks</option>
              <option value="3w">Last 3 weeks</option>
              <option value="calendar">Month calendar</option>
            </select>
          </div>
          <div style={{ marginTop: 12 }}>
            <button
              type="button"
              className="btn-secondary"
              style={{ fontSize: 13, width: '100%' }}
              disabled={dashResetBusy}
              onClick={() => { void handleResetDashboardLayout(); }}
            >
              {dashResetBusy ? 'Resetting…' : 'Reset layout to defaults'}
            </button>
          </div>
          {dashPrefsError && <p className="error" style={{ marginTop: 8 }}>{dashPrefsError}</p>}
          {dashPrefsSaved && (
            <p style={{ marginTop: 8, fontSize: 12, color: '#059669' }}>Saved.</p>
          )}
        </div>
      </Reveal>

      <Reveal>
      <form onSubmit={handleSaveProfile} className="card" style={{ marginBottom: 16 }}>
        <H3>Personal stats</H3>
        <div className="form-grid-2">
          {bodyUnits === 'us' ? (
            <div style={{ gridColumn: '1 / -1' }}>
              <label>{heightLabel}</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'flex-end' }}>
                <div style={{ width: 80 }}>
                  <span style={{ fontSize: 12, color: '#6b7280' }}>ft</span>
                  <input
                    type="number" min="0" max="8" step="1" inputMode="numeric"
                    value={heightFeetIn.feet}
                    onChange={e => setHeightFeet(e.target.value)}
                    placeholder="—"
                  />
                </div>
                <div style={{ width: 88 }}>
                  <span style={{ fontSize: 12, color: '#6b7280' }}>in</span>
                  <input
                    type="number" min="0" max="12" step="0.1" inputMode="decimal"
                    value={heightFeetIn.inches}
                    onChange={e => setHeightInches(e.target.value)}
                    placeholder="—"
                  />
                </div>
              </div>
            </div>
          ) : (
            <div>
              <label>{heightLabel}</label>
              <input type="number" min="0" step="0.1" value={form.height_cm} onChange={set('height_cm')} placeholder="Optional" />
            </div>
          )}

          <div>
            <label>{bodyUnits === 'us' ? 'Current weight (lb)' : 'Current weight (kg)'}</label>
            <input type="number" min="0" step="0.1"
              value={kgToWeightInputValue(form.weight_kg, bodyUnits)}
              onChange={setWeightField('weight_kg')} placeholder="Optional" />
          </div>
          <div>
            <label>Age</label>
            <input type="number" min="0" max="130" step="1" value={form.age} onChange={set('age')} placeholder="Optional" />
          </div>
          <div>
            <label>Sex</label>
            <select value={form.sex} onChange={set('sex')}>
              <option value="">—</option>
              <option value="male">Male</option>
              <option value="female">Female</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div>
            <label>{bodyUnits === 'us' ? 'Goal weight (lb)' : 'Goal weight (kg)'}</label>
            <input type="number" min="0" step="0.1"
              value={kgToWeightInputValue(form.goal_weight_kg, bodyUnits)}
              onChange={setWeightField('goal_weight_kg')} placeholder="Optional" />
          </div>
          <div>
            <label>Activity level</label>
            <select value={form.activity_level} onChange={set('activity_level')}>
              {ACTIVITY_OPTIONS.map(o => (
                <option key={o.value || 'empty'} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label>Estimated maintenance calories</label>
            <input type="number" min="0" step="1" value={form.maintenance_calories} onChange={set('maintenance_calories')} placeholder="Optional" />
          </div>
        </div>
        {saved && <p style={{ color: '#059669', fontSize: 14, marginTop: 12 }}>Profile saved.</p>}
        <div style={{ marginTop: 16 }}>
          <button type="submit" className="btn-primary">Save profile</button>
        </div>
      </form>
      </Reveal>
    </div>
  );
}
