import { useEffect, useMemo, useState } from 'react';
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';
import { fetchBodyWeights } from '@shared/api/profile';
import ChartReveal from '@shared/ui/ChartReveal';
import useMediaQuery from '@shared/hooks/useMediaQuery';
import { addDaysLocal, getLocalDateISO, parseLocalDateISO } from '@shared/utils/dateLocal';
import { kgToLb } from '@shared/utils/bodyUnits';
import { summarizeWeights, projectWeight, trendValueOn } from './weightStats';

/**
 * Chart colors. Validated with the dataviz palette script against the card
 * surface (#faf9f7): both sit inside the lightness band, clear the chroma floor,
 * and separate under every CVD simulation. The app's --color-primary (#312e81)
 * was the obvious pick but reads too dark for a data mark — it failed the band.
 */
const SERIES = '#4f46e5';   // measured weigh-ins
const TREND = '#b45309';    // fitted trend — dashed, because it is derived, not measured

/** How far back "All" reaches before giving up looking for weigh-ins. */
const ALL_LOOKBACK_DAYS = 1825; // ~5 years

const RANGES = [
  { key: '30', label: '1M', days: 30 },
  { key: '90', label: '3M', days: 90 },
  { key: '180', label: '6M', days: 180 },
  { key: 'all', label: 'All', days: ALL_LOOKBACK_DAYS },
];

const ARROW = { up: '↑', down: '↓', flat: '→' };

/** Signed, to one decimal: "+0.4 lb" / "−1.2 lb". */
function signed(value, unit) {
  if (value == null || !Number.isFinite(value)) return '—';
  const rounded = Math.round(value * 10) / 10;
  if (Math.abs(rounded) < 0.05) return `0 ${unit}`;
  return `${rounded > 0 ? '+' : '−'}${Math.abs(rounded).toFixed(1)} ${unit}`;
}

function fmt(value, unit) {
  return value == null || !Number.isFinite(value) ? '—' : `${value.toFixed(1)} ${unit}`;
}

function shortDate(iso) {
  if (!iso || iso.length < 10) return iso || '';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** One number in the row under the hero. */
function StatTile({ label, value, hint }) {
  return (
    <div style={{
      flex: '1 1 0', minWidth: 0, background: '#f8f6f2', border: '1px solid var(--color-surface-border)',
      borderRadius: 12, padding: '10px 12px',
    }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-faint)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        {label}
      </div>
      <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--color-text-strong)', fontVariantNumeric: 'tabular-nums', marginTop: 4, lineHeight: 1.1 }}>
        {value}
      </div>
      {hint && (
        <div style={{ fontSize: 11, color: 'var(--color-text-faint)', marginTop: 2 }}>{hint}</div>
      )}
    </div>
  );
}

/**
 * Weight over time: a headline number, the stats that give it context, the plot,
 * and what the trend implies.
 *
 * It carries its own range because weight and meals move on different clocks —
 * meals are reviewed a day at a time, weight only means anything over months.
 * Tying this to the day selection above made the default a single dot.
 *
 * Direction is shown with an arrow and a signed number in ordinary ink, NOT in
 * green/red. Without a goal weight set, "down" isn't good or bad — it depends
 * entirely on whether you're cutting or bulking, and the app doesn't know.
 */
