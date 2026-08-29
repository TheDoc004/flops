import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@shared/context/AuthContext';
import { useDashboardEdit } from '@features/dashboard/DashboardEditContext';
import styles from './Navbar.module.css';

/* Flat top nav — every item is a direct link, no dropdowns.

   Nutrition and gym are two dashboards. The banner lists that workspace's
   sections; you hop with the Training / Nutrition buttons, not a shared tab.

   Library is one nutrition section spanning three routes, and it lands on
   the recipe library. Crossing to Ingredients is the segmented control at
   the top of the page; Meal Builder is the button beside it. */
function pathMatches(pathname, to) {
  return pathname === to || pathname.startsWith(`${to}/`);
}

function isGymPath(pathname) {
  return pathname === '/training' || pathname.startsWith('/training/');
}

export default function Navbar() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const dashEdit = useDashboardEdit();
  const { isCoach } = useAuth();
  const gym = isGymPath(pathname);

  function guardNav(e, to) {
    if (!dashEdit?.editing) return;
    e.preventDefault();
    dashEdit.requestExit({
      type: 'navigate',
      onContinue: () => navigate(to),
    });
  }

  const nutritionLinks = [
    { label: 'Today', to: '/', end: true },
    {
      label: 'Library',
      to: '/recipes',
      matchPaths: ['/recipes', '/meal-builder', '/ingredients'],
    },
    { label: 'Review', to: '/history' },
    ...(isCoach ? [{ label: 'Coach', to: '/coach' }] : []),
    { label: 'Profile', to: '/plan/profile', matchPaths: ['/plan'] },
  ];

  const gymLinks = [
    { label: 'Today', to: '/training', end: true },
    { label: 'Schedule', to: '/training/schedule' },
    { label: 'Workouts', to: '/training/workouts' },
    { label: 'Progress', to: '/training/progress' },
  ];

  const links = gym ? gymLinks : nutritionLinks;

  return (
    <nav className={styles.nav}>
      <div className={styles.inner}>
        {/* Brand: cropped badge + wordmark. Gym home stays in the gym. */}
        <NavLink
          to={gym ? '/training' : '/'}
          className={styles.brand}
          onClick={e => guardNav(e, gym ? '/training' : '/')}
        >
          <div className={styles.badgeWrap}>
            <img src="/flops-badge.png" alt="Flops logo" className={styles.badge} />
          </div>
          <span className={styles.brandName}>Flops</span>
        </NavLink>

        <div className={styles.divider} aria-hidden="true" />

        <div className={styles.links}>
          {links.map(l => {
            /* A section link owns several routes, so its lit state can't come
               from NavLink's own exact match. */
            const sectionActive = l.matchPaths?.some(p => pathMatches(pathname, p));
            return (
              <NavLink
                key={l.to}
                to={l.to}
                end={l.end}
                className={({ isActive }) => ((sectionActive ?? isActive) ? styles.active : '')}
                onClick={e => guardNav(e, l.to)}
              >
                {l.label}
              </NavLink>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
