import React from 'react';
import './Spinner.css';

interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg';
}

const Spinner: React.FC<SpinnerProps> = ({ size = 'md' }) => {
  return <div className={`spinner spinner--${size}`} />;
};

export default Spinner;
