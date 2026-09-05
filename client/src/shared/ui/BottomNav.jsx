import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@shared/context/AuthContext';
import { useDashboardEdit } from '@features/dashboard/DashboardEditContext';
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
const IconWorkouts = () => (<svg {...svgProps}><path d="M4 9v6M7 7v10M17 7v10M20 9v6M7 12h10" /></svg>);
const IconPlan = () => (<svg {...svgProps}><rect x="5" y="4" width="14" height="17" rx="2" /><path d="M9 4V3h6v1M9 10h6M9 14h6" /></svg>);
const IconCoach = () => (<svg {...svgProps}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></svg>);
const IconSchedule = () => (<svg {...svgProps}><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M8 3v4M16 3v4M3 11h18" /></svg>);
const IconProgress = () => (<svg {...svgProps}><path d="M4 19V5" /><path d="M4 19h16" /><path d="m8 14 4-4 3 3 5-6" /></svg>);

/* Nutrition and gym swap this bar the same way the desktop banner does.
   Training is not a nutrition tab; hop from Today's Training button. */
const RECIPE_PATHS = ['/recipes', '/meal-builder', '/ingredients'];

function isGymPath(pathname) {
  return pathname === '/training' || pathname.startsWith('/training/');
}

export default function BottomNav() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const dashEdit = useDashboardEdit();
  const { isCoach } = useAuth();
  const gym = isGymPath(pathname);
  const recipesActive = RECIPE_PATHS.some(p => pathname === p || pathname.startsWith(`${p}/`));

  const tabClass = ({ isActive }) => (isActive ? `${styles.tab} ${styles.tabActive}` : styles.tab);

  function guardNav(e, to) {
    if (!dashEdit?.editing) return;
    e.preventDefault();
    dashEdit.requestExit({
      type: 'navigate',
      onContinue: () => navigate(to),
    });
  }

  function guardedTabClass(isActive) {
    return isActive ? `${styles.tab} ${styles.tabActive}` : styles.tab;
  }

  if (gym) {
    return (
      <nav className={styles.bar} aria-label="Training">
        <NavLink to="/training" end className={tabClass} onClick={e => guardNav(e, '/training')}><IconHome /><span>Today</span></NavLink>
        <NavLink to="/training/schedule" className={tabClass} onClick={e => guardNav(e, '/training/schedule')}><IconSchedule /><span>Schedule</span></NavLink>
        <NavLink to="/training/workouts" className={tabClass} onClick={e => guardNav(e, '/training/workouts')}><IconWorkouts /><span>Workouts</span></NavLink>
        <NavLink to="/training/progress" className={tabClass} onClick={e => guardNav(e, '/training/progress')}><IconProgress /><span>Progress</span></NavLink>
      </nav>
    );
  }

  return (
    <nav className={styles.bar} aria-label="Primary">
      <NavLink to="/" end className={tabClass} onClick={e => guardNav(e, '/')}><IconHome /><span>Today</span></NavLink>
      <NavLink
        to="/recipes"
        className={recipesActive ? `${styles.tab} ${styles.tabActive}` : styles.tab}
        onClick={e => guardNav(e, '/recipes')}
      >
        <IconRecipes />
        <span>Library</span>
      </NavLink>
      <NavLink to="/history" className={tabClass} onClick={e => guardNav(e, '/history')}><IconHistory /><span>Review</span></NavLink>
      {isCoach ? (
        <NavLink to="/coach" className={tabClass} onClick={e => guardNav(e, '/coach')}><IconCoach /><span>Coach</span></NavLink>
      ) : null}
      <NavLink
        to="/plan"
        className={({ isActive }) => {
          const planActive = pathname === '/plan' || pathname.startsWith('/plan/');
          return guardedTabClass(planActive || isActive);
        }}
        onClick={e => guardNav(e, '/plan')}
      >
        <IconPlan />
        <span>Plan</span>
      </NavLink>
    </nav>
  );
}
