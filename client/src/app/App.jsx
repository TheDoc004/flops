import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { MacroUnitsProvider } from '@shared/context/MacroUnitsContext';
import { useAuth } from '@shared/context/AuthContext';
import Navbar from '@shared/ui/Navbar';
import BottomNav from '@shared/ui/BottomNav';
import Dashboard from '@features/dashboard';
import Recipes from '@features/recipes';
import History from '@features/history';
import Goals from '@features/goals';
import Report from '@features/report';
import Profile from '@features/profile';
import MealBuilder from '@features/meal-builder';
import PlanLayout from './layouts/PlanLayout';
import TrainingWorkouts from '@features/training-workouts';
import Ingredients from '@features/ingredients';
import LibraryLayout from './layouts/LibraryLayout';
import AiMacroLogger from '@features/ai-macro-logger';
import Login from '@features/auth/Login';
import Onboarding from '@features/auth/Onboarding';
import Coach from '@features/coach';

function AppShell() {
  const { pathname } = useLocation();
  const { isCoach } = useAuth();
  const wide = pathname === '/';
  return (
    <>
      <Navbar />
      <main className={`app-main${wide ? ' app-main--wide' : ''}`}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route element={<LibraryLayout />}>
            <Route path="/recipes" element={<Recipes />} />
            <Route path="/ingredients" element={<Ingredients />} />
          </Route>
          <Route path="/history" element={<History />} />
          <Route path="/meal-builder" element={<MealBuilder />} />
          <Route path="/ai-logger" element={<AiMacroLogger />} />
          <Route path="/training" element={<TrainingWorkouts />} />
          <Route path="/coach" element={isCoach ? <Coach /> : <Navigate to="/" replace />} />

          <Route path="/plan" element={<PlanLayout />}>
            <Route index element={<Navigate to="/plan/goals" replace />} />
            <Route path="goals" element={<Goals />} />
            <Route path="report" element={<Report />} />
            <Route path="profile" element={<Profile />} />
          </Route>

          <Route path="/goals" element={<Navigate to="/plan/goals" replace />} />
          <Route path="/report" element={<Navigate to="/plan/report" replace />} />
          <Route path="/profile" element={<Navigate to="/plan/profile" replace />} />
        </Routes>
      </main>
      <BottomNav />
    </>
  );
}

function AuthGate() {
  const { loading, isAuthenticated, needsOnboarding } = useAuth();

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: '#6b7280' }}>
        Loading…
      </div>
    );
  }
  if (!isAuthenticated) return <Login />;
  if (needsOnboarding) return <Onboarding />;
  return <AppShell />;
}

export default function App() {
  return (
    <BrowserRouter>
      <MacroUnitsProvider>
        <AuthGate />
      </MacroUnitsProvider>
    </BrowserRouter>
  );
}
