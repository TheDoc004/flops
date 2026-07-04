import { useEffect, useRef, useState } from 'react';
import { fetchProfile, saveProfile } from '@shared/api/profile';

// Views the dashboard's adherence card can be pinned to. Mirrors the same
// dash_adherence_view setting on the Profile page.
const DASH_VIEWS = [
  { value: '7d',       label: 'Last 7 days' },
  { value: '2w',       label: 'Last 2 weeks' },
  { value: '3w',       label: 'Last 3 weeks' },
  { value: 'calendar', label: 'Month calendar' },
];

/**
 * Compact auto-saving control for which adherence view the dashboard card
 * shows. Lives under the History calendar; also mirrored in Profile.
 */
export default function DashboardAdherencePicker() {
  const [view, setView] = useState('7d');
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const interacted = useRef(false);

  useEffect(() => {
    let cancelled = false;
    fetchProfile()
      .then(p => {
        if (!cancelled && DASH_VIEWS.some(o => o.value === p?.dash_adherence_view)) {
          setView(p.dash_adherence_view);
        }
      })
      .catch(() => { /* keep the default; saving still works */ });
    return () => { cancelled = true; };
  }, []);

  // Auto-save on change (guard skips the initial load), same pattern as
  // Profile's dashboard prefs.
  useEffect(() => {
    if (!interacted.current) return undefined;
    let cancelled = false;
    setError('');
    setSaved(false);
    saveProfile({ dash_adherence_view: view })
      .then(() => {
        if (!cancelled) {
          setSaved(true);
          setTimeout(() => { if (!cancelled) setSaved(false); }, 2000);
        }
      })
      .catch(err => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; };
  }, [view]);

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <label htmlFor="adh-dash-view" style={{ margin: 0, whiteSpace: 'nowrap' }}>Show on dashboard</label>
        <select
          id="adh-dash-view"
          value={view}
          onChange={e => {
            interacted.current = true;
            setView(e.target.value);
          }}
          style={{ width: 'auto', minWidth: 170 }}
        >
          {DASH_VIEWS.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        {saved && <span style={{ fontSize: 12, color: 'var(--color-success)' }}>Saved.</span>}
      </div>
      {error && <p className="error" style={{ marginTop: 8 }}>{error}</p>}
    </div>
  );
}
