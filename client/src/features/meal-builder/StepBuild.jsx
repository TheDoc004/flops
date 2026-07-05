import IngredientCombobox from './IngredientCombobox';
import { newLine, macroSummaryText, getSuggestedSubstitutes } from './builderUtils';

/**
 * Wizard step 1 — assemble the meal from saved ingredients. Live per-row
 * macros and running totals; role labels and substitutes tucked behind the
 * per-row "more options" toggle on mobile. Adding a missing ingredient is an
 * optional detour via onAddIngredient.
 */
export default function StepBuild({
  savedLabels,
  sortedLabels,
  ingById,
  lines,
  setLines,
  lineMacros,
  totals,
  expandedLines,
  toggleLineExpanded,
  updateLine,
  addSubstituteToLine,
  removeSubstituteFromLine,
  handleRoleKeyDown,
  handleIngredientSelect,
  handleAmountKeyDown,
  roleLabelRefs,
  comboboxRefs,
  amountRefs,
  onRequestCreate,
  onAddIngredient,
  onContinue,
}) {
  const validCount = lineMacros.filter(Boolean).length;

  return (
    <>
      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <h3 className="section-title">Build your meal</h3>
          <button type="button" className="btn-secondary" style={{ flexShrink: 0 }} onClick={onAddIngredient}>
            + Add new ingredient
          </button>
        </div>
        <p style={{ margin: '0 0 14px', fontSize: 15, color: 'var(--color-text-muted)' }}>
          Pick ingredients and amounts — macros calculate automatically.
        </p>
        {savedLabels.length === 0 && (
          <div
            style={{
              marginBottom: 16,
              padding: '14px 16px',
              background: '#eef2ff',
              border: '1px solid #c7d2fe',
              borderRadius: 10,
            }}
          >
            <p style={{ margin: '0 0 10px', fontSize: 15, color: '#3730a3' }}>
              Your ingredient library is empty — save your first one to start building.
            </p>
            <button type="button" className="btn-primary" onClick={onAddIngredient}>
              + Add your first ingredient
            </button>
          </div>
        )}
        {savedLabels.length > 0 && (() => {
          const withHistory = [...savedLabels]
            .filter(s => s.last_used_at)
            .sort((a, b) => new Date(b.last_used_at) - new Date(a.last_used_at))
            .slice(0, 5);
          const chips = withHistory.length > 0 ? withHistory : sortedLabels.slice(0, 5);
          return (
            <div className="mb-recently-used" style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
              <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-text-body)' }}>Quick add:</span>
              {chips.map(s => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => {
                    const ingId = String(s.id);
                    setLines(prev => {
                      const firstEmpty = prev.findIndex(l => !l.labelIngredientId);
                      let next;
                      if (firstEmpty !== -1) {
                        next = prev.map((l, i) => i === firstEmpty ? { ...l, labelIngredientId: ingId } : l);
                      } else {
                        next = [...prev, { ...newLine(), labelIngredientId: ingId }];
                      }
                      if (next[next.length - 1].labelIngredientId) {
                        next = [...next, newLine()];
                      }
                      return next;
                    });
                  }}
                  style={{
                    background: 'transparent',
                    border: '1px solid var(--color-border)',
                    borderRadius: 20,
                    padding: '6px 12px',
                    fontSize: 13,
                    color: 'var(--color-text-body)',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    lineHeight: 1.4,
                  }}
                >
                  + {s.name}
                </button>
              ))}
            </div>
          );
        })()}
        {lines.map((line, idx) => {
          const m = lineMacros[idx];
          return (
            <div key={line.id} className={`mb-line${expandedLines.has(line.id) ? ' is-expanded' : ''}`} style={{ marginBottom: 12 }}>
              <div className="mb-line-header">
                <span className="mb-line-title">Ingredient {idx + 1}</span>
                <button
                  type="button"
                  className="mb-trash"
                  onClick={() => setLines(prev => prev.filter(l => l.id !== line.id))}
                  disabled={lines.length <= 1}
                  aria-label="Remove ingredient"
                  title="Remove ingredient"
                >
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6" />
                  </svg>
                </button>
              </div>
              <div className="mb-line-row">
                <div className="mb-role-desktop">
                  <label style={{ fontSize: 13 }}>Role label</label>
                  <input
                    ref={el => { if (el) roleLabelRefs.current[line.id] = el; else delete roleLabelRefs.current[line.id]; }}
                    value={line.roleLabel}
                    onChange={e => updateLine(line.id, { roleLabel: e.target.value })}
                    onKeyDown={e => handleRoleKeyDown(e, line.id)}
                    placeholder="e.g. Yogurt"
                  />
                </div>
                <div className="mb-field-ingredient">
                  <IngredientCombobox
                    ref={el => { if (el) comboboxRefs.current[line.id] = el; else delete comboboxRefs.current[line.id]; }}
                    label="Ingredient (default)"
                    items={savedLabels}
                    value={line.labelIngredientId}
                    onChange={(next) => updateLine(line.id, { labelIngredientId: next })}
                    placeholder="Search ingredients…"
                    allowCreate
                    onRequestCreate={q => onRequestCreate(q)}
                    onSelect={() => handleIngredientSelect(line.id)}
                  />
                </div>
                <div className="mb-amount-unit">
                <div className="mb-field-amount">
                  <label style={{ fontSize: 13 }}>Amount</label>
                  <input
                    ref={el => { if (el) amountRefs.current[line.id] = el; else delete amountRefs.current[line.id]; }}
                    type="number" min="0.01" step="0.01"
                    value={line.amount}
                    onChange={e => updateLine(line.id, { amount: e.target.value })}
                    onKeyDown={e => handleAmountKeyDown(e, line.id, idx)}
                  />
                </div>
                <div className="mb-field-unit">
                  <label style={{ fontSize: 13 }}>Unit</label>
                  {ingById[line.labelIngredientId]?.tracking_type === 'unit'
                    ? (
                      <div style={{ height: 38, display: 'flex', alignItems: 'center', fontSize: 14, color: 'var(--color-text-body)', paddingLeft: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {ingById[line.labelIngredientId]?.unit_name || 'unit'}
                      </div>
                    ) : (
                      <select value={line.unit} onChange={e => updateLine(line.id, { unit: e.target.value })}>
                        <option value="g">g</option>
                        <option value="oz">oz</option>
                      </select>
                    )
                  }
                </div>
                </div>
                <button type="button" className="btn-secondary mb-remove" onClick={() => setLines(prev => prev.filter(l => l.id !== line.id))} disabled={lines.length <= 1}>Remove</button>
              </div>

              <button
                type="button"
                className="mb-more-toggle"
                onClick={() => toggleLineExpanded(line.id)}
                aria-expanded={expandedLines.has(line.id)}
              >
                {expandedLines.has(line.id) ? '▲ Fewer options' : '▾ Role label & substitutes'}
              </button>

              <div className="mb-advanced" style={{ marginTop: 8 }}>
                <div className="mb-role-mobile">
                  <label style={{ fontSize: 13 }}>Role label</label>
                  <input
                    value={line.roleLabel}
                    onChange={e => updateLine(line.id, { roleLabel: e.target.value })}
                    placeholder="e.g. Yogurt"
                  />
                </div>
                <label style={{ fontSize: 13, color: 'var(--color-text-muted)', display: 'block', marginBottom: 6 }}>Substitutes (optional)</label>
                {(line.substitute_label_ingredient_ids || []).length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                    {(line.substitute_label_ingredient_ids || []).map(oid => {
                      const li = ingById[String(oid)];
                      return (
                        <span
                          key={oid}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                            padding: '4px 8px',
                            background: '#eef2ff',
                            borderRadius: 6,
                            fontSize: 14,
                          }}
                        >
                          {li ? li.name : `#${oid}`}
                          <button
                            type="button"
                            aria-label="Remove substitute"
                            style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: 0 }}
                            onClick={() => removeSubstituteFromLine(line.id, oid)}
                          >
                            ×
                          </button>
                        </span>
                      );
                    })}
                  </div>
                )}
                {line.labelIngredientId ? (() => {
                  const defaultIng = ingById[line.labelIngredientId];
                  const alreadyAdded = new Set([
                    Number(line.labelIngredientId),
                    ...(line.substitute_label_ingredient_ids || []),
                  ]);
                  const subCandidates = savedLabels.filter(x => !alreadyAdded.has(x.id));
                  const subSuggestions = getSuggestedSubstitutes(defaultIng, subCandidates);
                  return (
                    <IngredientCombobox
                      label=""
                      items={subCandidates}
                      value=""
                      onChange={id => addSubstituteToLine(line.id, id)}
                      placeholder="Search saved ingredients…"
                      suggestions={subSuggestions}
                    />
                  );
                })() : (
                  <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-faint)' }}>Choose an ingredient first.</p>
                )}
              </div>
              {m && (
                <div className="mb-macro" style={{ marginTop: 6, fontSize: 13, color: 'var(--color-text-muted)' }}>
                  This row: {macroSummaryText(m)}
                </div>
              )}
            </div>
          );
        })}
        <button type="button" className="btn-secondary" onClick={() => setLines(prev => [...prev, newLine()])}>+ Add ingredient row</button>

        <div style={{ marginTop: 16, padding: 14, background: '#f9fafb', borderRadius: 8 }}>
          <strong style={{ fontSize: 15 }}>Meal totals</strong>
          <div style={{ marginTop: 6, fontSize: 16, fontWeight: 600 }}>
            {macroSummaryText(totals, { fiber: true })}
          </div>
        </div>
      </div>

      {validCount === 0 && (
        <p style={{ margin: '0 0 10px', fontSize: 15, color: 'var(--color-text-muted)', textAlign: 'center' }}>
          Add an ingredient with an amount to continue.
        </p>
      )}
      <div className="wizard-nav">
        <button type="button" className="btn-primary wizard-continue" onClick={onContinue} disabled={validCount === 0}>
          Continue: Review &amp; save →
        </button>
      </div>
    </>
  );
}
