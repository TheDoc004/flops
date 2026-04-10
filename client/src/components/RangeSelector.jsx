const OPTIONS = [
  { label: '7 days', value: 7 },
  { label: '30 days', value: 30 },
  { label: '90 days', value: 90 },
];

export default function RangeSelector({ value, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      {OPTIONS.map(opt => (
        <button
          key={opt.value}
          className={value === opt.value ? 'btn-primary' : 'btn-secondary'}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
