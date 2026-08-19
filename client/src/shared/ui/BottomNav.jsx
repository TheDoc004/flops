import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '@shared/context/AuthContext';
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
const IconHistory = () => (<svg {...svgProps}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>);
const IconTraining = () => (<svg {...svgProps}><path d="M4 9v6M7 7v10M17 7v10M20 9v6M7 12h10" /></svg>);
const IconPlan = () => (<svg {...svgProps}><rect x="5" y="4" width="14" height="17" rx="2" /><path d="M9 4V3h6v1M9 10h6M9 14h6" /></svg>);
const IconCoach = () => (<svg {...svgProps}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></svg>);

/* Every tab is now a direct link — no sheets. There is no "Log" group (logging
   starts on Today, whose header carries both entry points), and the old "More"
   sheet was down to a single destination, which is one extra tap to reach one
   page. One tab covers everything meals are composed FROM — saved recipes, the
   builder that authors them, and the raw ingredients — and stays lit across all
   three. */
const RECIPE_PATHS = ['/recipes', '/meal-builder', '/ingredients'];

export default function BottomNav() {
  const { pathname } = useLocation();
  const { isCoach } = useAuth();
  const recipesActive = RECIPE_PATHS.some(p => pathname === p || pathname.startsWith(`${p}/`));

  const tabClass = ({ isActive }) => (isActive ? `${styles.tab} ${styles.tabActive}` : styles.tab);

  return (
    <nav className={styles.bar} aria-label="Primary">
      <NavLink to="/" end className={tabClass}><IconHome /><span>Today</span></NavLink>
      <NavLink
        to="/recipes"
        className={recipesActive ? `${styles.tab} ${styles.tabActive}` : styles.tab}
      >
        <IconRecipes />
        {/* Two lines so the full name fits a fifth of the bar; the pages
            themselves carry a sub-nav across Recipes / Ingredients. */}
        <span className={styles.tabTwoLine}>Recipes &amp;<br />Ingredients</span>
      </NavLink>
      <NavLink to="/history" className={tabClass}><IconHistory /><span>Review</span></NavLink>
      <NavLink to="/training" className={tabClass}><IconTraining /><span>Training</span></NavLink>
      {isCoach ? (
        <NavLink to="/coach" className={tabClass}><IconCoach /><span>Coach</span></NavLink>
      ) : null}
      <NavLink to="/plan" className={tabClass}><IconPlan /><span>Goals</span></NavLink>
    </nav>
  );
}
