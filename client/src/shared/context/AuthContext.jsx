import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { getAuthToken, clearAuthToken } from '@shared/api/base';
import { fetchMe, logout as apiLogout, patchMe } from '@shared/api/auth';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const token = getAuthToken();
    if (!token) {
      setUser(null);
      setLoading(false);
      return null;
    }
    try {
      const data = await fetchMe();
      setUser(data.user);
      return data.user;
    } catch {
      clearAuthToken();
      setUser(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const onExpired = () => {
      setUser(null);
    };
    window.addEventListener('flops:auth-expired', onExpired);
    return () => window.removeEventListener('flops:auth-expired', onExpired);
  }, [refresh]);

  const logout = useCallback(async () => {
    await apiLogout();
    setUser(null);
  }, []);

  const updateMe = useCallback(async body => {
    const data = await patchMe(body);
    setUser(data.user);
    return data.user;
  }, []);

  const value = useMemo(
    () => ({
      user,
      loading,
      isAuthenticated: !!user,
      needsOnboarding: !!user && !user.onboarding_completed_at,
      isCoach: !!(user && user.is_coach),
      refresh,
      setUser,
      logout,
      updateMe,
    }),
    [user, loading, refresh, logout, updateMe]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
