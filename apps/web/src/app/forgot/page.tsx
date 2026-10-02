import Link from 'next/link';
import { AuthHeading, AuthShell } from '@/components/auth-shell';
import { SubmitButton } from '@/components/submit-button';
import { forgot } from '../login/actions';

export const metadata = { title: 'Reset password · Lango' };

export default function Forgot() {
  return (
    <AuthShell>
      <AuthHeading
        title="Forgot your password?"
        sub="Enter your email address and we’ll send you a link to reset your password."
      />
      <form action={forgot} className="mt-8 grid gap-[18px]">
        <div>
          <label htmlFor="email" className="auth-label">
            Your Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoFocus
            autoComplete="username"
            inputMode="email"
            placeholder="Enter email address"
            className="auth-input"
          />
        </div>
        <SubmitButton pendingText="Sending…" className="auth-btn">
          Send reset link
        </SubmitButton>
        <p className="text-center text-[12.5px] text-slate-500">
          Remembered it?{' '}
          <Link href="/login" className="auth-link">
            Back to sign in
          </Link>
        </p>
      </form>
    </AuthShell>
  );
}
