import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { MacroUnitsProvider } from '@shared/context/MacroUnitsContext';
import Navbar from '@shared/ui/Navbar';
import BottomNav from '@shared/ui/BottomNav';
import Dashboard from './pages/Dashboard';
import Recipes from '@features/recipes';
import History from '@features/history';
import Goals from '@features/goals';
import Report from '@features/report';
import Profile from '@features/profile';
import Training from '@features/training-fuel';
import MealBuilder from '@features/meal-builder';
import PlanLayout from './pages/Plan';
import TrainingWorkouts from '@features/training-workouts';
import Ingredients from '@features/ingredients';

export default function App() {
  return (
    <BrowserRouter>
      <MacroUnitsProvider>
      <Navbar />
      <main className="app-main" style={{ maxWidth: 1152, margin: '0 auto' }}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/recipes" element={<Recipes />} />
          <Route path="/ingredients" element={<Ingredients />} />
          <Route path="/history" element={<History />} />
          <Route path="/meal-builder" element={<MealBuilder />} />
          <Route path="/training" element={<TrainingWorkouts />} />

          <Route path="/plan" element={<PlanLayout />}>
            <Route index element={<Navigate to="/plan/goals" replace />} />
            <Route path="goals" element={<Goals />} />
            <Route path="fuel" element={<Training />} />
            <Route path="report" element={<Report />} />
            <Route path="profile" element={<Profile />} />
          </Route>

          {/* Back-compat redirects */}
          <Route path="/goals" element={<Navigate to="/plan/goals" replace />} />
          <Route path="/fuel" element={<Navigate to="/plan/fuel" replace />} />
          <Route path="/report" element={<Navigate to="/plan/report" replace />} />
          <Route path="/profile" element={<Navigate to="/plan/profile" replace />} />
        </Routes>
      </main>
      <BottomNav />
      </MacroUnitsProvider>
    </BrowserRouter>
  );
}
