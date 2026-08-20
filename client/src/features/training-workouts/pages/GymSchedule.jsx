import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchGymSchedule, fetchGymTemplates, saveGymSchedule } from '@shared/api/gym';
import { ISO_WEEKDAY_LABELS, SUNDAY_FIRST_WEEKDAYS } from '@shared/utils/weekday';
import Reveal from '@shared/ui/Reveal';
import styles from '../Gym.module.css';

export default function GymSchedule() {
  const [days, setDays] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([fetchGymSchedule(), fetchGymTemplates()])
      .then(([d, t]) => { setDays(d); setTemplates(t); })
      .catch(e => setError(e.message));
  }, []);

  function patch(weekday, upd) {
    setDays(list => list.map(d => (d.weekday === weekday ? { ...d, ...upd } : d)));
  }

  async function save() {
    setSaving(true);
    setError('');
    try {
      setDays(await saveGymSchedule(days));
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <Reveal className={styles.toolbar}>
        <div>
          <h2 className="section-title">Schedule</h2>
          <p className={styles.lede}>Assign a workout template to each training day. Today opens that template.</p>
        </div>
        <button type="button" className="btn-primary" onClick={() => void save()} disabled={saving}>
          {saving ? 'Saving…' : 'Save week'}
        </button>
      </Reveal>
      {error && <p className="error">{error}</p>}
      {templates.length === 0 && (
        <p className="empty-state">
          Add a workout in <Link to="/training/workouts">Workouts</Link> first.
        </p>
      )}
      <div className={styles.dayGrid}>
        {SUNDAY_FIRST_WEEKDAYS.map(w => {
          const d = days.find(x => x.weekday === w) || { weekday: w, enabled: 0 };
          return (
            <div key={w} className="card" style={{ margin: 0, padding: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                <strong>{ISO_WEEKDAY_LABELS[w]}</strong>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
                  <input
                    type="checkbox"
                    checked={!!d.enabled}
                    onChange={e => patch(w, { enabled: e.target.checked ? 1 : 0 })}
                  />
                  Train
                </label>
              </div>
              {!!d.enabled && (
                <div className={styles.targets} style={{ marginTop: 12 }}>
                  <label style={{ flex: '1 1 180px' }}>Workout
                    <select
                      value={d.template_id || ''}
                      onChange={e => patch(w, { template_id: e.target.value ? Number(e.target.value) : null })}
                    >
                      <option value="">Choose…</option>
                      {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  </label>
                  <label>Minutes
                    <input
                      type="number"
                      min="0"
                      value={d.duration_min ?? ''}
                      onChange={e => patch(w, { duration_min: e.target.value })}
                    />
                  </label>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
