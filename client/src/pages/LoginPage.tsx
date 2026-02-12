import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Input, Spinner } from '@/components/common';
import { useAuthStore } from '@/stores/authStore';
import { useUiStore } from '@/stores/uiStore';
import './LoginPage.css';

const DEFAULT_HINT_DISMISSED_KEY = 'aitex-default-login-hint-dismissed';

const AITEX_ASCII = ` \u2588\u2588\u2588\u2588\u2588\u2557 \u2588\u2588\u2557\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2557\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2557\u2588\u2588\u2557  \u2588\u2588\u2557
\u2588\u2588\u2554\u2550\u2550\u2588\u2588\u2557\u2588\u2588\u2551\u255A\u2550\u2550\u2588\u2588\u2554\u2550\u2550\u255D\u2588\u2588\u2554\u2550\u2550\u2550\u2550\u255D\u255A\u2588\u2588\u2557\u2588\u2588\u2554\u255D
\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2551\u2588\u2588\u2551   \u2588\u2588\u2551   \u2588\u2588\u2588\u2588\u2588\u2557   \u255A\u2588\u2588\u2588\u2554\u255D
\u2588\u2588\u2554\u2550\u2550\u2588\u2588\u2551\u2588\u2588\u2551   \u2588\u2588\u2551   \u2588\u2588\u2554\u2550\u2550\u255D   \u2588\u2588\u2554\u2588\u2588\u2557
\u2588\u2588\u2551  \u2588\u2588\u2551\u2588\u2588\u2551   \u2588\u2588\u2551   \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2557\u2588\u2588\u2554\u255D \u2588\u2588\u2557
\u255A\u2550\u255D  \u255A\u2550\u255D\u255A\u2550\u255D   \u255A\u2550\u255D   \u255A\u2550\u2550\u2550\u2550\u2550\u2550\u255D\u255A\u2550\u255D  \u255A\u2550\u255D`;

const CAPS = [
  { icon: '\u25C6', label: 'Write LaTeX', cls: 'write' },
  { icon: '\u270E', label: 'Edit Files', cls: 'edit' },
  { icon: '\u25B8', label: 'Compile PDF', cls: 'compile' },
  { icon: '\u2299', label: 'Fix Errors', cls: 'fix' },
];

export default function LoginPage() {
  const navigate = useNavigate();
  const { user, loading: authLoading, login, checkAuth } = useAuthStore();
  const addToast = useUiStore((s) => s.addToast);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showDefaultHint, setShowDefaultHint] = useState(false);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  useEffect(() => {
    if (!authLoading && user) {
      navigate('/', { replace: true });
    }
  }, [authLoading, user, navigate]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    try {
      setShowDefaultHint(!localStorage.getItem(DEFAULT_HINT_DISMISSED_KEY));
    } catch {
      setShowDefaultHint(true);
    }
  }, []);

  const dismissDefaultHint = () => {
    setShowDefaultHint(false);
    try {
      localStorage.setItem(DEFAULT_HINT_DISMISSED_KEY, '1');
    } catch {
    }
  };

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
      <div className="login-hero">
        {/* ── ASCII Art Brand ── */}
        <pre className="login-hero__ascii" aria-label="Aitex">{AITEX_ASCII}</pre>
        <p className="login-hero__tagline">AI-Powered LaTeX Editor</p>

        {/* ── Capability Pills ── */}
        <div className="login-hero__caps">
          {CAPS.map((c) => (
            <span key={c.cls} className={`login-hero__cap login-hero__cap--${c.cls}`}>
              <span className="login-hero__cap-icon">{c.icon}</span>
              {c.label}
            </span>
          ))}
        </div>
      </div>

      <form className="login-card" onSubmit={handleSubmit}>
        <p className="login-subtitle">Sign in to your account</p>

        {showDefaultHint && (
          <div className="login-default-hint" role="note">
            <div className="login-default-hint__title">First start default account</div>
            <div className="login-default-hint__line">Username: <code>admin</code></div>
            <div className="login-default-hint__line">Password: <code>ChangeMe!2026</code></div>
            <button type="button" className="login-default-hint__close" onClick={dismissDefaultHint}>
              Got it
            </button>
          </div>
        )}

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
