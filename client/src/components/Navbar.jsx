import { NavLink } from 'react-router-dom';
import styles from './Navbar.module.css';

export default function Navbar() {
  return (
    <nav className={styles.nav}>
      <span className={styles.brand}>NutriLog</span>
      <div className={styles.links}>
        <NavLink to="/" end className={({ isActive }) => isActive ? styles.active : ''}>Dashboard</NavLink>
        <NavLink to="/recipes" className={({ isActive }) => isActive ? styles.active : ''}>Recipes</NavLink>
        <NavLink to="/history" className={({ isActive }) => isActive ? styles.active : ''}>History</NavLink>
      </div>
    </nav>
  );
}
