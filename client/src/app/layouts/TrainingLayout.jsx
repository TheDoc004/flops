import { Link, Outlet } from 'react-router-dom';
import Reveal from '@shared/ui/Reveal';
import GymApp from '@features/training-workouts';

/**
 * Gym dashboard shell. Navbar / BottomNav own Today, Schedule, Workouts,
 * and Progress. This layout keeps the page title and the hop back to nutrition.
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
      <GymApp />
      <Outlet />
    </div>
  );
}
