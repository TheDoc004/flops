import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '@shared/context/AuthContext';
import styles from './Navbar.module.css';

/* Flat top nav — every item is a direct link, no dropdowns.

   Library is one section spanning three routes, and it lands on the recipe
   library. Crossing to Ingredients is the segmented control at the top of
   the page; Meal Builder is the button beside it. */
function pathMatches(pathname, to) {
  return pathname === to || pathname.startsWith(`${to}/`);
}

export default function Navbar() {
  const { pathname } = useLocation();
  const { isCoach } = useAuth();

  const links = [
    { label: 'Today', to: '/', end: true },
    {
      label: 'Library',
      to: '/recipes',
      matchPaths: ['/recipes', '/meal-builder', '/ingredients'],
    },
    { label: 'Review', to: '/history' },
    { label: 'Training', to: '/training' },
    ...(isCoach ? [{ label: 'Coach', to: '/coach' }] : []),
    { label: 'Goals', to: '/plan' },
  ];

  return (
    <nav className={styles.nav}>
      <div className={styles.inner}>
        {/* Brand: cropped badge + wordmark */}
        <NavLink to="/" className={styles.brand}>
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
                key={l.label}
                to={l.to}
                end={l.end}
                className={({ isActive }) => ((sectionActive ?? isActive) ? styles.active : '')}
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
