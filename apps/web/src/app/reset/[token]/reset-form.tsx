'use client';
import { useActionState } from 'react';
import { AuthNotice } from '@/components/auth-shell';
import { PasswordField } from '@/components/password-field';
import { SubmitButton } from '@/components/submit-button';
import { type PasswordState, reset } from '../../login/actions';

export function ResetForm({ token, email }: { token: string; email: string }) {
  const [state, action] = useActionState<PasswordState, FormData>(reset, {});
  return (
    <>
      {state.error && <AuthNotice tone="error">{state.error}</AuthNotice>}
      <form action={action} className="mt-8 grid gap-[18px]">
        <input type="hidden" name="token" value={token} />
        <input type="hidden" name="email" value={email} autoComplete="username" />
        <div>
          <label htmlFor="password" className="auth-label">
            New password
          </label>
          <PasswordField name="password" autoComplete="new-password" minLength={10} placeholder="Enter new password" />
          <p className="mt-1.5 text-xs text-slate-500">
            At least 10 characters. A short phrase is easy to remember and hard to guess.
          </p>
        </div>
        <div>
          <label htmlFor="confirm" className="auth-label">
            Confirm password
          </label>
          <PasswordField
            name="confirm"
            autoComplete="new-password"
            minLength={10}
            placeholder="Re-enter new password"
          />
        </div>
        <SubmitButton pendingText="Saving…" className="auth-btn mt-1">
          Set new password
        </SubmitButton>
      </form>
    </>
  );
}
