'use client';
import { Camera, Check, Laptop, Moon, ShieldCheck, Sun, Trash2, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useRef, useState } from 'react';
import { type ProfileState, saveProfile } from '@/app/(console)/account/actions';
import { SubmitButton } from '@/components/submit-button';

export type Theme = 'light' | 'dark' | 'system';

/** Applies a theme choice to the page (system follows the device). */
export function applyTheme(t: Theme) {
  const dark = t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.mode = dark ? 'dark' : 'light';
  document.documentElement.dataset.theme = t;
}

/** Follows the device when the choice is "system", including when it changes while the page is open. */
export function ThemeWatcher({ theme }: { theme: Theme }) {
  useEffect(() => {
    applyTheme(theme);
    if (theme !== 'system') return;
    const m = window.matchMedia('(prefers-color-scheme: dark)');
    const on = () => applyTheme('system');
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, [theme]);
  return null;
}

export const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');

export function Avatar({ name, src, size = 36 }: { name: string; src?: string | null; size?: number }) {
  return src ? (
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      className="shrink-0 rounded-full object-cover"
      style={{ width: size, height: size }}
    />
  ) : (
    <span
      className="grid shrink-0 place-items-center rounded-full bg-gradient-to-br from-emerald-500 to-emerald-700 font-semibold text-white"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.34) }}
    >
      {initialsOf(name)}
    </span>
  );
}

/** Square-crops and shrinks a photo in the browser to a ~192 px JPEG, so uploads stay tiny. */
async function shrink(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, bad) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = bad;
      i.src = url;
    });
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const c = document.createElement('canvas');
    c.width = c.height = 192;
    const g = c.getContext('2d');
    if (!g) throw new Error('canvas');
    g.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, 192, 192);
    return c.toDataURL('image/jpeg', 0.82);
  } finally {
    URL.revokeObjectURL(url);
  }
}

const THEMES: { key: Theme; label: string; icon: typeof Sun }[] = [
  { key: 'light', label: 'Light', icon: Sun },
  { key: 'dark', label: 'Dark', icon: Moon },
  { key: 'system', label: 'System', icon: Laptop },
];

function Preview({ t }: { t: Theme }) {
  const half = t === 'system';
  const Pane = ({ dark }: { dark: boolean }) => (
    <span className={`grid h-full grid-cols-[22%_1fr] ${dark ? 'bg-[#0C1220]' : 'bg-[#F4F6F9]'}`}>
      <i className={dark ? 'bg-[#060A14]' : 'bg-[#0B1629]'} />
      <span className="grid content-start gap-1 p-1.5">
        <i className={`h-1.5 w-2/3 rounded-full ${dark ? 'bg-[#2A3550]' : 'bg-[#D5DBE6]'}`} />
        <i className={`h-5 rounded-[4px] ${dark ? 'bg-[#141B2B]' : 'bg-white'}`} />
      </span>
    </span>
  );
  return (
    <span className="relative block h-14 overflow-hidden rounded-lg ring-1 ring-black/5">
      {half ? (
        <span className="grid h-full grid-cols-2">
          <Pane dark={false} />
          <Pane dark />
        </span>
      ) : (
        <Pane dark={t === 'dark'} />
      )}
    </span>
  );
}

