import { useEffect, useState } from 'react';
import LogEntryRow from '../components/LogEntryRow';
import LogMealModal from '../components/LogMealModal';
import MacroTotals from '../components/MacroTotals';
import { fetchLogForDate, createLogEntry, deleteLogEntry } from '../api/log';
import { sumMacros } from '../utils/macros';
import { useTargets } from '../hooks/useTargets';

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

const MACRO_LABELS = { calories: 'Calories', protein_g: 'Protein (g)', carbs_g: 'Carbs (g)', fat_g: 'Fat (g)' };

export default function Dashboard() {
  const today = todayISO();
  const [entries, setEntries] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [error, setError] = useState('');
  const { targets, setTarget } = useTargets();

  useEffect(() => { load(); }, []);

  async function load() {
    try { setEntries(await fetchLogForDate(today)); }
    catch (e) { setError(e.message); }
  }

  async function handleLog(data) {
    await createLogEntry({ ...data, date: today });
    load();
  }

  async function handleDelete(entry) {
    try { await deleteLogEntry(entry.id); load(); }
    catch (e) { setError(e.message); }
  }

  const totals = sumMacros(entries);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <h1 style={{ margin: 0 }}>Today</h1>
          <p style={{ margin: 0, color: '#6b7280', fontSize: 14 }}>{today}</p>
        </div>
        <button className="btn-primary" onClick={() => setShowModal(true)}>+ Log a Meal</button>
      </div>

      {error && <p className="error">{error}</p>}

      <MacroTotals totals={totals} targets={targets} />

      <div className="card" style={{ marginBottom: 16 }}>
        {entries.length === 0
          ? <p className="empty-state">No meals logged today. Hit "+ Log a Meal" to get started.</p>
          : entries.map(entry => <LogEntryRow key={entry.id} entry={entry} onDelete={handleDelete} />)
        }
      </div>

      <details>
        <summary style={{ cursor: 'pointer', color: '#6b7280', fontSize: 13, userSelect: 'none' }}>Set daily targets</summary>
        <div className="card" style={{ marginTop: 8, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          {Object.entries(MACRO_LABELS).map(([macro, label]) => (
            <div key={macro}>
              <label style={{ fontSize: 12 }}>{label}</label>
              <input
                type="number" min="0" step="1"
                style={{ width: 100 }}
                value={targets[macro] ?? ''}
                onChange={e => setTarget(macro, e.target.value === '' ? null : Number(e.target.value))}
              />
            </div>
          ))}
        </div>
      </details>

      {showModal && <LogMealModal onLog={handleLog} onClose={() => setShowModal(false)} />}
    </div>
  );
}
