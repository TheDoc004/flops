import { useEffect, useMemo, useState } from 'react';
import { Line, LineChart, ResponsiveContainer, YAxis } from 'recharts';
import { fetchExerciseProgress } from '@shared/api/workouts';

/**
 * Compact inline progress sparkline for a single exercise, shown right in the
 * logging flow so progressive overload is glanceable — not buried in a tab.
 * Renders nothing until there are at least two logged sessions to trend.
 */
export default function ExerciseTrend({ exercise, unit }) {
  const [rows, setRows] = useState([]);

  useEffect(() => {
    if (!exercise) return undefined;
    let cancelled = false;
    fetchExerciseProgress(exercise)
      .then(r => { if (!cancelled) setRows(r || []); })
      .catch(() => { if (!cancelled) setRows([]); });
    return () => { cancelled = true; };
  }, [exercise]);

  const points = useMemo(
    () => rows
      .map(r => ({ date: r.date, weight: r.weight == null ? null : Number(r.weight) }))
      .filter(p => p.weight != null),
    [rows]
  );

  if (points.length < 2) return null;

  const first = points[0].weight;
  const last = points[points.length - 1].weight;
  const delta = Math.round((last - first) * 10) / 10;
  const trendColor = delta > 0 ? '#059669' : delta < 0 ? '#b45309' : '#6b7280';
  const arrow = delta > 0 ? '▲' : delta < 0 ? '▼' : '■';
  const deltaLabel = delta === 0
    ? 'Same as your first logged session'
    : `${arrow} ${delta > 0 ? '+' : ''}${delta} ${unit} over ${points.length} sessions`;

  return (
    <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #f3f4f6', display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{ flex: '1 1 auto', minWidth: 0, height: 36 }}>
        <ResponsiveContainer width="100%" height={36}>
          <LineChart data={points} margin={{ top: 4, bottom: 4, left: 0, right: 0 }}>
            <YAxis hide domain={['dataMin', 'dataMax']} />
            <Line
              type="monotone"
              dataKey="weight"
              stroke={trendColor}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <span style={{ fontSize: 12, fontWeight: 600, color: trendColor, whiteSpace: 'nowrap', flexShrink: 0 }}>
        {deltaLabel}
      </span>
    </div>
  );
}
