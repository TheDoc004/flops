import { NavLink, Link, useLocation } from 'react-router-dom';
import styles from './LibrarySubNav.module.css';

/**
 * Header for the "Recipes & Ingredients" section: the crossing between its two
 * pages, plus the way into Meal Builder.
 *
 * The top nav points at one route and the bottom tab can only point at one, so
 * this is the only way across to Ingredients — it isn't decoration. "Build a
 * meal" sits here rather than in either page's title row so the section's one
 * authoring action is in the same place whichever page you're on.
 */
export default function LibrarySubNav() {
  const { pathname } = useLocation();
  const onIngredients = pathname.startsWith('/ingredients');
  const cls = ({ isActive }) => (isActive ? `${styles.tab} ${styles.tabActive}` : styles.tab);
  return (
    <div className={styles.row}>
      <nav className={styles.bar} aria-label="Recipes and ingredients">
        <span
          className={`${styles.thumb} ${onIngredients ? styles.thumbEnd : styles.thumbStart}`}
          aria-hidden="true"
        />
        <NavLink to="/recipes" className={cls}>Recipes</NavLink>
        <NavLink to="/ingredients" className={cls}>Ingredients</NavLink>
      </nav>
      <Link to="/meal-builder" className={styles.build} title="Build a recipe in Meal Builder">
        + Build a meal
      </Link>
    </div>
  );
}
