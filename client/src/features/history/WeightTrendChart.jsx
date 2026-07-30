import { useEffect, useMemo, useState } from 'react';
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
import ChartReveal from '@shared/ui/ChartReveal';
import useMediaQuery from '@shared/hooks/useMediaQuery';
import { listLocalDatesInclusive } from '@features/adherence';
import { kgToLb } from '@shared/utils/bodyUnits';

/**
 * Weight over a date range. Lives in History (its home since Today became a
 * do-things-only tab) and follows the range you've selected there, rather than
 * a separate setting — the chart shows the period you're already looking at.
 *
 * @param start ISO date, inclusive
 * @param end ISO date, inclusive
 */
export default function WeightTrendChart({ start, end, bodyUnits, noCard = false }) {
  const [weightRows, setWeightRows] = useState([]);
  const [loadError, setLoadError] = useState('');
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');

  useEffect(() => {
    // No range means the component renders nothing anyway — no state to clear.
    if (!start || !end) return undefined;
    let cancelled = false;
    (async () => {
      setLoadError('');
      try {
        const wData = await fetchBodyWeights(start, end);
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
  }, [start, end]);

  const chartData = useMemo(() => {
    const dates = start && end ? listLocalDatesInclusive(start, end) : [];
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
  }, [weightRows, start, end, bodyUnits]);

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
  const dayCount = chartData.length;
  const hasAnyWeight = weightRows.length > 0;

  if (!start || !end) return null;

  const inner = (
    <>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
        <div>
          <h3 className="section-title">
            Weight trend
          </h3>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: '#6b7280' }}>
            {dayCount} day{dayCount === 1 ? '' : 's'} · {yWeightUnit}
          </p>
        </div>
      </div>

      {loadError && <p className="error" style={{ marginTop: 0 }}>{loadError}</p>}

      {!hasAnyWeight && !loadError ? (
        <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-faint)' }}>
          No weight entries in this range yet.
        </p>
      ) : (
        <ChartReveal height={200}>
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
              isAnimationActive={!reduceMotion}
              animationDuration={900}
            />
          </ComposedChart>
        </ResponsiveContainer>
        </ChartReveal>
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
