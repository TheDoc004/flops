import { NavLink, Outlet, useLocation } from 'react-router-dom';

function tabStyle(isActive) {
  return {
    padding: '8px 12px',
    borderRadius: 999,
    border: '1px solid #e5e7eb',
    background: isActive ? '#111827' : '#fff',
    color: isActive ? '#fff' : '#374151',
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
      <div style={{ marginBottom: 16 }}>
        <h1 style={{
          margin: '0 0 6px', fontSize: 32, fontWeight: 400,
          color: '#1e1b4b', letterSpacing: '-0.02em', lineHeight: 1.1,
          fontFamily: "'DM Serif Display', Georgia, serif",
        }}>Plan</h1>
        <p style={{ margin: 0, fontSize: 13, color: '#6b7280' }}>
          Goals, fuel settings, reports, and profile.
        </p>
      </div>

      <div className="card" style={{ marginBottom: 16, padding: 12 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <NavLink to="/plan/goals" style={({ isActive }) => tabStyle(isActive || is('goals'))}>Goals</NavLink>
          <NavLink to="/plan/fuel" style={({ isActive }) => tabStyle(isActive || is('fuel'))}>Fuel</NavLink>
          <NavLink to="/plan/report" style={({ isActive }) => tabStyle(isActive || is('report'))}>Report</NavLink>
          <NavLink to="/plan/profile" style={({ isActive }) => tabStyle(isActive || is('profile'))}>Profile</NavLink>
        </div>
      </div>

      <Outlet />
    </div>
  );
}

