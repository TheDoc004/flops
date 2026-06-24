import { useMemo, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer } from 'recharts';
import { getWeekdayLongNameFromIsoDate } from '@shared/utils/weekday';
import { MACRO_COLORS } from '@shared/utils/colors';
import { aggregateRangeMicros, microCoverageScore, sortDays, DAY_SORTS } from '@shared/utils/microNutrients';
import { MICRO_BY_KEY } from '@shared/config/microNutrients';
import MicroNutrientPanel from './MicroNutrientPanel';
import DayReport from './DayReport';

function StatChip({ label, value, unit, color }) {
  return (
    <div style={{ background: '#f8f6f2', border: '1px solid #e8e4dc', borderRadius: 12, padding: '12px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 5 }}>
        {color && <span style={{ width: 7, height: 7, borderRadius: '50%', background: color }} />}
        <span style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{label}</span>
      </div>
      <div style={{ fontSize: 20, fontWeight: 700, color: '#111827', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{value}</div>
      {unit && <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 3 }}>{unit}</div>}
    </div>
  );
}

export default function RangeReport({ days }) {
  const [sortKey, setSortKey] = useState('date_desc');
  const [open, setOpen] = useState(() => new Set());

  const logged = useMemo(() => days.filter(d => (d.entries?.length || 0) > 0), [days]);

  const averages = useMemo(() => {
    if (logged.length === 0) return null;
    const n = logged.length;
    const sum = logged.reduce((a, d) => ({
      cal: a.cal + (d.totals?.calories || 0),
      p: a.p + (d.totals?.protein_g || 0),
      c: a.c + (d.totals?.carbs_g || 0),
      f: a.f + (d.totals?.fat_g || 0),
    }), { cal: 0, p: 0, c: 0, f: 0 });
    return { n, cal: Math.round(sum.cal / n), p: +(sum.p / n).toFixed(1), c: +(sum.c / n).toFixed(1), f: +(sum.f / n).toFixed(1) };
  }, [logged]);

  const extremes = useMemo(() => {
    if (logged.length === 0) return null;
    let hi = logged[0], lo = logged[0];
    for (const d of logged) {
      if ((d.totals?.calories || 0) > (hi.totals?.calories || 0)) hi = d;
      if ((d.totals?.calories || 0) < (lo.totals?.calories || 0)) lo = d;
    }
    return { hi, lo };
  }, [logged]);

  const microAgg = useMemo(() => aggregateRangeMicros(days), [days]);
  const hasAnyMicros = useMemo(() => days.some(d => d.micros?.hasMicros), [days]);

  const avgMicroValues = useMemo(() => {
    const out = {};
    for (const k of Object.keys(microAgg)) {
      if (microAgg[k].daysWith > 0) out[k] = microAgg[k].avg;
    }
    return out;
  }, [microAgg]);

  // Repeated gaps: non-watch nutrients below target on ≥1 day, worst average first.
  const gaps = useMemo(() => {
    return Object.values(microAgg)
      .filter(g => !g.def.watch && g.daysWith > 0 && g.daysBelow > 0)
      .sort((a, b) => a.avgPct - b.avgPct)
      .slice(0, 5);
  }, [microAgg]);

  // Hit most often: non-watch nutrients met on the most days.
  const hits = useMemo(() => {
    return Object.values(microAgg)
      .filter(g => !g.def.watch && g.daysWith > 0 && g.daysBelow < g.daysWith)
      .map(g => ({ ...g, hitDays: g.daysWith - g.daysBelow }))
      .sort((a, b) => (b.hitDays / b.daysWith) - (a.hitDays / a.daysWith) || b.avgPct - a.avgPct)
      .slice(0, 4);
  }, [microAgg]);

  const trend = useMemo(
    () => [...days].sort((a, b) => String(a.date).localeCompare(String(b.date)))
      .map(d => ({ date: d.date, calories: Math.round(d.totals?.calories || 0) })),
    [days]
  );

  const sortedDays = useMemo(() => sortDays(days, sortKey), [days, sortKey]);

  function toggle(date) {
    setOpen(prev => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date); else next.add(date);
      return next;
    });
  }

  return (
    <div>
      {/* ── Averages first ── */}
      <p style={{ margin: '0 0 14px', fontSize: 13, color: '#9ca3af' }}>
        {days.length} day{days.length === 1 ? '' : 's'} selected · {logged.length} logged
      </p>

      {averages ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10, marginBottom: 20 }}>
          <StatChip label="Calories" value={averages.cal.toLocaleString('en-US')} unit="avg/logged day" color={MACRO_COLORS.calories} />
          <StatChip label="Protein" value={`${averages.p}g`} unit="avg/day" color={MACRO_COLORS.protein} />
          <StatChip label="Carbs" value={`${averages.c}g`} unit="avg/day" color={MACRO_COLORS.carbs} />
          <StatChip label="Fat" value={`${averages.f}g`} unit="avg/day" color={MACRO_COLORS.fat} />
        </div>
      ) : (
        <p className="empty-state" style={{ padding: 14, marginBottom: 20 }}>No meals logged on the selected days.</p>
      )}

      {/* ── Calorie trend across the selection ── */}
      {trend.length > 1 && (
        <div style={{ marginBottom: 20 }}>
          <h3 className="subsection-title" style={{ marginBottom: 10 }}>Calories across selected days</h3>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={trend} margin={{ top: 6, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#ececec" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#6b7280' }} tickFormatter={v => (v.length >= 10 ? `${v.slice(5, 7)}/${v.slice(8, 10)}` : v)} />
              <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} width={44} />
              <Tooltip formatter={v => [`${v} cal`, 'Calories']} labelFormatter={l => getWeekdayLongNameFromIsoDate(l)} />
              <Line type="monotone" dataKey="calories" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ── Highest / lowest calorie day ── */}
      {extremes && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginBottom: 20 }}>
          <StatChip label="Highest day" value={`${Math.round(extremes.hi.totals.calories).toLocaleString('en-US')} cal`} unit={`${getWeekdayLongNameFromIsoDate(extremes.hi.date)} · ${extremes.hi.date}`} />
          <StatChip label="Lowest day" value={`${Math.round(extremes.lo.totals.calories).toLocaleString('en-US')} cal`} unit={`${getWeekdayLongNameFromIsoDate(extremes.lo.date)} · ${extremes.lo.date}`} />
        </div>
      )}

      {/* ── Micronutrient patterns ── */}
      {hasAnyMicros && (
        <div style={{ marginBottom: 20 }}>
          {gaps.length > 0 && (
            <div style={{ marginBottom: 16, padding: '12px 14px', background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 10 }}>
              <strong style={{ fontSize: 13, color: '#92400e' }}>Repeated gaps across selected days</strong>
              <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
                {gaps.map(g => (
                  <li key={g.def.key} style={{ fontSize: 13, color: '#92400e', marginBottom: 3 }}>
                    <strong>{g.def.name}</strong> — averaged {Math.round(g.avgPct * 100)}% of target · low {g.daysBelow} of {g.daysWith} day{g.daysWith === 1 ? '' : 's'}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {hits.length > 0 && (
            <p style={{ margin: '0 0 16px', fontSize: 13, color: '#065f46' }}>
              <strong>Hit most often:</strong>{' '}
              {hits.map(h => `${MICRO_BY_KEY[h.def.key].name} (${h.hitDays}/${h.daysWith})`).join(', ')}
            </p>
          )}
          <h3 className="subsection-title" style={{ marginBottom: 10 }}>Average micronutrients</h3>
          <p style={{ margin: '0 0 12px', fontSize: 12, color: '#9ca3af' }}>Averaged over days that have estimates.</p>
          <MicroNutrientPanel values={avgMicroValues} />
        </div>
      )}

      {/* ── Individual day drilldowns ── */}
      <div style={{ borderTop: '1px solid #f0ede8', paddingTop: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
          <h3 className="subsection-title" style={{ margin: 0 }}>Individual days</h3>
          <label style={{ fontSize: 12, color: '#6b7280', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            Sort
            <select value={sortKey} onChange={e => setSortKey(e.target.value)} style={{ width: 'auto', minHeight: 'auto', padding: '6px 8px' }}>
              {DAY_SORTS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </label>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {sortedDays.map(d => {
            const isOpen = open.has(d.date);
            const cov = d.micros?.hasMicros ? Math.round(microCoverageScore(d.micros.values) * 100) : null;
            return (
              <div key={d.date} style={{ border: '1px solid #e8e4dc', borderRadius: 10, overflow: 'hidden' }}>
                <button
                  type="button"
                  onClick={() => toggle(d.date)}
                  aria-expanded={isOpen}
                  style={{
                    width: '100%', textAlign: 'left', background: isOpen ? '#f5f3ff' : '#faf9f7',
                    border: 'none', borderRadius: 0, padding: '12px 14px', cursor: 'pointer',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', minHeight: 0,
                  }}
                >
                  <span style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 10 }}>{isOpen ? '▲' : '▼'}</span>
                    <strong style={{ fontSize: 14, color: '#1e1b4b' }}>{getWeekdayLongNameFromIsoDate(d.date)}</strong>
                    <span style={{ fontSize: 12, color: '#9ca3af' }}>{d.date}</span>
                    <span style={{ fontSize: 12, color: '#9ca3af' }}>{d.entries.length} meal{d.entries.length === 1 ? '' : 's'}</span>
                  </span>
                  <span style={{ fontSize: 13, color: '#374151', fontVariantNumeric: 'tabular-nums' }}>
                    <strong>{Math.round(d.totals.calories).toLocaleString('en-US')}</strong> cal
                    {cov != null && <span style={{ marginLeft: 10, fontSize: 12, color: '#7c3aed' }}>{cov}% micro</span>}
                  </span>
                </button>
                {isOpen && (
                  <div style={{ padding: '14px', borderTop: '1px solid #f0ede8' }}>
                    <DayReport day={d} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
