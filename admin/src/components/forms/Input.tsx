import type { InputHTMLAttributes, ReactNode } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: ReactNode;
  error?: string;
  hint?: ReactNode;
}

export function Input({ label, error, hint, id, ...rest }: InputProps) {
  const inputId = id ?? rest.name;
  return (
    <div className="field">
      {label && <label htmlFor={inputId}>{label}</label>}
      <input id={inputId} {...rest} />
      {hint && !error && <div className="fs-11 text-muted mt-4">{hint}</div>}
      {error && <div className="field-error">{error}</div>}
    </div>
  );
}
