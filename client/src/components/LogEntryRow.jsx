import { computeEntryMacros } from '../utils/macros';

export default function LogEntryRow({ entry, onDelete }) {
  const m = computeEntryMacros(entry);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid #f3f4f6' }}>
      <div style={{ flex: 1 }}>
        <strong>{entry.recipe_name}</strong>
        <span style={{ color: '#6b7280', fontSize: 13, marginLeft: 8 }}>{entry.servings}x {entry.serving_size}</span>
        {entry.notes && <span style={{ color: '#9ca3af', fontSize: 12, marginLeft: 8 }}>· {entry.notes}</span>}
      </div>
      <div style={{ display: 'flex', gap: 16, fontSize: 13 }}>
        <span><strong>{Math.round(m.calories)}</strong> cal</span>
        <span>P: {m.protein_g.toFixed(1)}g</span>
        <span>C: {m.carbs_g.toFixed(1)}g</span>
        <span>F: {m.fat_g.toFixed(1)}g</span>
      </div>
      {onDelete && (
        <button className="btn-danger" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => onDelete(entry)}>✕</button>
      )}
    </div>
  );
}
