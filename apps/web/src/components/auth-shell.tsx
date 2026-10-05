import { AuthCarousel } from './auth-carousel';
import { LangoMark } from './logo';

/**
 * Every sign-in screen (sign in, code, forgot, reset, invitation): the NAVAC CRM split card. Navy story panel on
 * the left, the form on the right. On a phone the card fills the screen and the story panel is left out.
 */
export function AuthShell({
  children,
  audience = 'staff',
}: {
  children: React.ReactNode;
  audience?: 'staff' | 'members';
}) {
  return (
    <div className="auth-bg grid min-h-screen place-items-center sm:p-6">
      <div className="grid min-h-screen w-full overflow-hidden bg-white sm:min-h-0 sm:max-w-[520px] sm:rounded-[20px] sm:shadow-[0_30px_80px_rgba(15,23,41,.18)] lg:min-h-[620px] lg:max-w-[1040px] lg:grid-cols-2">
        <div className="auth-panel relative hidden flex-col items-center p-11 text-white lg:flex">
          <div className="flex justify-center self-center">
            <LangoMark size={36} />
          </div>
          <div className="my-auto py-8">
            <AuthCarousel audience={audience} />
          </div>
          <div className="text-[11px] tracking-[0.08em] text-[#6B7A90]">© {new Date().getFullYear()} NAVAC GLOBAL</div>
        </div>
        <div className="flex flex-col justify-center px-6 py-10 sm:px-12 lg:px-[60px] lg:py-16">
          <div className="mb-8 flex justify-center lg:hidden">
            <LangoMark size={32} />
          </div>
          {children}
          <div className="mt-10 text-center text-[11px] tracking-[0.08em] text-[#94A3B8] lg:hidden">© NAVAC GLOBAL</div>
        </div>
      </div>
    </div>
  );
}

/** Title + one line under it, as on the sign-in card. */
export function AuthHeading({ title, sub }: { title: string; sub?: React.ReactNode }) {
  return (
    <>
      <h1 className="text-[26px] font-semibold tracking-tight text-ink-900">{title}</h1>
      {sub && <p className="mt-1.5 text-sm leading-relaxed text-ink-500">{sub}</p>}
    </>
  );
}

export function AuthNotice({ tone, children }: { tone: 'error' | 'ok' | 'info'; children: React.ReactNode }) {
  const c =
    tone === 'error'
      ? 'bg-rose-50 text-rose-700 ring-rose-200'
      : tone === 'ok'
        ? 'bg-emerald-50 text-emerald-800 ring-emerald-200'
        : 'bg-slate-50 text-ink-700 ring-ink-100';
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`mt-6 rounded-xl p-3 text-sm ring-1 ${c}`}>
      {children}
    </div>
  );
}