export default function WeightTrendChart({ bodyUnits, noCard = false, defaultRange = '90' }) {
  const [rangeKey, setRangeKey] = useState(defaultRange);
  const [weightRows, setWeightRows] = useState([]);
  const [loadError, setLoadError] = useState('');
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');

  const range = RANGES.find(r => r.key === rangeKey) || RANGES[1];
  const end = getLocalDateISO();
  const fetchStart = addDaysLocal(end, -(range.days - 1));
  const unit = bodyUnits === 'us' ? 'lb' : 'kg';

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadError('');
      try {
        const wData = await fetchBodyWeights(fetchStart, end);
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
  }, [fetchStart, end]);

  // Convert once, here — every number downstream is already in display units so
  // the tiles and the plot can't drift apart.
  const points = useMemo(
    () => weightRows
      .filter(r => r?.date && r.weight_kg != null)
      .map(r => ({ date: r.date, value: bodyUnits === 'us' ? kgToLb(r.weight_kg) : r.weight_kg })),
    [weightRows, bodyUnits]
  );

  const stats = useMemo(() => summarizeWeights(points), [points]);
  const projection = useMemo(() => projectWeight(points, 7), [points]);

  // "All" looks back five years; start the axis at the first real weigh-in so
  // four months of data isn't a speck against five years of empty plot.
  const chartStart = useMemo(() => {
    if (rangeKey !== 'all') return fetchStart;
    const dates = points.map(p => p.date).sort();
    return dates.length ? dates[0] : fetchStart;
  }, [rangeKey, fetchStart, points]);

  // One row per WEIGH-IN, not per calendar day, plotted against a real time
  // axis. The per-day version emitted ~180 rows for 14 points on the 6M range,
  // so Recharts reconciled ~190 throwaway <g> nodes every animation frame —
  // that was the stutter. Gaps still read proportionally because the x-axis is
  // time-based rather than one slot per row.
  const chartData = useMemo(() => {
    const trend = stats?.trend || null;
    return points.map(p => ({
      t: parseLocalDateISO(p.date).getTime(),
      date: p.date,
      weightY: p.value,
      trendY: trend ? trendValueOn(trend, p.date) : null,
    }));
  }, [points, stats]);

  // Evenly spaced date ticks across the whole window, rather than letting the
  // axis fall back to tick-per-datapoint — otherwise a stretch with no weigh-ins
  // carries no labels and the reader can't see that time passed there at all.
  const { xDomain, xTicks } = useMemo(() => {
    const lo = parseLocalDateISO(chartStart).getTime();
    const hi = parseLocalDateISO(end).getTime();
    const count = 6;
    const ticks = Array.from({ length: count }, (_, i) => Math.round(lo + ((hi - lo) * i) / (count - 1)));
    return { xDomain: [lo, hi], xTicks: ticks };
  }, [chartStart, end]);

  // Pad the domain so the line never touches the frame, then snap the ends to a
  // round step so the axis reads 150.0 / 150.5 / 151.0 rather than 150.3 / 151.8.
  const { yDomain, yTicks } = useMemo(() => {
    const values = chartData.flatMap(d => [d.weightY, d.trendY]).filter(v => v != null && Number.isFinite(v));
    if (values.length === 0) return { yDomain: ['auto', 'auto'], yTicks: undefined };
    const minVal = Math.min(...values);
    const maxVal = Math.max(...values);
    const padding = Math.max(0.5, (maxVal - minVal) * 0.15);
    // Step scales with the spread: 0.5 for a tight range, 1/2/5 as it widens.
    const spread = (maxVal + padding) - (minVal - padding);
    const step = spread <= 4 ? 0.5 : spread <= 10 ? 1 : spread <= 25 ? 2 : 5;
    const lo = Math.floor((minVal - padding) / step) * step;
    const hi = Math.ceil((maxVal + padding) / step) * step;
    const ticks = [];
    for (let v = lo; v <= hi + 1e-9; v += step) ticks.push(Math.round(v * 100) / 100);
    return { yDomain: [lo, hi], yTicks: ticks };
  }, [chartData]);

  const hasAnyWeight = points.length > 0;

  const inner = (
    <>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <h3 className="section-title" style={{ margin: 0 }}>Weight trend</h3>
        {/* Its own range — deliberately not tied to the day selection above. */}
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          {RANGES.map(r => (
            <button
              key={r.key}
              type="button"
              className={r.key === rangeKey ? 'btn-primary' : 'btn-secondary'}
              onClick={() => setRangeKey(r.key)}
              aria-pressed={r.key === rangeKey}
              style={{ minHeight: 0, padding: '6px 12px', fontSize: 13 }}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {loadError && <p className="error" style={{ marginTop: 0 }}>{loadError}</p>}

      {!hasAnyWeight && !loadError ? (
        <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-faint)' }}>
          No weight entries in this range yet.
        </p>
      ) : (
        <>
          {/* ── Headline: the number you came for ── */}
          <div style={{
            background: '#f8f6f2', border: '1px solid var(--color-surface-border)', borderRadius: 14,
            padding: '14px 16px', marginBottom: 10,
          }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
              <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Current weight</span>
              <span style={{ fontSize: 12, color: 'var(--color-text-faint)' }}>{shortDate(stats.currentDate)}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginTop: 2 }}>
              <span style={{ fontSize: 'clamp(30px, 7vw, 40px)', fontWeight: 700, color: 'var(--color-text-strong)', fontVariantNumeric: 'tabular-nums', lineHeight: 1.05 }}>
                {stats.current.toFixed(1)} <span style={{ fontSize: '0.5em', fontWeight: 600, color: 'var(--color-text-muted)' }}>{unit}</span>
              </span>
              {stats.changeVsPrevious != null && (
                <span style={{ fontSize: 13, color: 'var(--color-text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                  {signed(stats.changeVsPrevious, unit)} <span style={{ color: 'var(--color-text-faint)' }}>vs last</span>
                </span>
              )}
            </div>
          </div>

          {/* ── Context for that number ── */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
            <StatTile label="Average" value={fmt(stats.average, unit)} hint={`${stats.count} weigh-in${stats.count === 1 ? '' : 's'}`} />
            <StatTile
              label="Change"
              value={signed(stats.changeOverRange, unit)}
              hint={stats.spanDays > 0 ? `over ${stats.spanDays} days` : 'single entry'}
            />
            <StatTile
              label="Per week"
              value={signed(stats.perWeek, unit)}
              hint={stats.direction === 'flat' ? 'holding' : `trending ${stats.direction}`}
            />
          </div>

          <ChartReveal height={210}>
          <ResponsiveContainer width="100%" height={210}>
            {/* top/right margin gives dots (r=4 + 2px ring) room so they aren't clipped;
                left margin keeps the y-axis labels off the card edge */}
            <ComposedChart key={rangeKey} data={chartData} margin={{ top: 16, right: 16, left: 8, bottom: 4 }}>
              <defs>
                {/* A wash under the line, not a saturated block. */}
                <linearGradient id="weightFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={SERIES} stopOpacity={0.18} />
                  <stop offset="100%" stopColor={SERIES} stopOpacity={0.01} />
                </linearGradient>
              </defs>
              {/* Solid hairlines — a dashed grid reads as "threshold" when it's just a grid. */}
              <CartesianGrid stroke="#ececec" vertical={false} />
              <XAxis
                dataKey="t"
                type="number"
                scale="time"
                domain={xDomain}
                ticks={xTicks}
                tick={{ fontSize: 10, fill: '#6b7280' }}
                tickFormatter={ms => {
                  const d = new Date(ms);
                  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
                }}
                axisLine={{ stroke: '#e5e7eb' }}
                tickLine={false}
                minTickGap={28}
                padding={{ left: 12, right: 12 }}
              />
              <YAxis
                yAxisId="weight"
                orientation="left"
                domain={yDomain}
                ticks={yTicks}
                tick={{ fontSize: 10, fill: '#6b7280' }}
                width={44}
                axisLine={false}
                tickLine={false}
                tickFormatter={v => (Number.isFinite(v) ? Number(v).toFixed(1) : v)}
              />
              <Tooltip
                contentStyle={{ borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 12 }}
                formatter={(value, name) => {
                  if (value == null || !Number.isFinite(Number(value))) return null;
                  return [`${Number(value).toFixed(1)} ${unit}`, name];
                }}
                labelFormatter={ms => shortDate(new Date(ms).toISOString().slice(0, 10))}
              />
              <Area
                yAxisId="weight"
                type="linear"
                dataKey="weightY"
                stroke="none"
                fill="url(#weightFill)"
                connectNulls
                isAnimationActive={false}
                activeDot={false}
                name="Weight"
                legendType="none"
                tooltipType="none"
              />
              {/* Dashed on purpose: this line is fitted, not measured. */}
              <Line
                yAxisId="weight"
                type="linear"
                dataKey="trendY"
                stroke={TREND}
                strokeWidth={2}
                strokeDasharray="6 5"
                dot={false}
                activeDot={false}
                connectNulls
                name="Trend"
                isAnimationActive={false}
              />
              <Line
                yAxisId="weight"
                type="linear"
                dataKey="weightY"
                stroke={SERIES}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                /* 2px surface ring keeps dots legible where they overlap the line. */
                dot={{ r: 4, fill: SERIES, stroke: 'var(--color-surface)', strokeWidth: 2 }}
                activeDot={{ r: 6, fill: SERIES, stroke: 'var(--color-surface)', strokeWidth: 2 }}
                /* connectNulls: weight is continuous, so connect logged weigh-ins
                   across missing days. Recharts SKIPS null rows entirely — it never
                   plots them as 0 — and the dot renderer above only draws on days
                   with a real entry. Missing days still occupy the x-axis. */
                connectNulls
                name="Weight"
                /* The one animated mark: Recharts draws a Line by sweeping its
                   stroke-dashoffset, i.e. left to right. */
                isAnimationActive={!reduceMotion}
                animationDuration={650}
                animationEasing="ease-out"
              />
            </ComposedChart>
          </ResponsiveContainer>
          </ChartReveal>

          {/* ── What the trend implies ── */}
          {(stats.perWeek != null || projection) && (
            <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--color-divider-warm)' }}>
              <h4 style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 600, color: 'var(--color-text-strong)' }}>
                Trend
              </h4>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-body)' }}>
                <span aria-hidden="true" style={{ color: TREND, fontWeight: 700 }}>{ARROW[stats.direction]}</span>{' '}
                {stats.direction === 'flat'
                  ? 'Holding steady over this range.'
                  : `Trending ${stats.direction} about ${Math.abs(stats.perWeek).toFixed(1)} ${unit} a week.`}
              </p>
              {projection ? (
                <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--color-text-muted)' }}>
                  Next week, the trend points to{' '}
                  <strong style={{ color: 'var(--color-text-strong)' }}>{projection.value.toFixed(1)} {unit}</strong>
                  {projection.margin > 0.05 && ` (± ${projection.margin.toFixed(1)})`}.
                </p>
              ) : (
                <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--color-text-faint)' }}>
                  Not enough weigh-ins spread over enough days to project ahead yet.
                </p>
              )}
            </div>
          )}
        </>
      )}
    </>
  );

  if (noCard) return inner;
  return <div className="card" style={{ marginBottom: 16 }}>{inner}</div>;
}
