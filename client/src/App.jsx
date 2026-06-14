import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { MacroUnitsProvider } from './context/MacroUnitsContext';
import Navbar from './components/Navbar';
import BottomNav from './components/BottomNav';
import Dashboard from './pages/Dashboard';
import Recipes from './pages/Recipes';
import History from './pages/History';
import Goals from './pages/Goals';
import Report from './pages/Report';
import Profile from './features/profile';
import Training from './pages/Training';
import MealBuilder from './pages/MealBuilder';
import PlanLayout from './pages/Plan';
import TrainingWorkouts from './pages/TrainingWorkouts';
import Ingredients from './pages/Ingredients';

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
