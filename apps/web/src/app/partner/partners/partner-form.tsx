'use client';
import { useActionState, useState } from 'react';
import { SubmitButton } from '@/components/submit-button';
import { type AddPartnerState, addPartner } from '../actions';

const ROLES = {
  partner_admin: { label: 'Partner admin', hint: 'Adds clubs, runs onboarding, manages their company’s people' },
  partner_tech: { label: 'Technician', hint: 'Installs the Site Bridge and doors in the clubs assigned to them' },
  navac_support: { label: 'NAVAC support', hint: 'Sees every club read-only, helps clubs and partners' },
  navac_admin: { label: 'NAVAC admin', hint: 'Everything, including platform settings and prices' },
} as const;

export function AddPartnerForm({
  platform,
  company,
  companies = [],
}: {
  platform: boolean;
  company: string;
  companies?: string[];
}) {
  const [state, action] = useActionState<AddPartnerState, FormData>(addPartner, {});
  const keys = (platform ? Object.keys(ROLES) : ['partner_admin', 'partner_tech']) as (keyof typeof ROLES)[];
  const [role, setRole] = useState<keyof typeof ROLES>(platform ? 'partner_admin' : 'partner_tech');
  const needsCompany = platform && (role === 'partner_admin' || role === 'partner_tech');
  return (
    <form action={action} className="mt-4 space-y-3">
      {state.error && (
        <div className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700 ring-1 ring-rose-200">{state.error}</div>
      )}
      {state.done && (
        <div
          className={`rounded-xl p-3 text-sm ring-1 ${state.done.emailed ? 'bg-emerald-50/60 ring-emerald-100' : 'bg-amber-50 text-amber-900 ring-amber-200'}`}
        >
          {state.done.emailed ? (
            <>
              Invitation sent to <b>{state.done.name}</b> at {state.done.email}. It works for 7 days.
            </>
          ) : (
            <>The login was created but the email did not go out. Use “Resend invitation” on their row.</>
          )}
        </div>
      )}
      <input name="name" required maxLength={80} placeholder="Enter full name" className="input" />
      <input name="email" type="email" required placeholder="Enter email address" className="input" />
      <input name="phone" type="tel" inputMode="tel" placeholder="Enter mobile number (optional)" className="input" />
      <fieldset className="space-y-1.5">
        <legend className="label mb-1.5">Role</legend>
        {keys.map((k) => (
          <label
            key={k}
            className="flex cursor-pointer items-start gap-2.5 rounded-xl p-2.5 ring-1 ring-ink-100 has-[:checked]:bg-ink-50 has-[:checked]:ring-ink-900"
          >
            <input
              type="radio"
              name="role"
              value={k}
              checked={role === k}
              onChange={() => setRole(k)}
              className="mt-0.5 accent-ink-900"
            />
            <span>
              <span className="block text-sm font-medium">{ROLES[k].label}</span>
              <span className="block text-xs text-ink-500">{ROLES[k].hint}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {needsCompany ? (
        <>
          <input
            name="company"
            required
            list="partner-companies"
            defaultValue={companies.length === 1 ? companies[0] : ''}
            placeholder="Choose a company or type a new one"
            className="input"
          />
          <datalist id="partner-companies">
            {companies.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </>
      ) : (
        !platform && <p className="text-xs text-ink-500">They join {company}.</p>
      )}
      <SubmitButton pendingText="Sending…" className="btn-primary w-full">
        Send invitation
      </SubmitButton>
    </form>
  );
}