/** Your account, design A "One simple card" (approved 3 Oct 2026): photo, display name, appearance. */
export function AccountCard({
  open,
  onClose,
  name,
  avatar,
  theme,
}: {
  open: boolean;
  onClose: () => void;
  name: string;
  avatar: string | null;
  theme: Theme;
}) {
  const router = useRouter();
  const [state, action] = useActionState<ProfileState, FormData>(saveProfile, {});
  const [t, setT] = useState<Theme>(theme);
  const [pic, setPic] = useState<string | null>(avatar);
  const [photo, setPhoto] = useState('keep');
  const [nm, setNm] = useState(name);
  const [err, setErr] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  // Fresh values every time it opens; Cancel puts the page back the way it was.
  useEffect(() => {
    if (!open) return;
    setT(theme);
    setPic(avatar);
    setPhoto('keep');
    setNm(name);
    setErr(null);
  }, [open, theme, avatar, name]);
  const close = () => {
    applyTheme(theme);
    onClose();
  };
  useEffect(() => {
    if (state.saved) {
      router.refresh();
      onClose();
    }
  }, [state.saved, router, onClose]);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  });
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4">
      <button
        type="button"
        aria-label="Close"
        onClick={close}
        className="absolute inset-0 h-full w-full cursor-default bg-ink-950/40 backdrop-blur-[2px] animate-[fadein_.15s_ease-out]"
      />
      <form
        action={action}
        role="dialog"
        aria-label="Your account"
        className="relative w-[min(420px,100%)] overflow-hidden rounded-3xl bg-white shadow-[0_40px_80px_-30px_rgba(11,22,41,0.55)]"
      >
        <input type="hidden" name="theme" value={t} />
        <input type="hidden" name="avatar" value={photo} />
        <header className="flex items-center px-6 pt-5">
          <h2 className="text-[17px] font-semibold">Your account</h2>
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="ml-auto grid h-8 w-8 place-items-center rounded-full text-ink-500 hover:bg-slate-100"
          >
            <X size={17} />
          </button>
        </header>
        <div className="grid gap-5 px-6 pb-6 pt-4">
          <div className="flex flex-col items-center gap-2">
            <button
              type="button"
              onClick={() => file.current?.click()}
              className="group relative rounded-full focus-visible:outline-2"
              aria-label="Change photo"
            >
              <Avatar name={nm || name} src={pic} size={84} />
              <span className="absolute -bottom-0.5 -right-0.5 grid h-8 w-8 place-items-center rounded-full bg-white text-ink-900 shadow-[0_2px_6px_rgba(11,22,41,0.25)] ring-1 ring-black/5 group-hover:bg-slate-50">
                <Camera size={15} />
              </span>
            </button>
            <input
              ref={file}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (!f) return;
                if (f.size > 8 * 1024 * 1024) return setErr('That photo is over 8 MB. Choose a smaller one.');
                try {
                  const d = await shrink(f);
                  setPic(d);
                  setPhoto(d);
                  setErr(null);
                } catch {
                  setErr('That file could not be read as a photo.');
                }
              }}
            />
            <div className="flex items-center gap-3 text-[12.5px]">
              <button
                type="button"
                onClick={() => file.current?.click()}
                className="font-semibold text-emerald-700 hover:underline"
              >
                {pic ? 'Change photo' : 'Upload photo'}
              </button>
              {pic && (
                <button
                  type="button"
                  onClick={() => {
                    setPic(null);
                    setPhoto('remove');
                  }}
                  className="inline-flex items-center gap-1 text-ink-500 hover:text-rose-700"
                >
                  <Trash2 size={13} /> Remove
                </button>
              )}
            </div>
            <span className="text-[11.5px] text-ink-300">
              JPG or PNG. Shown in the top bar and on messages you send.
            </span>
          </div>

          <label className="block">
            <span className="mb-1.5 block text-[12px] font-semibold text-ink-700">Display name</span>
            <input
              name="name"
              value={nm}
              onChange={(e) => setNm(e.target.value)}
              maxLength={80}
              required
              autoComplete="name"
              className="input py-2.5"
            />
          </label>

          <div>
            <span className="mb-1.5 block text-[12px] font-semibold text-ink-700">Appearance</span>
            <div className="grid grid-cols-3 gap-2.5">
              {THEMES.map((x) => {
                const on = t === x.key;
                const I = x.icon;
                return (
                  <button
                    key={x.key}
                    type="button"
                    aria-pressed={on}
                    onClick={() => {
                      setT(x.key);
                      applyTheme(x.key);
                    }}
                    className={`rounded-2xl p-1.5 text-left transition ${on ? 'ring-2 ring-emerald-500' : 'ring-1 ring-[#E1E5EC] hover:ring-[#C9D0DB]'}`}
                  >
                    <Preview t={x.key} />
                    <span className="mt-1.5 flex items-center gap-1.5 px-1 pb-0.5 text-[12.5px] font-semibold">
                      <I size={13} /> {x.label}
                      {on && <Check size={13} className="ml-auto text-emerald-600" strokeWidth={3} />}
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-[11.5px] text-ink-500">System follows your phone or computer.</p>
          </div>

          {(err || state.error) && <p className="text-[12.5px] text-rose-700">{err ?? state.error}</p>}
        </div>
        <footer className="flex items-center gap-2 border-t border-[#EEF1F6] bg-[#FAFBFC] px-6 py-3.5">
          <Link
            href="/account"
            onClick={close}
            className="mr-auto inline-flex items-center gap-1.5 text-[12.5px] font-medium text-ink-500 hover:text-ink-900"
          >
            <ShieldCheck size={14} /> Password &amp; devices
          </Link>
          <button type="button" onClick={close} className="btn-ghost px-3.5 py-2 text-[13px]">
            Cancel
          </button>
          <SubmitButton pendingText="Saving…" className="btn-primary px-4 py-2 text-[13px]">
            Save
          </SubmitButton>
        </footer>
      </form>
    </div>
  );
}
