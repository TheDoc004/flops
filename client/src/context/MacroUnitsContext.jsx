import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { fetchProfile, saveProfile } from '../api/profile';

const MacroUnitsContext = createContext(null);

/** Nutrition macros: grams (metric) vs ounces (us). Persists as user_profile.macro_units */
const LS_NUTRITION = 'nutriMacroUnits';
/** Body height/weight: cm/kg (metric) vs ft·in/lb (us). Persists as user_profile.body_units */
const LS_BODY = 'nutriBodyUnits';

function normalizeMode(v) {
  return v === 'us' ? 'us' : 'metric';
}

export function MacroUnitsProvider({ children }) {
  const [macroUnits, setMacroUnitsState] = useState(() =>
    normalizeMode(typeof localStorage !== 'undefined' ? localStorage.getItem(LS_NUTRITION) : null)
  );
  const [bodyUnits, setBodyUnitsState] = useState(() =>
    normalizeMode(typeof localStorage !== 'undefined' ? localStorage.getItem(LS_BODY) : null)
  );
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const p = await fetchProfile();
        if (cancelled) return;
        const lsN =
          typeof localStorage !== 'undefined' ? localStorage.getItem(LS_NUTRITION) : null;
        const lsB = typeof localStorage !== 'undefined' ? localStorage.getItem(LS_BODY) : null;

        if (lsN === 'us' || lsN === 'metric') {
          setMacroUnitsState(normalizeMode(lsN));
        } else if (p.macro_units != null && String(p.macro_units).trim() !== '') {
          const m = normalizeMode(p.macro_units);
          setMacroUnitsState(m);
          localStorage.setItem(LS_NUTRITION, m);
        } else {
          setMacroUnitsState('metric');
          localStorage.setItem(LS_NUTRITION, 'metric');
        }

        if (lsB === 'us' || lsB === 'metric') {
          setBodyUnitsState(normalizeMode(lsB));
        } else if (p.body_units != null && String(p.body_units).trim() !== '') {
          const b = normalizeMode(p.body_units);
          setBodyUnitsState(b);
          localStorage.setItem(LS_BODY, b);
        } else {
          const fallback = normalizeMode(p.macro_units);
          setBodyUnitsState(fallback);
          localStorage.setItem(LS_BODY, fallback);
        }
      } catch {
        if (!cancelled) {
          setMacroUnitsState(normalizeMode(localStorage.getItem(LS_NUTRITION)));
          setBodyUnitsState(normalizeMode(localStorage.getItem(LS_BODY)));
        }
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setMacroUnits = useCallback(async mode => {
    const m = normalizeMode(mode);
    setMacroUnitsState(m);
    localStorage.setItem(LS_NUTRITION, m);
    try {
      await saveProfile({ macro_units: m });
    } catch {
      /* preference stays in localStorage */
    }
  }, []);

  const setBodyUnits = useCallback(async mode => {
    const b = normalizeMode(mode);
    setBodyUnitsState(b);
    localStorage.setItem(LS_BODY, b);
    try {
      await saveProfile({ body_units: b });
    } catch {
      /* preference stays in localStorage */
    }
  }, []);

  const value = useMemo(
    () => ({
      /** Nutrition display: metric = grams, us = ounces (Dashboard, Goals, log rows). */
      macroUnits,
      setMacroUnits,
      /** Body display: metric = cm/kg, us = feet·inches and lb (Profile only). */
      bodyUnits,
      setBodyUnits,
      ready,
    }),
    [macroUnits, setMacroUnits, bodyUnits, setBodyUnits, ready]
  );

  return <MacroUnitsContext.Provider value={value}>{children}</MacroUnitsContext.Provider>;
}

export function useMacroUnits() {
  const ctx = useContext(MacroUnitsContext);
  if (!ctx) {
    throw new Error('useMacroUnits must be used within MacroUnitsProvider');
  }
  return ctx;
}
