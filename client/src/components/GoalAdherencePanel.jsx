import { useState } from 'react';
import { ISO_WEEKDAY_LABELS } from '../utils/weekday';
import GoalAdherenceDayDetailDialog from './GoalAdherenceDayDetailDialog';

const STATUS_META = {
  hit: { label: 'Hit', bg: '#d1fae5', color: '#065f46', border: '#6ee7b7' },
  partial: { label: 'Partial', bg: '#fef3c7', color: '#92400e', border: '#fcd34d' },
  miss: { label: 'Miss', bg: '#fee2e2', color: '#991b1b', border: '#fca5a5' },
  upcoming: { label: 'Upcoming', bg: '#eff6ff', color: '#1d4ed8', border: '#bfdbfe' },
  no_data: { label: 'Not logged', bg: '#f3f4f6', color: '#6b7280', border: '#e5e7eb' },
  no_target: { label: 'No target', bg: '#f3f4f6', color: '#6b7280', border: '#e5e7eb' },
};

function StatusBadge({ status }) {
  const m = STATUS_META[status] || STATUS_META.no_target;
  return (
    <span
      style={{
        display: 'inline-block',
        fontSize: 11,
        fontWeight: 600,
        padding: '2px 8px',
        borderRadius: 999,
        background: m.bg,
        color: m.color,
        border: `1px solid ${m.border}`,
      }}
    >
      {m.label}
    </span>
  );
}

function Segment({ row, onOpen }) {
  const m = STATUS_META[row.status] || STATUS_META.no_target;
  const short = row.date.slice(5);
  const wd = ISO_WEEKDAY_LABELS[row.weekday] || '';
  const title = `${row.date} (${wd}): ${STATUS_META[row.status]?.label || row.status}${
    row.missed?.length ? ` — missed: ${row.missed.map(x => x.label).join(', ')}` : ''
  }`;
  return (
    <div
      role="button"
      tabIndex={0}
      title={title}
      onClick={() => onOpen(row)}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen(row);
        }
      }}
      style={{
        flex: 1,
        minWidth: 40,
        minHeight: 56,
        background: m.bg,
        border: `1px solid ${m.border}`,
        borderRadius: 8,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 11,
        color: m.color,
        fontWeight: 600,
        padding: 6,
        textAlign: 'center',
        cursor: 'pointer',
      }}
    >
      <span style={{ lineHeight: 1.2 }}>{wd.slice(0, 3)}</span>
      <span style={{ fontWeight: 500, opacity: 0.85 }}>{short}</span>
    </div>
  );
}

/**
 * @param {{ rows: Array<{date:string,weekday:number,status:string,missed:Array,totals:object,targets:object}>, macroUnits: 'metric'|'us' }} props
 */
export default function GoalAdherencePanel({ rows, variant = 'dashboard', macroUnits = 'metric' }) {
  const [detailRow, setDetailRow] = useState(null);
  const hits = rows.filter(r => r.status === 'hit').length;
  const withTargets = rows.filter(r => r.status !== 'no_target').length;

  if (!rows.length) {
    return null;
  }

  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>
          7-day adherence
        </span>
        {withTargets > 0 && (
          <span style={{ fontSize: 13, color: '#6b7280' }}>
            <strong style={{ color: '#111827' }}>{hits}</strong>/{rows.length} days hit
          </span>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {rows.map(row => (
          <Segment key={row.date} row={row} onOpen={setDetailRow} />
        ))}
      </div>

      {variant === 'history' && (
        <div style={{ marginTop: 16, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid #e5e7eb' }}>
                <th style={{ padding: '8px 8px 8px 0' }}>Date</th>
                <th style={{ padding: 8 }}>Day</th>
                <th style={{ padding: 8 }}>Status</th>
                <th style={{ padding: 8 }}>Missed (outside saved range)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr
                  key={row.date}
                  onClick={() => setDetailRow(row)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setDetailRow(row);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                  style={{
                    borderBottom: '1px solid #f3f4f6',
                    cursor: 'pointer',
                  }}
                >
                  <td style={{ padding: '8px 8px 8px 0', whiteSpace: 'nowrap' }}>{row.date}</td>
                  <td style={{ padding: 8 }}>{ISO_WEEKDAY_LABELS[row.weekday] || '—'}</td>
                  <td style={{ padding: 8 }}>
                    <StatusBadge status={row.status} />
                  </td>
                  <td style={{ padding: 8, color: '#374151' }}>
                    {row.status === 'no_target'
                      ? '—'
                      : row.missed?.length
                        ? row.missed.map(m => m.label).join(', ')
                        : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ display: 'flex', gap: 12, marginTop: 10 }}>
        {['hit', 'partial', 'miss'].map(s => (
          <span key={s} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#6b7280' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: STATUS_META[s].border, display: 'inline-block' }} />
            {STATUS_META[s].label}
          </span>
        ))}
      </div>

      {detailRow && (
        <GoalAdherenceDayDetailDialog
          key={detailRow.date}
          row={detailRow}
          macroUnits={macroUnits}
          onClose={() => setDetailRow(null)}
        />
      )}
    </div>
  );
}
