import { useEffect, useRef } from 'react';
import { buildDayAdherenceDetail } from '../utils/goalAdherence';
import { ISO_WEEKDAY_LABELS } from '../utils/weekday';

const STATUS_META = {
  hit:       { label: 'Hit',        bg: '#d1fae5', color: '#065f46' },
  partial:   { label: 'Partial',    bg: '#fef3c7', color: '#92400e' },
  miss:      { label: 'Miss',       bg: '#fee2e2', color: '#991b1b' },
  upcoming:  { label: 'Upcoming',   bg: '#eff6ff', color: '#1d4ed8' },
  no_data:   { label: 'Not logged', bg: '#f3f4f6', color: '#6b7280' },
  no_target: { label: 'No target',  bg: '#f3f4f6', color: '#6b7280' },
};

/**
 * @param {object}    props
 * @param {object}    props.row        - Adherence row with date, status, totals, targets, etc.
 * @param {string}    props.macroUnits - 'metric' | 'us'
 * @param {function}  props.onClose    - Called when dialog should close
 * @param {function}  [props.onViewDay] - Optional. Called with dateStr when "View or edit day" is clicked.
 *                                        If not provided, the button is hidden.
 */
export default function GoalAdherenceDayDetailDialog({ row, macroUnits, onClose, onViewDay = null }) {
  const ref = useRef(null);
  const detail = row
    ? buildDayAdherenceDetail(row.totals, row.targets, macroUnits, { status: row.status, hasData: row.hasData })
    : null;

  useEffect(() => {
    if (row) ref.current?.showModal();
  }, [row?.date]);

  function handleClose() {
    onClose();
  }

  function handleViewDay() {
    onViewDay(row.date);
    // onClose is already called from the parent via onViewDay wrapper in AdherenceCalendarMonth
  }

  if (!row || !detail) return null;

  const wdName = ISO_WEEKDAY_LABELS[row.weekday] || '';
  const statusM = STATUS_META[row.status] || STATUS_META.no_target;
  const isFuture = row.status === 'upcoming';
  const showViewButton = onViewDay && !isFuture;

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      style={{ maxWidth: 520, width: 'min(520px, 92vw)' }}
    >
      <h2 style={{
        marginTop: 0, marginBottom: 4, fontSize: 20, fontWeight: 400,
        color: '#1e1b4b', fontFamily: "'DM Serif Display', Georgia, serif",
      }}>
        Day summary
      </h2>
      <p style={{ margin: '0 0 8px', color: '#6b7280', fontSize: 14 }}>
        <strong>{wdName}</strong>{' · '}{row.date}
      </p>
      <p style={{ margin: '0 0 16px', fontSize: 14 }}>
        Status:{' '}
        <span style={{
          fontWeight: 600, padding: '2px 10px', borderRadius: 999,
          background: statusM.bg, color: statusM.color,
        }}>
          {statusM.label}
        </span>
      </p>

      {isFuture && (
        <p style={{ margin: '0 0 12px', fontSize: 13, color: '#6b7280' }}>
          This day is in the future. No meals logged yet.
        </p>
      )}
      {row.status === 'no_data' && (
        <p style={{ margin: '0 0 12px', fontSize: 13, color: '#6b7280' }}>
          No meals were logged for this day.
        </p>
      )}
      {detail.missed?.length > 0 && (
        <p style={{ margin: '0 0 12px', fontSize: 13, color: '#92400e' }}>
          Off-target: {detail.missed.map(m => m.label).join(', ')}
        </p>
      )}

      <p style={{ margin: '0 0 12px', fontSize: 12, color: '#9ca3af' }}>
        A category is a hit when the actual value is within its min/max goal range.
      </p>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid #e5e7eb' }}>
              <th style={{ padding: '8px 8px 8px 0' }}>Category</th>
              <th style={{ padding: 8 }}>Goal</th>
              <th style={{ padding: 8 }}>Actual</th>
              <th style={{ padding: 8 }}>vs goal</th>
            </tr>
          </thead>
          <tbody>
            {detail.categories.map(cat => (
              <tr
                key={cat.key}
                style={{
                  borderBottom: '1px solid #f3f4f6',
                  background: cat.missedTolerance ? '#fffbeb' : 'transparent',
                }}
              >
                <td style={{ padding: '8px 8px 8px 0', fontWeight: 600 }}>{cat.label}</td>
                <td style={{ padding: 8, color: '#374151' }}>{cat.goalDisplay}</td>
                <td style={{ padding: 8, color: '#374151' }}>{cat.actualDisplay}</td>
                <td style={{ padding: 8, color: '#374151' }}>{cat.deltaLabel}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{
        marginTop: 16, display: 'flex',
        justifyContent: showViewButton ? 'space-between' : 'flex-end',
        alignItems: 'center', gap: 10, flexWrap: 'wrap',
      }}>
        <button type="button" className="btn-secondary" onClick={handleClose}>
          Close
        </button>
        {showViewButton && (
          <button type="button" className="btn-primary" onClick={handleViewDay}>
            View or edit day →
          </button>
        )}
      </div>
    </dialog>
  );
}
