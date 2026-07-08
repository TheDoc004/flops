import { getWeekdayLongNameFromIsoDate } from '@shared/utils/weekday';
import DayReport from './DayReport';
import RangeReport from './RangeReport';

/**
 * Report panel beneath the calendar. One selected day → full DayReport; multiple
 * days / a range → RangeReport (averages + gaps + per-day drilldowns).
 */
export default function NutritionReport({ days, loading, error }) {
  if (loading) {
    return (
      <div className="card" style={{ marginBottom: 20 }}>
        <p style={{ margin: 0, color: 'var(--color-text-muted)', fontSize: 14 }}>Building report…</p>
      </div>
    );
  }
  if (error) {
    return <p className="error" style={{ marginBottom: 20 }}>{error}</p>;
  }
  if (!days || days.length === 0) return null;

  const single = days.length === 1;

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <h2 className="section-title" style={{ marginBottom: single ? 2 : 8 }}>
        {single ? 'Daily report' : 'Nutrition report'}
      </h2>
      {single ? (
        <>
          <p style={{ margin: '0 0 14px', fontSize: 13, color: 'var(--color-text-faint)' }}>
            <strong style={{ color: '#1e1b4b' }}>{getWeekdayLongNameFromIsoDate(days[0].date)}</strong> · {days[0].date}
          </p>
          <DayReport day={days[0]} />
        </>
      ) : (
        <RangeReport days={days} />
      )}
    </div>
  );
}
