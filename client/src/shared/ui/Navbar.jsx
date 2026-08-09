import { useEffect, useRef, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import styles from './Navbar.module.css';

/* Grouped top nav: a few intent-based sections instead of one tab per tool.
   Direct items link straight to a page; grouped items open a small dropdown. */
const GROUPS = [
  { label: 'Today', to: '/', end: true },
  // No "Log" group: logging starts on Today, whose header carries both the AI
  // estimate and log-a-meal buttons. Meal Builder is the recipe EDITOR (it
  // calls create/updateRecipe), so it belongs with Recipes, not with logging.
  // One home for everything you compose meals FROM: the saved recipes, the
  // builder that authors them, and the raw ingredients they're built out of.
  {
    label: 'Recipes & Ingredients',
    items: [
      { to: '/recipes', label: 'All recipes' },
      { to: '/meal-builder', label: 'Meal Builder' },
      { to: '/ingredients', label: 'Ingredients' },
    ],
  },
  // Review is a direct link, not a dropdown — History is the only thing under
  // it, so a menu was one extra click to reach a single destination. (The
  // mobile bottom nav already linked straight through.)
  { label: 'Review', to: '/history' },
  { label: 'Training', to: '/training' },
  { label: 'Goals & Profile', to: '/plan' },
];

function pathMatches(pathname, to) {
  return pathname === to || pathname.startsWith(`${to}/`);
}

export default function Navbar() {
  const { pathname } = useLocation();
  const [openMenu, setOpenMenu] = useState(null);
  const linksRef = useRef(null);

  // Close any open dropdown on navigation.
  useEffect(() => { setOpenMenu(null); }, [pathname]);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!openMenu) return;
    const onDown = e => { if (linksRef.current && !linksRef.current.contains(e.target)) setOpenMenu(null); };
    const onKey = e => { if (e.key === 'Escape') setOpenMenu(null); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [openMenu]);

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

        <div className={styles.links} ref={linksRef}>
          {GROUPS.map(g => {
            if (!g.items) {
              return (
                <NavLink
                  key={g.label}
                  to={g.to}
                  end={g.end}
                  className={({ isActive }) => (isActive ? styles.active : '')}
                >
                  {g.label}
                </NavLink>
              );
            }
            const open = openMenu === g.label;
            const groupActive = g.items.some(it => pathMatches(pathname, it.to));
            return (
              <div key={g.label} className={styles.group}>
                <button
                  type="button"
                  className={`${styles.groupBtn}${groupActive ? ` ${styles.active}` : ''}`}
                  aria-haspopup="true"
                  aria-expanded={open}
                  onClick={() => setOpenMenu(open ? null : g.label)}
                >
                  {g.label}
                  <span className={`${styles.caret}${open ? ` ${styles.caretOpen}` : ''}`} aria-hidden="true">▾</span>
                </button>
                {/* Menu stays mounted so both open and close animate. When closed
                    it's visually hidden and removed from the tab/a11y order via
                    the CSS (visibility:hidden + pointer-events:none). */}
                <div className={`${styles.menu}${open ? ` ${styles.menuOpen}` : ''}`} role="menu">
                  {g.items.map(it => (
                    <NavLink
                      key={it.to}
                      to={it.to}
                      role="menuitem"
                      tabIndex={open ? undefined : -1}
                      className={({ isActive }) => (isActive ? `${styles.menuItem} ${styles.menuItemActive}` : styles.menuItem)}
                    >
                      {it.label}
                    </NavLink>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
