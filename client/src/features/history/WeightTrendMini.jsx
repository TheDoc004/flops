import { useEffect, useMemo, useState } from 'react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip } from 'recharts';
import { fetchBodyWeights } from '@shared/api/profile';
import { addDaysLocal } from '@shared/utils/dateLocal';
import { kgToLb } from '@shared/utils/bodyUnits';

function shortDate(iso) {
  if (!iso || iso.length < 10) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Compact weight sparkline for the Today dashboard canvas. */
export default function WeightTrendMini({ today, bodyUnits, days = 14 }) {
  const [rows, setRows] = useState([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const start = addDaysLocal(today, -days);
        const data = await fetchBodyWeights(start, today);
        if (!cancelled) setRows(Array.isArray(data) ? data.filter(r => r.weight_kg != null) : []);
      } catch {
        if (!cancelled) setRows([]);
      }
    })();
    return () => { cancelled = true; };
  }, [today, days]);

  const chartData = useMemo(() => {
    const unit = bodyUnits === 'us' ? 'lb' : 'kg';
    return rows.map(r => ({
      date: r.date,
      label: shortDate(r.date),
      weight: bodyUnits === 'us' ? kgToLb(r.weight_kg) : r.weight_kg,
      unit,
    }));
  }, [rows, bodyUnits]);

  if (!chartData.length) {
    return (
      <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-muted)' }}>
        Log a few weigh-ins to see your trend here.
      </p>
    );
  }

  return (
    <div>
      <ResponsiveContainer width="100%" height={120}>
        <LineChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
          <YAxis tick={{ fontSize: 10 }} width={36} domain={['auto', 'auto']} />
          <Tooltip formatter={(v, _n, p) => [`${Number(v).toFixed(1)} ${p.payload.unit}`, 'Weight']} />
          <Line type="monotone" dataKey="weight" stroke="var(--color-primary)" strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
