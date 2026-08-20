import { useLocation } from 'react-router-dom';
import GymToday from './pages/GymToday';
import GymSchedule from './pages/GymSchedule';
import GymWorkouts from './pages/GymWorkouts';
import GymProgress from './pages/GymProgress';

/**
 * Gym dashboard bodies. Navbar / BottomNav own the four destinations.
 * Each page loads its own data so hops stay cheap.
 */
export default function GymApp() {
  const { pathname } = useLocation();
  if (pathname.startsWith('/training/schedule')) return <GymSchedule />;
  if (pathname.startsWith('/training/workouts')) return <GymWorkouts />;
  if (pathname.startsWith('/training/progress')) return <GymProgress />;
  return <GymToday />;
}
