import { NavLink, Outlet, useLocation } from 'react-router-dom';

function tabStyle(isActive) {
  return {
    padding: '8px 12px',
    borderRadius: 999,
    border: '1px solid #e5e7eb',
    background: isActive ? 'var(--color-text-strong)' : '#fff',
    color: isActive ? '#fff' : 'var(--color-text-body)',
    fontSize: 13,
    fontWeight: 700,
    textDecoration: 'none',
  };
}

export default function PlanLayout() {
  const loc = useLocation();
  const base = '/plan';
  const is = (sub) => loc.pathname === `${base}/${sub}` || loc.pathname === `${base}/${sub}/`;

  return (
    <div>
      {/* Section sub-nav. The active child page owns the page <h1>, so Plan
          no longer renders its own heading (avoids a stacked double-header). */}
      <p className="section-label" style={{ margin: '0 0 8px' }}>Plan</p>
      <div className="card" style={{ marginBottom: 16, padding: 12 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <NavLink to="/plan/goals" style={({ isActive }) => tabStyle(isActive || is('goals'))}>Goals</NavLink>
          <NavLink to="/plan/report" style={({ isActive }) => tabStyle(isActive || is('report'))}>Report</NavLink>
          <NavLink to="/plan/profile" style={({ isActive }) => tabStyle(isActive || is('profile'))}>Profile</NavLink>
        </div>
      </div>

      <Outlet />
    </div>
  );
}

