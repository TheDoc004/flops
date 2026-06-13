import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import styles from './BottomNav.module.css';

/* ── Icons (inline stroke SVG, sized via CSS) ── */
const svgProps = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
};
const IconHome = () => (<svg {...svgProps}><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /></svg>);
const IconRecipes = () => (<svg {...svgProps}><path d="M5 4h11a2 2 0 0 1 2 2v15H7a2 2 0 0 1-2-2z" /><path d="M9 8h6M9 12h6" /></svg>);
const IconBuilder = () => (<svg {...svgProps}><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M12 8v8M8 12h8" /></svg>);
const IconHistory = () => (<svg {...svgProps}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>);
const IconMore = () => (<svg {...svgProps}><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></svg>);
const IconIngredients = () => (<svg {...svgProps}><path d="M21 16V8a2 2 0 0 0-1-1.7l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.7l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /><path d="m3.3 7 8.7 5 8.7-5M12 22V12" /></svg>);
const IconTraining = () => (<svg {...svgProps}><path d="M4 9v6M7 7v10M17 7v10M20 9v6M7 12h10" /></svg>);
const IconPlan = () => (<svg {...svgProps}><rect x="5" y="4" width="14" height="17" rx="2" /><path d="M9 4V3h6v1M9 10h6M9 14h6" /></svg>);

/* Routes that live under the "More" sheet — used to light up the More tab. */
const SECONDARY_PATHS = ['/ingredients', '/training', '/plan'];

const SHEET_ITEMS = [
  { to: '/ingredients', label: 'Ingredient Library', Icon: IconIngredients },
  { to: '/training', label: 'Training', Icon: IconTraining },
  { to: '/plan', label: 'Plan', Icon: IconPlan },
];

export default function BottomNav() {
  const location = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);

  // Close the sheet on any route change.
  useEffect(() => { setMoreOpen(false); }, [location.pathname]);

  // Lock body scroll while the sheet is open.
  useEffect(() => {
    if (!moreOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [moreOpen]);

  const moreActive = SECONDARY_PATHS.some(
    p => location.pathname === p || location.pathname.startsWith(`${p}/`)
  );

  const tabClass = ({ isActive }) => (isActive ? `${styles.tab} ${styles.tabActive}` : styles.tab);

  return (
    <>
      {moreOpen && (
        <div className={styles.sheetBackdrop} onClick={() => setMoreOpen(false)}>
          <div
            className={styles.sheet}
            role="dialog"
            aria-label="More pages"
            onClick={e => e.stopPropagation()}
          >
            <div className={styles.sheetHandle} aria-hidden="true" />
            <p className={styles.sheetTitle}>More</p>
            {SHEET_ITEMS.map(({ to, label, Icon }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) => (isActive ? `${styles.sheetRow} ${styles.sheetRowActive}` : styles.sheetRow)}
              >
                <Icon />
                <span>{label}</span>
                <span className={styles.chev} aria-hidden="true">›</span>
              </NavLink>
            ))}
          </div>
        </div>
      )}

      <nav className={styles.bar} aria-label="Primary">
        <NavLink to="/" end className={tabClass}><IconHome /><span>Home</span></NavLink>
        <NavLink to="/recipes" className={tabClass}><IconRecipes /><span>Recipes</span></NavLink>
        <NavLink to="/meal-builder" className={tabClass}><IconBuilder /><span>Builder</span></NavLink>
        <NavLink to="/history" className={tabClass}><IconHistory /><span>History</span></NavLink>
        <button
          type="button"
          className={moreActive || moreOpen ? `${styles.tab} ${styles.tabActive}` : styles.tab}
          aria-haspopup="dialog"
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen(o => !o)}
        >
          <IconMore /><span>More</span>
        </button>
      </nav>
    </>
  );
}
