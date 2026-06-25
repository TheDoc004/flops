import { useEffect, useRef, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import styles from './Navbar.module.css';

/* Grouped top nav: a few intent-based sections instead of one tab per tool.
   Direct items link straight to a page; grouped items open a small dropdown. */
const GROUPS = [
  { label: 'Today', to: '/', end: true },
  {
    label: 'Log',
    items: [
      { to: '/meal-builder', label: 'Meal Builder' },
      { to: '/ai-logger', label: 'AI Macro Logger' },
    ],
  },
  {
    label: 'Library',
    items: [
      { to: '/recipes', label: 'Recipes' },
      { to: '/ingredients', label: 'Ingredients' },
    ],
  },
  { label: 'Review', to: '/history' },
  { label: 'Training', to: '/training' },
  { label: 'Plan', to: '/plan' },
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
                  <span className={styles.caret} aria-hidden="true">▾</span>
                </button>
                {open && (
                  <div className={styles.menu} role="menu">
                    {g.items.map(it => (
                      <NavLink
                        key={it.to}
                        to={it.to}
                        role="menuitem"
                        className={({ isActive }) => (isActive ? `${styles.menuItem} ${styles.menuItemActive}` : styles.menuItem)}
                      >
                        {it.label}
                      </NavLink>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
