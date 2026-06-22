import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchLogRange } from '@shared/api/log';
import { fetchGoals } from '@shared/api/goals';
import { fetchProfile } from '@shared/api/profile';
import { buildNutritionReportPdf, downloadReportPdf } from './buildNutritionReportPdf';
import { getLocalDateISO, addDaysLocal } from '@shared/utils/dateLocal';

export default function Report() {
  const [preset, setPreset] = useState('7');
  const [customStart, setCustomStart] = useState(addDaysLocal(getLocalDateISO(), -6));
  const [customEnd, setCustomEnd] = useState(getLocalDateISO());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const range = useMemo(() => {
    const end = getLocalDateISO();
    if (preset === '7') return { start: addDaysLocal(end, -6), end, label: 'Last 7 days' };
    if (preset === '30') return { start: addDaysLocal(end, -29), end, label: 'Last 30 days' };
    return {
      start: customStart <= customEnd ? customStart : customEnd,
      end: customStart <= customEnd ? customEnd : customStart,
      label: 'Custom range',
    };
  }, [preset, customStart, customEnd]);

  async function handleDownload() {
    setError('');
    setBusy(true);
    try {
      const [entries, goalsPayload, profile] = await Promise.all([
        fetchLogRange(range.start, range.end),
        fetchGoals({ date: range.end }).catch(() => null),
        fetchProfile().catch(() => null),
      ]);
      const doc = buildNutritionReportPdf({
        title: range.label,
        start: range.start,
        end: range.end,
        entries,
        goalsPayload,
        profile,
      });
      const slug = `${range.start}-to-${range.end}`.replace(/[^a-z0-9-]+/gi, '-');
      downloadReportPdf(slug, doc);
    } catch (e) {
      setError(e.message || 'Could not build PDF');
    } finally {
      setBusy(false);
    }
  }

  const presetOptions = [
    { key: '7',      label: 'Last 7 days'  },
    { key: '30',     label: 'Last 30 days' },
    { key: 'custom', label: 'Custom'       },
  ];

  return (
    <div>
      <h1 className="page-title" style={{ marginBottom: 6 }}>Export report</h1>
      <p className="page-subtitle">
        Download a PDF summary of your logged intake — useful for a coach or to paste into an AI tool.
      </p>

      {/* Cap width so the card doesn't sprawl across the full container */}
      <div className="card" style={{ marginBottom: 16, maxWidth: 540 }}>
        <h3 className="section-title" style={{ marginBottom: 14 }}>Date range</h3>

        {/* ── Preset pills ── */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
          {presetOptions.map(opt => {
            const active = preset === opt.key;
            return (
              <label
                key={opt.key}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 7,
                  cursor: 'pointer', padding: '9px 14px', borderRadius: 10,
                  whiteSpace: 'nowrap', fontSize: 14,
                  border: `1px solid ${active ? '#c4b5fd' : 'var(--color-surface-border)'}`,
                  background: active ? '#f5f3ff' : 'transparent',
                  color: active ? 'var(--color-primary)' : '#4b5563',
                  fontWeight: active ? 500 : 400,
                  transition: 'border-color 0.12s, background 0.12s, color 0.12s',
                }}
              >
                {/* width:auto overrides the global `input { width: 100% }` rule */}
                <input
                  type="radio"
                  name="preset"
                  checked={active}
                  onChange={() => setPreset(opt.key)}
                  style={{ flexShrink: 0, width: 'auto' }}
                />
                {opt.label}
              </label>
            );
          })}
        </div>

        {/* ── Custom date inputs — inset box, visually connected to Custom pill ── */}
        {preset === 'custom' && (
          <div className="form-grid-2" style={{
            padding: '12px 14px', marginBottom: 16,
            borderRadius: 10, border: '1px solid #c4b5fd', background: '#faf7ff',
          }}>
            <div>
              <label style={{ marginBottom: 4 }}>Start</label>
              <input
                type="date"
                value={customStart}
                max={getLocalDateISO()}
                onChange={e => setCustomStart(e.target.value)}
              />
            </div>
            <div>
              <label style={{ marginBottom: 4 }}>End</label>
              <input
                type="date"
                value={customEnd}
                max={getLocalDateISO()}
                onChange={e => setCustomEnd(e.target.value)}
              />
            </div>
          </div>
        )}

        {/* ── Summary + download ── */}
        <p style={{ margin: '0 0 14px', fontSize: 13, color: 'var(--color-text-muted)' }}>
          <span style={{ fontWeight: 600, color: 'var(--color-primary-ink)' }}>Selected:</span>{' '}
          {range.label} — {range.start} → {range.end}
        </p>

        {error && <p className="error" style={{ marginBottom: 10 }}>{error}</p>}

        <button type="button" className="btn-primary" onClick={handleDownload} disabled={busy}>
          {busy ? 'Building PDF…' : 'Download PDF'}
        </button>
      </div>

      <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
        Tip: set your weekly targets on{' '}
        <Link to="/plan/goals" style={{ color: 'var(--color-primary)' }}>Goals</Link>{' '}
        and your stats on{' '}
        <Link to="/plan/profile" style={{ color: 'var(--color-primary)' }}>Profile</Link>{' '}
        so they appear in the report.
      </p>
    </div>
  );
}
