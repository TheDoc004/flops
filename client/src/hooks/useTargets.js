import { useState } from 'react';

const KEY = 'nutriTargets';
const DEFAULTS = { calories: null, protein_g: null, carbs_g: null, fat_g: null };

export function useTargets() {
  const [targets, setTargets] = useState(() => {
    try {
      const stored = localStorage.getItem(KEY);
      return stored ? { ...DEFAULTS, ...JSON.parse(stored) } : { ...DEFAULTS };
    } catch {
      return { ...DEFAULTS };
    }
  });

  function setTarget(macro, value) {
    setTargets(prev => {
      const next = { ...prev, [macro]: value };
      localStorage.setItem(KEY, JSON.stringify(next));
      return next;
    });
  }

  return { targets, setTarget };
}
