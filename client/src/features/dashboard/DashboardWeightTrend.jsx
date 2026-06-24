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
import { fetchBodyWeights } from '@shared/api/profile';
import { listLocalDatesInclusive } from '@features/adherence';
import { kgToLb } from '@shared/utils/bodyUnits';
import { addDaysLocal } from '@shared/utils/dateLocal';

export default function DashboardWeightTrend({ today, bodyUnits, rangeDays, enabled, refreshKey = 0, noCard = false }) {
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
    return dates.map(date => {
      const logged = weightByDate[date] != null;
      return {
        date,
        weightY: logged
          ? (bodyUnits === 'us' ? kgToLb(weightByDate[date]) : weightByDate[date])
          : null,
        hasEntry: logged,
      };
    });
  }, [weightRows, today, rangeDays, bodyUnits]);

  // Padded Y-axis domain — keeps the line away from the chart edges.
  // Uses 15% of the weight range as breathing room, minimum 0.5 units.
  const yDomain = useMemo(() => {
    const values = chartData
      .filter(d => d.hasEntry && d.weightY != null)
      .map(d => d.weightY);
    if (values.length === 0) return ['auto', 'auto'];
    const minVal = Math.min(...values);
    const maxVal = Math.max(...values);
    const range = maxVal - minVal;
    const padding = Math.max(0.5, range * 0.15);
    return [minVal - padding, maxVal + padding];
  }, [chartData]);

  const yWeightUnit = bodyUnits === 'us' ? 'lb' : 'kg';
  const hasAnyWeight = weightRows.length > 0;

  if (!enabled) return null;

  const inner = (
    <>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
        <div>
          <h3 className="section-title">
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
          {/* top/right margin gives dots (r=4 + strokeWidth=2) room so they aren't clipped;
              left margin keeps the y-axis labels off the card edge */}
          <ComposedChart data={chartData} margin={{ top: 16, right: 16, left: 8, bottom: 4 }}>
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
              /* inset the first/last data points so edge dots have breathing room */
              padding={{ left: 12, right: 12 }}
            />
            <YAxis
              yAxisId="weight"
              orientation="left"
              domain={yDomain}
              tick={{ fontSize: 10, fill: '#6b7280' }}
              width={44}
              axisLine={false}
              tickLine={false}
              tickFormatter={v => (Number.isFinite(v) ? Number(v).toFixed(1) : v)}
            />
            <Tooltip
              contentStyle={{ borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 12 }}
              formatter={(value, _name, props) => {
                if (!props.payload?.hasEntry) return ['No weight logged', 'Weight'];
                if (value == null || !Number.isFinite(Number(value))) return ['—', 'Weight'];
                return [`${Number(value).toFixed(1)} ${yWeightUnit}`, 'Weight'];
              }}
              labelFormatter={label => label}
            />
            <Line
              yAxisId="weight"
              type="monotone"
              dataKey="weightY"
              stroke="#312e81"
              strokeWidth={2}
              dot={(props) => {
                const { cx, cy, payload } = props;
                if (!payload?.hasEntry || !Number.isFinite(cx) || !Number.isFinite(cy)) {
                  return null;
                }
                return (
                  <circle
                    cx={cx}
                    cy={cy}
                    r={4}
                    fill="#312e81"
                    stroke="#fff"
                    strokeWidth={2}
                  />
                );
              }}
              activeDot={{ r: 5, fill: '#312e81', stroke: '#fff', strokeWidth: 2 }}
              /* connectNulls: weight is continuous, so connect logged weigh-ins
                 across missing days (e.g. 06/12 → 06/24). Recharts SKIPS null
                 rows entirely when connecting — it never plots them as 0 or a
                 bottom point — and the custom dot renderer above only draws dots
                 on days with a real entry. Missing days still occupy the x-axis. */
              connectNulls
              name="Weight"
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </>
  );

  if (noCard) return inner;
  return (
    <div className="card" style={{ marginBottom: 16, padding: '16px 20px' }}>
      {inner}
    </div>
  );
}
