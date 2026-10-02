'use client';
import { Eye, EyeOff } from 'lucide-react';
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
        className="auth-input pr-12"
      />
      <button
        type="button"
        onClick={() => setShow((v) => !v)}
        aria-controls={id ?? name}
        aria-pressed={show}
        aria-label={show ? 'Hide password' : 'Show password'}
        title={show ? 'Hide password' : 'Show password'}
        className="absolute inset-y-0 right-0 grid place-items-center px-3.5 text-slate-400 hover:text-ink-900"
      >
        {show ? <EyeOff size={18} /> : <Eye size={18} />}
      </button>
    </div>
  );
}
