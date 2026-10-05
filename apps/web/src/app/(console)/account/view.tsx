import { roleLabel, staffById } from '@lango/server';
import { KeyRound, Laptop, LogOut, Smartphone } from 'lucide-react';
import { SubmitButton } from '@/components/submit-button';
import { Badge, PageHeader } from '@/components/ui';
import { ago } from '@/lib/format';
import type { Session } from '@/lib/session';
import { db } from '@/server/db';
import { signOut } from '../../login/actions';
import { changePassword, endSession, savePhone } from './actions';

const MSG: Record<string, [ok: boolean, text: string]> = {
  'pw-ok': [true, 'Password changed. Your other devices were signed out, and we emailed you a note.'],
  short: [false, 'Use at least 10 characters.'],
  long: [false, 'Use at most 128 characters.'],
  guessable: [false, 'That password is too easy to guess. Try a short phrase only you would use.'],
  breached: [false, 'That password has appeared in a data breach elsewhere. Choose another.'],
  mismatch: [false, 'The two new passwords are not the same.'],
  wrong: [false, 'Your current password is not right.'],
  wait: [false, 'Too many attempts. Wait 15 minutes and try again.'],
  phone: [false, 'Enter a Kenyan mobile number, e.g. 0712 345 678.'],
  'phone-ok': [true, 'Mobile number saved. Sign-in codes go there from now on.'],
  ended: [true, 'That device was signed out.'],
  this: [false, 'Use “Sign out” in the menu for this device.'],
};

const device = (ua: string | null) => {
  const u = ua ?? '';
  const os = /iPhone|iPad/.test(u)
    ? 'iPhone'
    : /Android/.test(u)
      ? 'Android'
      : /Mac OS/.test(u)
        ? 'Mac'
        : /Windows/.test(u)
          ? 'Windows'
          : /Linux/.test(u)
            ? 'Linux'
            : 'Unknown device';
  const br = /Edg\//.test(u)
    ? 'Edge'
    : /Chrome\//.test(u)
      ? 'Chrome'
      : /Safari\//.test(u)
        ? 'Safari'
        : /Firefox\//.test(u)
          ? 'Firefox'
          : '';
  return { label: br ? `${br} on ${os}` : os, mobile: /iPhone|Android/.test(u) };
};

/** Your account (mobile, password, devices). Shown in the club console and in the partner console. */
export async function AccountView({ s, m, from }: { s: Session; m?: string; from: 'club' | 'partner' }) {
  const msg = m ? MSG[m] : undefined;
  const me = await staffById(db(), s.uid);
  const sessions = await db()<
    { id: string; ip: string | null; user_agent: string | null; last_seen_at: Date; created_at: Date }[]
  >`
    select id, ip, user_agent, last_seen_at, created_at from auth_sessions
    where staff_id = ${s.uid} and revoked_at is null and expires_at > now() order by last_seen_at desc`;
  return (
    <>
      <PageHeader
        title="Your account"
        repeats={from === 'partner'}
        subtitle={from === 'club' ? `${me?.email} · ${roleLabel(s.role)} in this club` : me?.email}
      />
      {msg && (
        <div
          className={`mb-6 rounded-xl p-3 text-sm ring-1 ${msg[0] ? 'bg-emerald-50 text-emerald-800 ring-emerald-200' : 'bg-rose-50 text-rose-700 ring-rose-200'}`}
        >
          {msg[1]}
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card p-6">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-ink-50">
              <Smartphone size={18} />
            </div>
            <div>
              <div className="font-medium">Mobile for sign-in codes</div>
              <div className="text-xs text-ink-500">Every sign-in on a new device asks for a code sent here</div>
            </div>
          </div>
          <form action={savePhone} className="mt-5 space-y-3">
            <input type="hidden" name="from" value={from} />
            <input
              name="phone"
              type="tel"
              inputMode="tel"
              required
              defaultValue={me?.phone ? `0${me.phone.slice(3)}` : ''}
              placeholder="Enter mobile number"
              autoComplete="tel"
              className="input"
            />
            <input
              name="current"
              type="password"
              required
              placeholder="Enter your password to confirm"
              autoComplete="current-password"
              className="input"
            />
            <SubmitButton pendingText="Saving…" className="btn-ghost w-full">
              Save mobile
            </SubmitButton>
          </form>
        </section>
        <section className="card p-6">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-ink-50">
              <KeyRound size={18} />
            </div>
            <div>
              <div className="font-medium">Password</div>
              <div className="text-xs text-ink-500">At least 10 characters; a short phrase works well</div>
            </div>
          </div>
          <form action={changePassword} className="mt-5 space-y-3">
            <input type="hidden" name="from" value={from} />
            <input
              name="current"
              type="password"
              required
              placeholder="Enter current password"
              autoComplete="current-password"
              className="input"
            />
            <input
              name="next"
              type="password"
              required
              minLength={10}
              placeholder="Enter new password"
              autoComplete="new-password"
              className="input"
            />
            <input
              name="confirm"
              type="password"
              required
              minLength={10}
              placeholder="Re-enter new password"
              autoComplete="new-password"
              className="input"
            />
            <SubmitButton pendingText="Saving…" className="btn-ghost w-full">
              Change password
            </SubmitButton>
          </form>
        </section>
        <section className="card p-6 lg:col-span-2">
          <div className="flex flex-wrap items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-ink-50">
              <Laptop size={18} />
            </div>
            <div className="flex-1">
              <div className="font-medium">Where you’re signed in</div>
              <div className="text-xs text-ink-500">Sign out a device you no longer use, or every device at once</div>
            </div>
            <form action={signOut}>
              <input type="hidden" name="everywhere" value="on" />
              <button type="submit" className="btn bg-rose-50 text-rose-700 ring-1 ring-rose-200 hover:bg-rose-100">
                <LogOut size={15} /> Sign out everywhere
              </button>
            </form>
          </div>
          <ul className="mt-4 divide-y divide-ink-100 text-sm">
            {sessions.map((x) => {
              const d = device(x.user_agent);
              return (
                <li key={x.id} className="flex flex-wrap items-center gap-3 py-3">
                  <span className="text-ink-500">{d.mobile ? <Smartphone size={16} /> : <Laptop size={16} />}</span>
                  <span className="flex-1">
                    <span className="font-medium">{d.label}</span>
                    {x.id === s.sid && (
                      <span className="ml-2">
                        <Badge tone="green">this device</Badge>
                      </span>
                    )}
                    <span className="block text-xs text-ink-500">
                      {x.ip ?? 'unknown network'} · active {ago(x.last_seen_at)}
                    </span>
                  </span>
                  {x.id !== s.sid && (
                    <form action={endSession}>
                      <input type="hidden" name="from" value={from} />
                      <input type="hidden" name="sid" value={x.id} />
                      <button type="submit" className="text-xs font-medium text-ink-500 hover:text-rose-700">
                        Sign out
                      </button>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </>
  );
}
