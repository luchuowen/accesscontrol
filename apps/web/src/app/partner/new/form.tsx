'use client';
import { CheckCircle2 } from 'lucide-react';
import { useActionState } from 'react';
import { CopyField } from '@/components/copy-field';
import { SubmitButton } from '@/components/submit-button';
import { type CreateClubState, createClub, openClub } from '../actions';

export function NewClubForm({ consoleUrl }: { consoleUrl: string }) {
  const [state, action] = useActionState<CreateClubState, FormData>(createClub, {});
  if (state.done) {
    const d = state.done;
    return (
      <div className="card max-w-2xl p-6">
        <div className="flex items-center gap-2 text-emerald-700">
          <CheckCircle2 size={18} />
          <span className="font-medium">{d.name} is ready</span>
        </div>
        <p className="mt-2 text-sm text-ink-500">
          Give these to the club now. The password is shown only once; the owner should change it after signing in.
        </p>
        <div className="mt-6 space-y-4">
          <div>
            <span className="label">Console</span>
            <div className="mt-1.5">
              <CopyField value={consoleUrl || '/'} label="Console address" />
            </div>
          </div>
          <div>
            <span className="label">Owner email</span>
            <div className="mt-1.5">
              <CopyField value={d.ownerEmail} label="Owner email" />
            </div>
          </div>
          <div>
            <span className="label">One-time password</span>
            <div className="mt-1.5">
              <CopyField value={d.tempPassword} label="One-time password" />
            </div>
          </div>
          <div>
            <span className="label">Site Bridge pairing code (valid 30 days)</span>
            <div className="mt-1.5">
              <CopyField value={d.pairCode} label="Pairing code" />
            </div>
          </div>
          <div>
            <span className="label">Member portal club code</span>
            <div className="mt-1.5">
              <CopyField value={d.slug} label="Club code" />
            </div>
          </div>
        </div>
        <form action={openClub} className="mt-6">
          <input type="hidden" name="tenantId" value={d.tenantId} />
          <SubmitButton pendingText="Opening…" className="btn-primary w-full">
            Open {d.name}’s console to finish setup
          </SubmitButton>
        </form>
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
        <input name="name" required placeholder="e.g. Muthaiga Golf Club" className="input mt-1.5" />
      </label>
      <label className="block">
        <span className="label">Club code (optional)</span>
        <input name="slug" placeholder="made from the name, e.g. muthaiga-golf-club" className="input mt-1.5" />
        <span className="mt-1 block text-xs text-ink-500">Members type this on the member portal.</span>
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="label">Owner or manager</span>
          <input name="ownerName" required placeholder="Full name" className="input mt-1.5" />
        </label>
        <label className="block">
          <span className="label">Their email</span>
          <input name="ownerEmail" type="email" required placeholder="name@club.co.ke" className="input mt-1.5" />
        </label>
      </div>
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
        Create club
      </SubmitButton>
    </form>
  );
}
