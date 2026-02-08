import React from 'react';
import './Input.css';

interface InputProps {
  label?: string;
  error?: string;
  type?: string;
  placeholder?: string;
  value?: string;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  className?: string;
}

const Input: React.FC<InputProps> = ({
  label,
  error,
  type = 'text',
  placeholder,
  value,
  onChange,
  className = '',
}) => {
  const wrapperClass = [
    'input-wrapper',
    error ? 'input-wrapper--error' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={wrapperClass}>
      {label && <label className="input-label">{label}</label>}
      <input
        type={type}
        className="input-field"
        placeholder={placeholder}
        value={value}
        onChange={onChange}
      />
      {error && <span className="input-error">{error}</span>}
    </div>
  );
};

export default Input;
