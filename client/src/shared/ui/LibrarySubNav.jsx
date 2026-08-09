import { NavLink } from 'react-router-dom';
import styles from './LibrarySubNav.module.css';

/**
 * Sub-navigation for the "Recipes & Ingredients" section.
 *
 * The bottom tab can only point at one route, so on mobile this is the only way
 * across to Ingredients — it isn't decoration. Shown on both pages so the trip
 * works in either direction.
 */
export default function LibrarySubNav() {
  const cls = ({ isActive }) => (isActive ? `${styles.tab} ${styles.tabActive}` : styles.tab);
  return (
    <nav className={styles.bar} aria-label="Recipes and ingredients">
      <NavLink to="/recipes" className={cls}>Recipes</NavLink>
      <NavLink to="/ingredients" className={cls}>Ingredients</NavLink>
    </nav>
  );
}
