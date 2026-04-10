function MacroBar({ label, value, target, color }) {
  const pct = target ? Math.min((value / target) * 100, 100) : 0;
  return (
    <div style={{ flex: 1, minWidth: 120 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
        <span style={{ fontWeight: 600 }}>{label}</span>
        <span style={{ color: '#6b7280' }}>
          {Math.round(value)}{target ? ` / ${target}` : ''}
        </span>
      </div>
      {target && (
        <div style={{ height: 8, background: '#e5e7eb', borderRadius: 4, overflow: 'hidden' }}>
          <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 4, transition: 'width 0.3s' }} />
        </div>
      )}
    </div>
  );
}

export default function MacroTotals({ totals, targets }) {
  return (
    <div className="card" style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginBottom: 20 }}>
      <MacroBar label="Calories" value={totals.calories} target={targets.calories} color="#f59e0b" />
      <MacroBar label="Protein"  value={totals.protein_g} target={targets.protein_g} color="#3b82f6" />
      <MacroBar label="Carbs"    value={totals.carbs_g}   target={targets.carbs_g}   color="#10b981" />
      <MacroBar label="Fat"      value={totals.fat_g}     target={targets.fat_g}     color="#ef4444" />
    </div>
  );
}
