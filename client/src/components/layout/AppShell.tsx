import { useEffect } from 'react';
import { Outlet, Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { Header } from './Header';
import './AppShell.css';

export function AppShell() {
  const { user, loading, checkAuth } = useAuthStore();
  const location = useLocation();
  const isEditorRoute = location.pathname.startsWith('/project/');

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  if (loading) {
    return (
      <div className="appshell__loading">
        <div className="appshell__spinner" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="appshell">
      {!isEditorRoute && <Header />}
      <main className="appshell__content">
        <Outlet />
      </main>
    </div>
  );
}
