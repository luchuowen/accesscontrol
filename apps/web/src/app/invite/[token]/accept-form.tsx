'use client';
import { useActionState } from 'react';
import { AuthNotice } from '@/components/auth-shell';
import { PasswordField } from '@/components/password-field';
import { SubmitButton } from '@/components/submit-button';
import { accept, type PasswordState } from '../../login/actions';

export function AcceptForm({
  token,
  email,
  name,
  phone,
}: {
  token: string;
  email: string;
  name: string;
  phone: string;
}) {
  const [state, action] = useActionState<PasswordState, FormData>(accept, {});
  return (
    <>
      {state.error && <AuthNotice tone="error">{state.error}</AuthNotice>}
      <form action={action} className="mt-7 grid gap-4">
        <input type="hidden" name="token" value={token} />
        <div>
          <span className="auth-label">Your email</span>
          <input
            value={email}
            readOnly
            autoComplete="username"
            className="auth-input bg-slate-50 text-slate-500"
            aria-label="Your email"
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="name" className="auth-label">
              Your name
            </label>
            <input
              id="name"
              name="name"
              required
              defaultValue={name}
              autoComplete="name"
              placeholder="Enter full name"
              maxLength={80}
              className="auth-input"
            />
          </div>
          <div>
            <label htmlFor="phone" className="auth-label">
              Mobile number
            </label>
            <input
              id="phone"
              name="phone"
              required
              defaultValue={phone}
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="Enter mobile number"
              className="auth-input"
            />
          </div>
        </div>
        <div>
          <label htmlFor="password" className="auth-label">
            Choose a password
          </label>
          <PasswordField name="password" autoComplete="new-password" minLength={10} placeholder="Create a password" />
          <p className="mt-1.5 text-xs text-slate-500">
            At least 10 characters. Your sign-in codes go to the mobile above.
          </p>
        </div>
        <div>
          <label htmlFor="confirm" className="auth-label">
            Confirm password
          </label>
          <PasswordField name="confirm" autoComplete="new-password" minLength={10} placeholder="Re-enter password" />
        </div>
        <label className="flex items-start gap-2.5 text-[13px] leading-snug text-slate-600">
          <input
            type="checkbox"
            name="terms"
            required
            className="mt-0.5 h-4 w-4 rounded border-slate-300 accent-[#10B981]"
          />
          <span>I agree to NAVAC Global’s terms for using Lango, and I’ll keep my sign-in details to myself.</span>
        </label>
        <SubmitButton pendingText="Setting up…" className="auth-btn mt-1">
          Accept invitation
        </SubmitButton>
      </form>
    </>
  );
}
