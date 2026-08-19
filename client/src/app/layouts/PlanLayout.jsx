import { NavLink, Outlet, useLocation } from 'react-router-dom';

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
        <div className="plan-tabs">
          <NavLink
            to="/plan/goals"
            className={({ isActive }) => `plan-tab${isActive || is('goals') ? ' is-active' : ''}`}
          >
            Goals
          </NavLink>
          <NavLink
            to="/plan/report"
            className={({ isActive }) => `plan-tab${isActive || is('report') ? ' is-active' : ''}`}
          >
            Report
          </NavLink>
          <NavLink
            to="/plan/profile"
            className={({ isActive }) => `plan-tab${isActive || is('profile') ? ' is-active' : ''}`}
          >
            Profile
          </NavLink>
        </div>
      </div>

      <Outlet />
    </div>
  );
}
