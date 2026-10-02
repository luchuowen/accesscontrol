'use client';
import { useState } from 'react';

/** Password input with a Show/Hide toggle (NIST 800-63B: let people see what they type). */
export function PasswordField({
  name,
  autoComplete,
  placeholder,
  minLength,
  id,
}: {
  name: string;
  autoComplete: 'current-password' | 'new-password';
  placeholder?: string;
  minLength?: number;
  id?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input
        id={id ?? name}
        name={name}
        type={show ? 'text' : 'password'}
        required
        minLength={minLength}
        maxLength={200}
        autoComplete={autoComplete}
        placeholder={placeholder}
        className="auth-input pr-16"
      />
      <button
        type="button"
        onClick={() => setShow((v) => !v)}
        aria-controls={id ?? name}
        aria-pressed={show}
        className="absolute inset-y-0 right-0 px-3.5 text-xs font-medium text-slate-500 hover:text-ink-900"
      >
        {show ? 'Hide' : 'Show'}
      </button>
    </div>
  );
}
