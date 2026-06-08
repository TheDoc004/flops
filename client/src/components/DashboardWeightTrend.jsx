import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';
import { fetchBodyWeights } from '../api/profile';
import { listLocalDatesInclusive } from '../utils/goalAdherence';
import { kgToLb } from '../utils/bodyUnits';
import { addDaysLocal } from '../utils/dateLocal';

export default function DashboardWeightTrend({ today, bodyUnits, rangeDays, enabled, refreshKey = 0 }) {
  const [weightRows, setWeightRows] = useState([]);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    if (!enabled) { setWeightRows([]); return; }
    let cancelled = false;
    (async () => {
      setLoadError('');
      try {
        const start = addDaysLocal(today, -(rangeDays - 1));
        const wData = await fetchBodyWeights(start, today);
        if (cancelled) return;
        setWeightRows(Array.isArray(wData) ? wData : []);
      } catch (e) {
        if (!cancelled) {
          setWeightRows([]);
          setLoadError(e.message || 'Failed to load weight data');
        }
      }
    })();
    return () => { cancelled = true; };
  }, [today, enabled, rangeDays, refreshKey]);

  const chartData = useMemo(() => {
    const start = addDaysLocal(today, -(rangeDays - 1));
    const dates = listLocalDatesInclusive(start, today);
    const weightByDate = {};
    for (const r of weightRows) weightByDate[r.date] = r.weight_kg;
    return dates.map(date => ({
      date,
      weightY:
        weightByDate[date] != null
          ? bodyUnits === 'us'
            ? kgToLb(weightByDate[date])
            : weightByDate[date]
          : null,
    }));
  }, [weightRows, today, rangeDays, bodyUnits]);

  const yWeightUnit = bodyUnits === 'us' ? 'lb' : 'kg';
  const hasAnyWeight = weightRows.length > 0;

  if (!enabled) return null;

  return (
    <div className="card" style={{ marginBottom: 16, padding: '16px 20px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
        <div>
          <h3 style={{
            margin: 0, fontSize: 22, fontWeight: 400, color: '#1e1b4b',
            fontFamily: "'DM Serif Display', Georgia, serif",
          }}>
            Weight trend
          </h3>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: '#6b7280' }}>
            Last {rangeDays} days · {yWeightUnit}
          </p>
        </div>
        <Link to="/plan/profile" style={{ fontSize: 12, color: '#9ca3af', alignSelf: 'flex-start' }}>
          Profile →
        </Link>
      </div>

      {loadError && <p className="error" style={{ marginTop: 0 }}>{loadError}</p>}

      {!hasAnyWeight && !loadError ? (
        <p style={{ margin: 0, fontSize: 13, color: '#9ca3af' }}>
          No weight entries in this range yet.
        </p>
      ) : (
        <ResponsiveContainer width="100%" height={200}>
          <ComposedChart data={chartData} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="#ececec" strokeDasharray="4 4" vertical={false} />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 10, fill: '#6b7280' }}
              tickFormatter={v =>
                typeof v === 'string' && v.length >= 10
                  ? `${v.slice(5, 7)}/${v.slice(8, 10)}`
                  : v
              }
              axisLine={{ stroke: '#e5e7eb' }}
              tickLine={false}
            />
            <YAxis
              yAxisId="weight"
              orientation="left"
              domain={['auto', 'auto']}
              tick={{ fontSize: 10, fill: '#6b7280' }}
              width={44}
              axisLine={false}
              tickLine={false}
              tickFormatter={v => (Number.isFinite(v) ? Number(v).toFixed(1) : v)}
            />
            <Tooltip
              contentStyle={{ borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 12 }}
              formatter={(value, name) => {
                if (value == null || !Number.isFinite(Number(value))) return ['—', name];
                return [`${Number(value).toFixed(1)} ${yWeightUnit}`, 'Weight'];
              }}
              labelFormatter={label => label}
            />
            <Line
              yAxisId="weight"
              type="natural"
              dataKey="weightY"
              stroke="#312e81"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 5, fill: '#312e81', stroke: '#fff', strokeWidth: 2 }}
              connectNulls
              name="Weight"
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
