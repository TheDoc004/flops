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
const IconAi = () => (<svg {...svgProps}><path d="M12 3l1.8 4.7L18.5 9l-4.7 1.8L12 15l-1.8-4.2L5.5 9l4.7-1.3z" /><path d="M18 15l.8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8z" /></svg>);

/* Sheet groups mirror the desktop nav: Log groups the logging tools, More
   groups the Library (Recipes, Ingredients) plus Plan. */
const SHEETS = {
  log: {
    title: 'Log',
    items: [
      { to: '/meal-builder', label: 'Meal Builder', Icon: IconBuilder },
      { to: '/ai-logger', label: 'AI Macro Logger', Icon: IconAi },
    ],
  },
  more: {
    title: 'More',
    items: [
      { to: '/recipes', label: 'Recipes', Icon: IconRecipes },
      { to: '/ingredients', label: 'Ingredients', Icon: IconIngredients },
      { to: '/plan', label: 'Plan', Icon: IconPlan },
    ],
  },
};

function anyMatch(pathname, paths) {
  return paths.some(p => pathname === p || pathname.startsWith(`${p}/`));
}

export default function BottomNav() {
  const location = useLocation();
  const [openSheet, setOpenSheet] = useState(null); // 'log' | 'more' | null

  // Close the sheet on any route change.
  useEffect(() => { setOpenSheet(null); }, [location.pathname]);

  // Lock body scroll while a sheet is open.
  useEffect(() => {
    if (!openSheet) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [openSheet]);

  const logActive = anyMatch(location.pathname, SHEETS.log.items.map(i => i.to));
  const moreActive = anyMatch(location.pathname, SHEETS.more.items.map(i => i.to));

  const tabClass = ({ isActive }) => (isActive ? `${styles.tab} ${styles.tabActive}` : styles.tab);
  const btnClass = active => (active ? `${styles.tab} ${styles.tabActive}` : styles.tab);

  const sheet = openSheet ? SHEETS[openSheet] : null;

  return (
    <>
      {sheet && (
        <div className={styles.sheetBackdrop} onClick={() => setOpenSheet(null)}>
          <div
            className={styles.sheet}
            role="dialog"
            aria-label={`${sheet.title} pages`}
            onClick={e => e.stopPropagation()}
          >
            <div className={styles.sheetHandle} aria-hidden="true" />
            <p className={styles.sheetTitle}>{sheet.title}</p>
            {sheet.items.map(({ to, label, Icon }) => (
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
        <NavLink to="/" end className={tabClass}><IconHome /><span>Today</span></NavLink>
        <button
          type="button"
          className={btnClass(logActive || openSheet === 'log')}
          aria-haspopup="dialog"
          aria-expanded={openSheet === 'log'}
          onClick={() => setOpenSheet(o => (o === 'log' ? null : 'log'))}
        >
          <IconBuilder /><span>Log</span>
        </button>
        <NavLink to="/history" className={tabClass}><IconHistory /><span>Review</span></NavLink>
        <NavLink to="/training" className={tabClass}><IconTraining /><span>Training</span></NavLink>
        <button
          type="button"
          className={btnClass(moreActive || openSheet === 'more')}
          aria-haspopup="dialog"
          aria-expanded={openSheet === 'more'}
          onClick={() => setOpenSheet(o => (o === 'more' ? null : 'more'))}
        >
          <IconMore /><span>More</span>
        </button>
      </nav>
    </>
  );
}
