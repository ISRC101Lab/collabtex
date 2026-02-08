import React, { useEffect } from 'react';
import { useUiStore } from '@/stores/uiStore';
import './Toast.css';

const Toast: React.FC = () => {
  const toasts = useUiStore((s) => s.toasts);
  const removeToast = useUiStore((s) => s.removeToast);

  return (
    <div className="toast-container">
      {toasts.map((toast) => (
        <ToastItem
          key={toast.id}
          id={toast.id}
          type={toast.type}
          message={toast.message}
          onDismiss={removeToast}
        />
      ))}
    </div>
  );
};

interface ToastItemProps {
  id: string;
  type: 'info' | 'success' | 'warning' | 'error';
  message: string;
  onDismiss: (id: string) => void;
}

const ToastItem: React.FC<ToastItemProps> = ({ id, type, message, onDismiss }) => {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(id), 4000);
    return () => clearTimeout(timer);
  }, [id, onDismiss]);

  return (
    <div className={`toast toast--${type}`}>
      <span className="toast__message">{message}</span>
      <button className="toast__close" onClick={() => onDismiss(id)}>
        &times;
      </button>
    </div>
  );
};

export default Toast;
