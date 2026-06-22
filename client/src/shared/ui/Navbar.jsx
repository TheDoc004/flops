import { NavLink } from 'react-router-dom';
import styles from './Navbar.module.css';

export default function Navbar() {
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
          <NavLink to="/" end className={({ isActive }) => isActive ? styles.active : ''}>Dashboard</NavLink>
          <NavLink to="/recipes" className={({ isActive }) => isActive ? styles.active : ''}>Recipes</NavLink>
          <NavLink to="/ingredients" className={({ isActive }) => isActive ? styles.active : ''}>Ingredients</NavLink>
          <NavLink to="/meal-builder" className={({ isActive }) => isActive ? styles.active : ''}>Meal Builder</NavLink>
          <NavLink to="/ai-logger" className={({ isActive }) => isActive ? styles.active : ''}>AI Logger</NavLink>
          <NavLink to="/history" className={({ isActive }) => isActive ? styles.active : ''}>History</NavLink>
          <NavLink to="/training" className={({ isActive }) => isActive ? styles.active : ''}>Training</NavLink>
          <NavLink to="/plan" className={({ isActive }) => isActive ? styles.active : ''}>Plan</NavLink>
        </div>
      </div>
    </nav>
  );
}
