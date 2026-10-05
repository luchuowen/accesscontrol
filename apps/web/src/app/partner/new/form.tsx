'use client';
import { CheckCircle2 } from 'lucide-react';
import Link from 'next/link';
import { useActionState } from 'react';
import { CopyField } from '@/components/copy-field';
import { SubmitButton } from '@/components/submit-button';
import { type CreateClubState, createClub } from '../actions';

export function NewClubForm({
  consoleUrl,
  partners = [],
}: {
  consoleUrl: string;
  partners?: { id: string; name: string }[];
}) {
  const [state, action] = useActionState<CreateClubState, FormData>(createClub, {});
  if (state.done) {
    const d = state.done;
    return (
      <div className="card max-w-2xl p-6">
        <div className="flex items-center gap-2 text-emerald-700">
          <CheckCircle2 size={18} />
          <span className="font-medium">{d.name} is ready</span>
        </div>
        <div
          className={`mt-4 rounded-xl p-3 text-sm ring-1 ${d.emailed ? 'bg-emerald-50/60 text-emerald-900 ring-emerald-100' : 'bg-amber-50 text-amber-900 ring-amber-200'}`}
        >
          {d.emailed ? (
            <>
              Invitation sent to <b>{d.ownerName}</b> at {d.ownerEmail}. The link works for 7 days; they choose their
              own password.
            </>
          ) : (
            <>
              The club is created, but the invitation email to {d.ownerEmail} did not go out. Resend it from the club’s
              Team settings once email is working.
            </>
          )}
        </div>
        <p className="mt-4 text-sm text-ink-500">
          For the installer: keep these for the door PC and the member portal.
        </p>
        <div className="mt-6 space-y-4">
          <div>
            <span className="label">Console</span>
            <div className="mt-1.5">
              <CopyField value={consoleUrl || '/'} label="Console address" />
            </div>
          </div>
          <div>
            <span className="label">NAVAC Bridge pairing code (valid 30 days)</span>
            <div className="mt-1.5">
              <CopyField value={d.pairCode} label="Pairing code" />
            </div>
          </div>
          <div>
            <span className="label">Club code</span>
            <div className="mt-1.5">
              <CopyField value={d.slug} label="Club code" />
            </div>
          </div>
        </div>
        <Link href="/partner/clubs" className="btn-primary mt-6 w-full">
          Back to clubs
        </Link>
      </div>
    );
  }
  return (
    <form action={action} className="card max-w-2xl space-y-4 p-6">
      {state.error && (
        <div className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700 ring-1 ring-rose-200">{state.error}</div>
      )}
      <label className="block">
        <span className="label">Club name</span>
        <input name="name" required placeholder="Enter club name" className="input mt-1.5" />
      </label>
      <label className="block">
        <span className="label">Club code</span>
        <input name="slug" placeholder="Made from the club name if left blank" className="input mt-1.5" />
        <span className="mt-1 block text-xs text-ink-500">A short name for the club, used in its email address.</span>
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="label">Owner or manager</span>
          <input name="ownerName" required placeholder="Enter full name" className="input mt-1.5" />
        </label>
        <label className="block">
          <span className="label">Their email</span>
          <input name="ownerEmail" type="email" required placeholder="Enter email address" className="input mt-1.5" />
        </label>
      </div>
      <label className="block">
        <span className="label">Their mobile</span>
        <input
          name="ownerPhone"
          type="tel"
          inputMode="tel"
          placeholder="Enter mobile number"
          className="input mt-1.5"
        />
        <span className="mt-1 block text-xs text-ink-500">
          We text them a heads-up so the invitation email isn’t missed. Their sign-in codes go here.
        </span>
      </label>
      {partners.length > 0 && (
        <label className="block">
          <span className="label">Partner</span>
          <select name="partnerId" defaultValue="" className="input mt-1.5">
            <option value="">NAVAC (no partner)</option>
            {partners.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-xs text-ink-500">
            Who sells and installs it. Their shares of the setup fee and subscription follow the club.
          </span>
        </label>
      )}
      <label className="block">
        <span className="label">Time zone</span>
        <select name="timezone" defaultValue="Africa/Nairobi" className="input mt-1.5">
          <option value="Africa/Nairobi">East Africa (Nairobi)</option>
          <option value="Africa/Kampala">Kampala</option>
          <option value="Africa/Dar_es_Salaam">Dar es Salaam</option>
          <option value="Africa/Kigali">Kigali</option>
        </select>
      </label>
      <SubmitButton pendingText="Creating the club…" className="btn-primary w-full">
        Create club and invite the owner
      </SubmitButton>
    </form>
  );
}
