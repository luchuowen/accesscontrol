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
 * Users › Invite user (design B "Organizations first", 5 Oct 2026): a centred window, details on the left and the
 * role on the right. The organization decides which roles fit: NAVAC Global gets NAVAC roles, a partner its own.
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
  const orgName = org === NEW ? newOrg.trim() || 'a new organization' : org;
  const [form, setForm] = useState(0); // remount the form for each new invite
  const [sent, setSent] = useState(false);

  useEffect(() => {
    if (!state.done) return;
    setSent(true);
    router.refresh();
  }, [state.done, router]);

  const close = () => ref.current?.close();
  const again = () => {
    setSent(false);
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
        className="m-auto w-full max-w-[820px] overflow-hidden rounded-[18px] bg-white p-0 text-ink-900 shadow-[0_30px_80px_-20px_rgba(11,22,41,0.55)] backdrop:bg-[#0B1629]/45 backdrop:backdrop-blur-[3px] max-sm:mb-0 max-sm:max-w-none max-sm:rounded-b-none"
      >
        <div className="flex items-start justify-between gap-3 px-6 pb-1 pt-5">
          <div>
            <h2 id="invite-user-title" className="text-lg font-semibold tracking-tight">
              Invite user
            </h2>
            <p className="mt-1 text-[13px] text-ink-500">
              They get an email to set their own password. The link works for 7 days.
            </p>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="grid h-9 w-9 place-items-center rounded-[10px] text-ink-500 hover:bg-slate-100 hover:text-ink-900"
          >
            <X size={18} />
          </button>
        </div>

        {sent && state.done ? (
          <InviteSent done={state.done} onAgain={again} onClose={close} />
        ) : (
          <form key={form} action={action}>
            <div className="grid gap-5 px-6 py-4 sm:grid-cols-2">
              <div className="grid content-start gap-3">
                {state.error && !sent && (
                  <div role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700 ring-1 ring-rose-200">
                    {state.error}
                  </div>
                )}
                <Field label="Full name">
                  <input name="name" required maxLength={80} placeholder="Enter full name" className="input" />
                </Field>
                <Field label="Email">
                  <input name="email" type="email" required placeholder="Enter email address" className="input" />
                </Field>
                <Field label="Mobile" note="optional">
                  <input name="phone" type="tel" inputMode="tel" placeholder="Enter mobile number" className="input" />
                </Field>
                <Field label="Organization">
                  {platform ? (
                    <>
                      <select value={org} onChange={(e) => setOrg(e.target.value)} className="input">
                        {orgs.map((o) => (
                          <option key={o} value={o}>
                            {o}
                          </option>
                        ))}
                        <option value={NEW}>New partner organization…</option>
                      </select>
                      {org === NEW && (
                        <input
                          value={newOrg}
                          onChange={(e) => setNewOrg(e.target.value)}
                          required
                          maxLength={80}
                          placeholder="Enter organization name"
                          className="input mt-2"
                        />
                      )}
                    </>
                  ) : (
                    <div className="input bg-ink-50 text-ink-500">{myOrg}</div>
                  )}
                  {platform && !navacOrg && <input type="hidden" name="company" value={org === NEW ? newOrg : org} />}
                </Field>
              </div>
              <fieldset className="grid content-start gap-2">
                <legend className="label mb-2">Role</legend>
                <div className="overflow-hidden rounded-xl ring-1 ring-ink-100">
                  {keys.map((k) => (
                    <label
                      key={k}
                      className="flex cursor-pointer items-start gap-3 border-b border-ink-100 px-3.5 py-3 last:border-b-0 has-[:checked]:bg-ink-50"
                    >
                      <input
                        type="radio"
                        name="role"
                        value={k}
                        checked={shown === k}
                        onChange={() => setRole(k)}
                        className="mt-1 accent-ink-900"
                      />
                      <span>
                        <span className="block text-sm font-semibold">{ROLES[k].label}</span>
                        <span className="block text-xs leading-relaxed text-ink-500">{ROLES[k].hint}</span>
                      </span>
                    </label>
                  ))}
                </div>
                {shown === 'partner_tech' && (
                  <p className="text-xs text-ink-500">Assign their clubs from the users table once they’re added.</p>
                )}
              </fieldset>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ink-100 px-6 py-4">
              <span className="text-[13px] text-ink-500">
                Inviting to <b className="text-ink-900">{orgName}</b> as{' '}
                <b className="text-ink-900">{ROLES[shown].label}</b>
              </span>
              <div className="flex gap-2">
                <button type="button" onClick={close} className="btn-ghost">
                  Cancel
                </button>
                <SubmitButton pendingText="Sending…" className="btn-primary">
                  Send invite
                </SubmitButton>
              </div>
            </div>
          </form>
        )}
      </dialog>
    </>
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
    <div className="px-6 pb-6 pt-3">
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
