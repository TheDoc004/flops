import { useEffect, useState } from 'react';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis,
  Tooltip, CartesianGrid, ResponsiveContainer, Legend,
} from 'recharts';
import RangeSelector from '../components/RangeSelector';
import LogEntryRow from '../components/LogEntryRow';
import { fetchLogRange, fetchLogForDate } from '../api/log';
import { groupByDate } from '../utils/macros';

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function getRangeStart(days) {
  const d = new Date();
  d.setDate(d.getDate() - (days - 1));
  return d.toISOString().slice(0, 10);
}

export default function History() {
  const [range, setRange] = useState(30);
  const [chartData, setChartData] = useState([]);
  const [selectedDate, setSelectedDate] = useState('');
  const [dayEntries, setDayEntries] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => { loadRange(); }, [range]);

  async function loadRange() {
    try {
      const entries = await fetchLogRange(getRangeStart(range), todayISO());
      setChartData(groupByDate(entries));
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleDateChange(e) {
    const date = e.target.value;
    setSelectedDate(date);
    if (!date) { setDayEntries([]); return; }
    try { setDayEntries(await fetchLogForDate(date)); }
    catch (e) { setError(e.message); }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h1 style={{ margin: 0 }}>History & Trends</h1>
        <RangeSelector value={range} onChange={setRange} />
      </div>

      {error && <p className="error">{error}</p>}

      <div className="card" style={{ marginBottom: 20 }}>
        <h3 style={{ marginTop: 0 }}>Calories — last {range} days</h3>
        {chartData.length === 0 ? (
          <p className="empty-state">No data in this range.</p>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Line type="monotone" dataKey="calories" stroke="#f59e0b" strokeWidth={2} dot={false} name="Calories" />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <h3 style={{ marginTop: 0 }}>Macro breakdown — last {range} days</h3>
        {chartData.length === 0 ? (
          <p className="empty-state">No data in this range.</p>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend />
              <Bar dataKey="protein_g" stackId="a" fill="#3b82f6" name="Protein (g)" />
              <Bar dataKey="carbs_g"   stackId="a" fill="#10b981" name="Carbs (g)" />
              <Bar dataKey="fat_g"     stackId="a" fill="#ef4444" name="Fat (g)" />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Browse a day</h3>
        <input
          type="date"
          value={selectedDate}
          max={todayISO()}
          onChange={handleDateChange}
          style={{ marginBottom: 12, width: 'auto' }}
        />
        {selectedDate && (
          dayEntries.length === 0
            ? <p className="empty-state">No meals logged on {selectedDate}.</p>
            : dayEntries.map(entry => <LogEntryRow key={entry.id} entry={entry} onDelete={null} />)
        )}
      </div>
    </div>
  );
}
