import { memberOtpStatus } from '@lango/server';
import { ChevronRight } from 'lucide-react';
import { AuthHeading, AuthNotice, AuthShell } from '@/components/auth-shell';
import { SubmitButton } from '@/components/submit-button';
import { db } from '@/server/db';
import { Checking, CodeTimer, OtpInput, ResendButton } from '../login/code/otp';
import { memberLogin, memberPick, memberStart, memberVerify } from './actions';
import { pendingPhone, pendingPicks } from './session';

/** 0712 345 678 */
const local = (n: string) => `0${n.slice(3, 6)} ${n.slice(6, 9)} ${n.slice(9)}`;

/**
 * Member portal sign-in: phone number → SMS code → in (members at several clubs then pick one). Clubs that
 * cannot send SMS ask for the member number instead of a code.
 */
export async function MemberSignIn({ sp }: { sp: { e?: string; step?: string; w?: string; from?: string } }) {
  const staff = sp.from === 'staff';
  const FromStaff = () => (staff ? <input type="hidden" name="from" value="staff" /> : null);
  const restart = staff ? '/m?from=staff' : '/m';
  // Someone who came from the staff sign-in keeps a way back on every step; links sent to members never show it.
  const BackToStaff = () =>
    staff ? (
      <p className="mt-3 text-center text-[13px] text-slate-500">
        Not a member?{' '}
        <a href="/login" className="auth-link font-semibold">
          Staff sign-in
        </a>
      </p>
    ) : null;
  const ChangeNumber = () => (
    <p className="mt-3 text-center text-[13px]">
      <a href={restart} className="text-slate-500 hover:text-ink-900">
        Use a different number
      </a>
    </p>
  );
  const busy = sp.e === '2' ? 'Too many attempts. Wait a few minutes and try again.' : null;

  const phone = await pendingPhone();
  const step = phone && ['code', 'number', 'club'].includes(sp.step ?? '') ? sp.step : 'start';

  if (step === 'code' && phone) {
    const st = await memberOtpStatus(db(), phone);
    const minutes = Math.max(1, Math.ceil((st.resendAt - Date.now()) / 60_000));
    const error = busy ?? (sp.e === '1' ? 'That code isn’t right or has expired. Check the latest SMS.' : null);
    return (
      <AuthShell audience="members">
        <div className="text-center">
          <CodeTimer expiresAt={st.expiresAt} />
          <h1 className="text-[26px] font-semibold tracking-tight text-ink-900">Enter your code</h1>
          <p className="mt-1.5 text-sm text-ink-500">Sent by SMS to {local(phone)}.</p>
        </div>
        {error && <AuthNotice tone="error">{error}</AuthNotice>}
        {!error && sp.w && !st.capped && (
          <AuthNotice tone="info">A code was sent a moment ago. Use that one, or wait to ask for another.</AuthNotice>
        )}
        <form action={memberVerify}>
          <FromStaff />
          <OtpInput />
          <Checking />
        </form>
        <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-center text-[13px] text-slate-600">
          {st.capped ? (
            <>
              You’ve asked for several codes. For your security, try again in about {minutes} minute
              {minutes === 1 ? '' : 's'}.
            </>
          ) : (
            <span className="inline-flex flex-wrap items-center justify-center gap-x-1.5">
              Didn’t get it?
              <form action={memberStart} className="inline">
                <input type="hidden" name="resend" value="1" />
                <FromStaff />
                <ResendButton resendAt={st.resendAt} label="Resend SMS" />
              </form>
            </span>
          )}
        </div>
        <ChangeNumber />
        <BackToStaff />
      </AuthShell>
    );
  }

  if (step === 'club') {
    const picks = await pendingPicks();
    return (
      <AuthShell audience="members">
        <AuthHeading title="Choose your membership" sub="This number has more than one membership." />
        <form action={memberPick} className="mt-8 grid gap-2.5">
          <FromStaff />
          {picks.map((p) => (
            <button
              key={p.m}
              name="member"
              value={p.m}
              type="submit"
              className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3.5 text-left text-[15px] font-semibold text-ink-900 hover:border-emerald-400 hover:bg-emerald-50/40"
            >
              <span>
                {p.c}
                <span className="block text-[12.5px] font-normal text-slate-500">Member {p.n}</span>
              </span>
              <ChevronRight size={18} className="text-slate-400" />
            </button>
          ))}
        </form>
        {!picks.length && <AuthNotice tone="info">That took too long. Start again.</AuthNotice>}
        <ChangeNumber />
        <BackToStaff />
      </AuthShell>
    );
  }

  if (step === 'number' && phone) {
    const error =
      busy ?? (sp.e === '1' ? 'That member number doesn’t match this phone. Check your card or receipt.' : null);
    return (
      <AuthShell audience="members">
        <AuthHeading title="Your member number" sub={`To confirm it’s you on ${local(phone)}.`} />
        {error && <AuthNotice tone="error">{error}</AuthNotice>}
        <form action={memberLogin} className="mt-8 grid gap-[18px]">
          <FromStaff />
          <div>
            <label htmlFor="memberNo" className="auth-label">
              Member number
            </label>
            <input
              id="memberNo"
              name="memberNo"
              inputMode="numeric"
              required
              autoFocus
              placeholder="Enter member number"
              className="auth-input"
            />
          </div>
          <SubmitButton pendingText="Checking…" className="auth-btn mt-1">
            Sign in
          </SubmitButton>
          <p className="text-center text-[12.5px] text-slate-500">It’s on your membership card or receipt.</p>
        </form>
        <ChangeNumber />
        <BackToStaff />
      </AuthShell>
    );
  }

  const error = busy ?? (sp.e === '3' ? 'Enter a Kenyan mobile number.' : null);
  return (
    <AuthShell audience="members">
      <AuthHeading title="Member sign-in" sub="We’ll send a sign-in code by SMS." />
      {error && <AuthNotice tone="error">{error}</AuthNotice>}
      <form action={memberStart} className="mt-8 grid gap-[18px]">
        <FromStaff />
        <div>
          <label htmlFor="phone" className="auth-label">
            Phone number
          </label>
          <input
            id="phone"
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            required
            defaultValue={phone ? local(phone) : ''}
            placeholder="Enter phone number"
            className="auth-input"
          />
        </div>
        <SubmitButton pendingText="Sending…" className="auth-btn mt-1">
          Send code
        </SubmitButton>
        <p className="text-center text-[12.5px] text-slate-500">Use the number your club has for you.</p>
      </form>
      <BackToStaff />
    </AuthShell>
  );
}
