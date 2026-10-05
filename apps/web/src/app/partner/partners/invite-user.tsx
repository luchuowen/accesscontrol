'use client';
import { Plus, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useRef, useState } from 'react';
import { SubmitButton } from '@/components/submit-button';
import { type AddPartnerState, addPartner } from '../actions';

const ROLES = {
  partner_admin: { label: 'Partner admin', hint: 'Adds clubs, runs onboarding, manages their organization’s users' },
  partner_tech: { label: 'Technician', hint: 'Installs the NAVAC Bridge and doors in the clubs assigned to them' },
  navac_support: { label: 'NAVAC support', hint: 'Sees every club read-only, helps clubs and partners' },
  navac_admin: { label: 'NAVAC admin', hint: 'Everything, including platform settings and prices' },
} as const;
type Role = keyof typeof ROLES;
const NAVAC = 'NAVAC Global';
const NEW = '__new';

/**
 * Users › Invite user ("Access badge", 5 Oct 2026): a centred window with a staff badge that fills in as you type,
 * like the club's New member window. The organization decides which roles fit: NAVAC Global gets NAVAC roles, a partner its own.
 */
export function InviteUser({ platform, orgs, myOrg }: { platform: boolean; orgs: string[]; myOrg: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const [state, action] = useActionState<AddPartnerState, FormData>(addPartner, {});
  const [org, setOrg] = useState(platform ? (orgs.find((o) => o !== NAVAC) ?? NAVAC) : myOrg);
  const [newOrg, setNewOrg] = useState('');
  const navacOrg = platform && org === NAVAC;
  const keys: Role[] = navacOrg ? ['navac_support', 'navac_admin'] : ['partner_admin', 'partner_tech'];
  const [role, setRole] = useState<Role>('partner_admin');
  const shown = keys.includes(role) ? role : (keys[0] as Role);
  const orgName = org === NEW ? newOrg.trim() || 'New organization' : org;
  const [form, setForm] = useState(0); // remount the form for each new invite
  const [sent, setSent] = useState(false);
  const [who, setWho] = useState({ name: '', email: '' });

  useEffect(() => {
    if (!state.done) return;
    setSent(true);
    router.refresh();
  }, [state.done, router]);

  const close = () => ref.current?.close();
  const again = () => {
    setSent(false);
    setWho({ name: '', email: '' });
    setForm((n) => n + 1);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => {
          again();
          ref.current?.showModal();
        }}
        className="btn-primary"
      >
        <Plus size={16} /> Invite user
      </button>
      <dialog
        ref={ref}
        aria-labelledby="invite-user-title"
        onClick={(e) => e.target === ref.current && close()}
        className="m-auto w-full max-w-[880px] overflow-hidden rounded-[20px] bg-white p-0 text-ink-900 shadow-[0_30px_80px_-20px_rgba(11,22,41,0.55)] backdrop:bg-[#0B1629]/45 backdrop:backdrop-blur-[3px] open:animate-[pop_.28s_cubic-bezier(.2,.9,.3,1.2)] max-sm:mb-0 max-sm:max-w-none max-sm:rounded-b-none motion-reduce:open:animate-none"
      >
        <button
          type="button"
          onClick={close}
          aria-label="Close"
          className="absolute right-3 top-3 z-10 grid h-9 w-9 place-items-center rounded-[10px] text-ink-500 hover:bg-slate-100 hover:text-ink-900 max-sm:text-white/80 max-sm:hover:bg-white/10 max-sm:hover:text-white"
        >
          <X size={18} />
        </button>
        <div className="grid sm:grid-cols-[320px_minmax(0,1fr)]">
          <div className="relative flex flex-col gap-6 overflow-hidden bg-[radial-gradient(120%_120%_at_0%_0%,#163257_0%,#0B1629_60%)] p-6 text-white max-sm:p-5">
            <span className="pointer-events-none absolute inset-0 bg-[radial-gradient(70%_60%_at_100%_100%,rgba(16,185,129,0.22),transparent_70%)]" />
            <div className="relative">
              <h2 id="invite-user-title" className="text-xl font-semibold tracking-tight">
                Invite user
              </h2>
              <p className="mt-1.5 text-[13px] leading-relaxed text-[#A3B3C9]">
                They get an email to set their own password. The link works for 7 days.
              </p>
            </div>
            <Badge name={who.name} email={who.email} org={orgName} role={ROLES[shown].label} />
          </div>

          {sent && state.done ? (
            <InviteSent done={state.done} onAgain={again} onClose={close} />
          ) : (
            <form key={form} action={action} className="flex flex-col gap-4 p-6 pt-12 max-sm:p-5">
              {state.error && !sent && (
                <div role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700 ring-1 ring-rose-200">
                  {state.error}
                </div>
              )}
              <div className="grid gap-3.5 sm:grid-cols-2">
                <Field label="Full name">
                  <input
                    name="name"
                    required
                    maxLength={80}
                    placeholder="Enter full name"
                    onChange={(e) => setWho((w) => ({ ...w, name: e.target.value }))}
                    className="input"
                  />
                </Field>
                <Field label="Email">
                  <input
                    name="email"
                    type="email"
                    required
                    placeholder="Enter email address"
                    onChange={(e) => setWho((w) => ({ ...w, email: e.target.value }))}
                    className="input"
                  />
                </Field>
                <Field label="Mobile">
                  <input name="phone" type="tel" inputMode="tel" placeholder="Enter mobile number" className="input" />
                </Field>
                <Field label="Organization">
                  {platform ? (
                    <select value={org} onChange={(e) => setOrg(e.target.value)} className="input">
                      {orgs.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                      <option value={NEW}>New partner organization…</option>
                    </select>
                  ) : (
                    <div className="input bg-ink-50 text-ink-500">{myOrg}</div>
                  )}
                  {platform && !navacOrg && <input type="hidden" name="company" value={org === NEW ? newOrg : org} />}
                </Field>
                {org === NEW && (
                  <Field label="New organization name">
                    <input
                      value={newOrg}
                      onChange={(e) => setNewOrg(e.target.value)}
                      required
                      maxLength={80}
                      placeholder="Enter organization name"
                      className="input"
                    />
                  </Field>
                )}
              </div>
              <fieldset className="grid gap-2">
                <legend className="mb-2 text-[12px] font-semibold text-ink-700">Role</legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {keys.map((k) => (
                    <label
                      key={k}
                      className="flex cursor-pointer items-start gap-2.5 rounded-xl p-3 ring-1 ring-ink-100 has-[:checked]:bg-ink-50 has-[:checked]:ring-ink-900"
                    >
                      <input
                        type="radio"
                        name="role"
                        value={k}
                        checked={shown === k}
                        onChange={() => setRole(k)}
                        className="mt-0.5 accent-ink-900"
                      />
                      <span>
                        <span className="block text-[13px] font-semibold">{ROLES[k].label}</span>
                        <span className="block text-xs leading-relaxed text-ink-500">{ROLES[k].hint}</span>
                      </span>
                    </label>
                  ))}
                </div>
                {shown === 'partner_tech' && (
                  <p className="text-xs text-ink-500">Assign their clubs from the users table once they’re added.</p>
                )}
              </fieldset>
              <div className="mt-auto flex justify-end gap-2 pt-1">
                <button type="button" onClick={close} className="btn-ghost">
                  Cancel
                </button>
                <SubmitButton pendingText="Sending…" className="btn-primary">
                  Send invite
                </SubmitButton>
              </div>
            </form>
          )}
        </div>
      </dialog>
    </>
  );
}

/** The staff badge on the navy panel: fills in as the form is typed. */
function Badge({ name, email, org, role }: { name: string; email: string; org: string; role: string }) {
  const initials =
    name
      .trim()
      .split(/\s+/)
      .map((w) => w[0])
      .join('')
      .slice(0, 2)
      .toUpperCase() || '?';
  return (
    <div
      aria-hidden="true"
      className="relative mt-auto rounded-2xl bg-[linear-gradient(160deg,#FFFFFF_0%,#F1F5F9_100%)] p-4 text-ink-900 shadow-[0_18px_40px_-16px_rgba(0,0,0,0.6)] max-sm:hidden"
    >
      <div className="mx-auto mb-3.5 h-1.5 w-11 rounded-full bg-slate-300" />
      <div className="flex items-center gap-3">
        <div className="grid h-[52px] w-[52px] shrink-0 place-items-center rounded-[14px] bg-[linear-gradient(135deg,#10B981,#047857)] text-lg font-bold text-white">
          {initials}
        </div>
        <div className="min-w-0">
          <div className="min-h-5 truncate text-base font-bold">{name.trim() || 'New user'}</div>
          <div className="truncate text-xs text-ink-500">{email.trim() || 'name@company.co.ke'}</div>
        </div>
      </div>
      <div className="mt-3.5 flex justify-between gap-2 border-t border-dashed border-slate-300 pt-3 text-[10.5px] uppercase tracking-[0.06em] text-ink-500">
        <div className="min-w-0">
          Organization
          <b className="mt-0.5 block truncate text-[13px] normal-case tracking-normal text-ink-900">{org}</b>
        </div>
        <div className="min-w-0 text-right">
          Role
          <b className="mt-0.5 block truncate text-[13px] normal-case tracking-normal text-ink-900">{role}</b>
        </div>
      </div>
    </div>
  );
}

function Field({ label, note, children }: { label: string; note?: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1.5">
      <span className="text-[12px] font-semibold text-ink-700">
        {label} {note && <span className="font-normal text-ink-500">({note})</span>}
      </span>
      {children}
    </label>
  );
}

function InviteSent({
  done,
  onAgain,
  onClose,
}: {
  done: NonNullable<AddPartnerState['done']>;
  onAgain: () => void;
  onClose: () => void;
}) {
  return (
    <div className="flex flex-col justify-center p-6 pt-12 max-sm:p-5">
      <div
        className={`rounded-xl p-4 text-sm ring-1 ${done.emailed ? 'bg-emerald-50 text-emerald-900 ring-emerald-200' : 'bg-amber-50 text-amber-900 ring-amber-200'}`}
      >
        {done.emailed ? (
          <>
            Invite sent to <b>{done.name}</b> at {done.email}. It works for 7 days.
          </>
        ) : (
          <>The user was added but the email did not go out. Use “Resend invite” on their row.</>
        )}
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onAgain} className="btn-ghost">
          Invite another
        </button>
        <button type="button" onClick={onClose} className="btn-primary">
          Done
        </button>
      </div>
    </div>
  );
}
