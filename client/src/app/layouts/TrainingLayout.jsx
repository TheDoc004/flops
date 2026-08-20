import { Link, Outlet } from 'react-router-dom';
import Reveal from '@shared/ui/Reveal';
import TrainingWorkouts from '@features/training-workouts';

/**
 * Gym dashboard shell. Navbar / BottomNav own Today, Schedule, Workouts,
 * and Progress. This layout keeps the page title, the hop back to
 * nutrition, and the shared workout state so drafts survive a tab change.
 */
const hopStyle = {
  fontSize: '15px',
  fontWeight: 600,
  padding: '10px 18px',
  minHeight: '44px',
  textDecoration: 'none',
};

export default function TrainingLayout() {
  return (
    <div className="training-dash">
      <Reveal className="dash-toolbar">
        <h1 className="page-title">Training</h1>
        <Link
          to="/"
          className="btn-secondary"
          style={hopStyle}
          title="Back to the nutrition dashboard"
        >
          Nutrition
        </Link>
      </Reveal>
      <TrainingWorkouts />
      <Outlet />
    </div>
  );
}
