import { NavLink, Outlet } from 'react-router-dom';
import Reveal from '@shared/ui/Reveal';
import TrainingWorkouts from '@features/training-workouts';

/**
 * Gym dashboard shell. Heading + tab bar stay mounted while nested
 * /training URLs swap; TrainingWorkouts owns the four tab bodies and
 * their shared session state so drafts survive a hop to Progress.
 */
const TABS = [
  { to: '/training', label: 'Today', end: true },
  { to: '/training/schedule', label: 'Schedule' },
  { to: '/training/workouts', label: 'Workouts' },
  { to: '/training/progress', label: 'Progress' },
];

export default function TrainingLayout() {
  return (
    <div className="training-dash">
      <Reveal style={{ marginBottom: 16 }}>
        <h1 className="page-title">Training</h1>
      </Reveal>
      <nav className="plan-tabs training-tabs" aria-label="Training sections">
        {TABS.map(t => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end}
            className={({ isActive }) => `plan-tab${isActive ? ' is-active' : ''}`}
          >
            {t.label}
          </NavLink>
        ))}
      </nav>
      <TrainingWorkouts />
      <Outlet />
    </div>
  );
}
