import { useState, useEffect, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Input, Spinner } from '@/components/common';
import { useAuthStore } from '@/stores/authStore';
import { useUiStore } from '@/stores/uiStore';
import './LoginPage.css';

export default function LoginPage() {
  const navigate = useNavigate();
  const { user, loading: authLoading, login, checkAuth } = useAuthStore();
  const addToast = useUiStore((s) => s.addToast);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  useEffect(() => {
    if (!authLoading && user) {
      navigate('/', { replace: true });
    }
  }, [authLoading, user, navigate]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) return;

    setSubmitting(true);
    try {
      await login(username.trim(), password);
      navigate('/', { replace: true });
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Login failed. Please try again.';
      addToast(message, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  if (authLoading) {
    return (
      <div className="login-page">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={handleSubmit}>
        <h1 className="login-title">Aitex</h1>
        <p className="login-subtitle">Sign in to your account</p>

        <Input
          label="Username"
          placeholder="Enter your username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />

        <Input
          label="Password"
          type="password"
          placeholder="Enter your password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        <Button
          type="submit"
          variant="primary"
          loading={submitting}
          disabled={!username.trim() || !password}
        >
          Sign in
        </Button>
      </form>
    </div>
  );
}
