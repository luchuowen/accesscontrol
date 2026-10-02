'use client';
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Loader2,
  MonitorSmartphone,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useMemo, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import {
  type DoorsPreview,
  type DoorsState,
  doorsPreview,
  importDrafts,
  importFromDoors,
  type ReadState,
  readImportFile,
} from './actions';
import { checkDrafts, type Draft } from './rules';

/**
 * Import members modal (2 Oct 2026). Two ways in: the door system (one click) or Excel, which follows NAVAC CRM's
 * client import: upload → check every row in an editable table (fix or remove what's flagged) → import with
 * progress → summary of what was added and skipped.
 */
type Step = 'choose' | 'preview' | 'importing' | 'summary';
type Summary = { created: number; withAccess: number; skipped: number; error?: string };

export function ImportMembers({ variant = 'button' }: { variant?: 'button' | 'link' }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [key, setKey] = useState(0);
  const [wide, setWide] = useState(false);
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const open = () => {
    setKey((k) => k + 1);
    setWide(false);
    ref.current?.showModal();
  };
  const close = () => {
    if (busy) return;
    ref.current?.close();
    router.refresh();
  };
  return (
    <>
      {variant === 'button' ? (
        <button
          type="button"
          onClick={open}
          className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-[#E5E8EE] bg-white px-3.5 text-sm font-semibold text-ink-900 hover:bg-slate-50"
        >
          <Upload size={15} /> Import
        </button>
      ) : (
        <button type="button" onClick={open} className="font-semibold text-[#047857] hover:underline">
          Import them
        </button>
      )}
      <dialog
        ref={ref}
        aria-labelledby="import-title"
        onCancel={(e) => {
          if (busy) e.preventDefault();
        }}
        onClick={(e) => e.target === ref.current && close()}
        className={`m-auto w-full overflow-hidden rounded-[20px] bg-white p-0 text-ink-900 shadow-[0_30px_80px_-20px_rgba(11,22,41,0.55)] backdrop:bg-[#0B1629]/45 backdrop:backdrop-blur-[3px] open:animate-[pop_.28s_cubic-bezier(.2,.9,.3,1.2)] max-sm:mb-0 max-sm:max-w-none max-sm:rounded-b-none motion-reduce:open:animate-none ${wide ? 'max-w-[1120px]' : 'max-w-[760px]'}`}
      >
        <button
          type="button"
          onClick={close}
          aria-label="Close"
          className="absolute right-3 top-3 z-10 grid h-9 w-9 place-items-center rounded-[10px] text-ink-500 hover:bg-slate-100 hover:text-ink-900"
        >
          <X size={18} />
        </button>
        {key > 0 && <Flow key={key} onWide={setWide} onBusy={setBusy} onClose={close} />}
      </dialog>
    </>
  );
}

function Flow({
  onWide,
  onBusy,
  onClose,
}: {
  onWide: (w: boolean) => void;
  onBusy: (b: boolean) => void;
  onClose: () => void;
}) {
  const [step, setStep] = useState<Step>('choose');
  const [read, setRead] = useState<ReadState>({});
  const [rows, setRows] = useState<Draft[]>([]);
  const [reading, setReading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [sum, setSum] = useState<Summary>({ created: 0, withAccess: 0, skipped: 0 });

  useEffect(() => onWide(step === 'preview'), [step, onWide]);

  const load = async (file: File | undefined) => {
    if (!file) return;
    setReading(true);
    const fd = new FormData();
    fd.set('file', file);
    const r = await readImportFile(fd).catch(() => ({ error: 'Upload failed. Try again.' }) as ReadState);
    setReading(false);
    setRead(r);
    if (r.rows) {
      setRows(r.rows);
      setStep('preview');
    }
  };

  const run = async (ready: Draft[], skippedHere: number) => {
    setStep('importing');
    onBusy(true);
    const total: Summary = { created: 0, withAccess: 0, skipped: skippedHere };
    for (let i = 0; i < ready.length; i += 100) {
      const r = await importDrafts(ready.slice(i, i + 100), read.file ?? 'import').catch(() => null);
      if (!r || r.error) {
        total.error = r?.error ?? 'The connection dropped. Rows already added are kept; import the rest again.';
        break;
      }
      total.created += r.created;
      total.withAccess += r.withAccess;
      total.skipped += r.skipped;
      setProgress(Math.round(((i + 100) / ready.length) * 100));
    }
    onBusy(false);
    setSum(total);
    setStep('summary');
  };

  if (step === 'preview' && read.known)
    return (
      <Preview
        rows={rows}
        setRows={setRows}
        known={read.known}
        today={read.today ?? ''}
        file={read.file ?? ''}
        onBack={() => setStep('choose')}
        onImport={run}
      />
    );
  if (step === 'importing')
    return (
      <div className="flex flex-col items-center px-6 py-14 text-center">
        <Loader2 size={40} className="mb-5 animate-spin text-[#047857]" />
        <h2 className="text-[16px] font-semibold">
          {progress >= 100 ? 'Finishing up…' : `Adding members… ${Math.min(progress, 99)}%`}
        </h2>
        <div className="mt-4 h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-slate-100">
          <i
            className="block h-full rounded-full bg-[#047857] transition-all"
            style={{ width: `${Math.max(4, progress)}%` }}
          />
        </div>
        <p className="mt-3 text-[13px] text-ink-500">Keep this open until it’s done.</p>
      </div>
    );
  if (step === 'summary')
    return (
      <div className="px-6 py-10 text-center">
        <span className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full bg-emerald-50 ring-1 ring-emerald-200">
          <CheckCircle2 size={24} className="text-[#047857]" />
        </span>
        <h2 id="import-title" className="text-[18px] font-semibold tracking-tight">
          {sum.error ? 'Import stopped part way' : 'Import complete'}
        </h2>
        <p className="mx-auto mt-1 max-w-sm text-[13px] text-ink-500">
          {sum.error ??
            (sum.withAccess
              ? `${sum.withAccess} kept the access they had paid for. The doors update within a minute.`
              : 'New members can pay by M-Pesa with their member number.')}
        </p>
        <div className="mx-auto mt-6 grid max-w-sm grid-cols-2 gap-3">
          <div className="rounded-xl bg-slate-50 p-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">Members added</div>
            <div className="mt-1 text-[26px] font-semibold tabular-nums text-[#047857]">{sum.created}</div>
          </div>
          <div className="rounded-xl bg-slate-50 p-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">Skipped</div>
            <div className="mt-1 text-[26px] font-semibold tabular-nums text-ink-700">{sum.skipped}</div>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="mt-7 inline-flex h-11 items-center rounded-xl bg-[#0B1629] px-6 text-sm font-semibold text-white hover:bg-[#11284A]"
        >
          See members
        </button>
      </div>
    );

  return (
    <div className="p-6 sm:p-7">
      <h2 id="import-title" className="text-[19px] font-semibold tracking-tight">
        Import members
      </h2>
      <p className="mt-1 text-[13.5px] text-ink-500">Bring in the members you already have. You can use both.</p>
      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <Doors />
        <section className="flex flex-col gap-3 rounded-2xl border border-[#E7EBF3] p-5">
          <Head icon={<FileSpreadsheet size={18} />} title="From Excel" sub="Members in a spreadsheet or on paper." />
          <a
            href="/members/import/template"
            className="inline-flex w-fit items-center gap-1.5 text-[13px] font-semibold text-[#047857] hover:underline"
          >
            <Download size={14} /> Download the template
          </a>
          <label
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              load(e.dataTransfer.files?.[0]);
            }}
            className="flex cursor-pointer flex-col items-center rounded-xl border-[1.5px] border-dashed border-[#CBD5E1] bg-slate-50 px-4 py-6 text-center transition hover:border-[#047857]"
          >
            {reading ? (
              <Loader2 size={24} className="animate-spin text-[#047857]" />
            ) : (
              <Upload size={24} className="text-slate-400" />
            )}
            <b className="mt-2 text-[13.5px] font-semibold">{reading ? 'Reading the file…' : 'Drop your file here'}</b>
            <span className="mt-0.5 text-[12px] text-ink-500">or click to choose · .xlsx or .csv</span>
            <input
              type="file"
              accept=".xlsx,.csv"
              disabled={reading}
              onChange={(e) => {
                load(e.target.files?.[0]);
                e.target.value = '';
              }}
              className="sr-only"
            />
          </label>
          {read.error && (
            <p className="rounded-[10px] bg-rose-50 px-3 py-2 text-[12.5px] text-rose-800 ring-1 ring-rose-200">
              {read.error}
            </p>
          )}
          <p className="text-[12px] text-ink-500">You check every row before anything is added.</p>
        </section>
      </div>
    </div>
  );
}

function Head({ icon, title, sub }: { icon: React.ReactNode; title: string; sub: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#0B1629] text-[#34D399]">{icon}</span>
      <div>
        <h3 className="text-[15px] font-semibold tracking-tight">{title}</h3>
        <p className="mt-0.5 text-[12.5px] text-ink-500">{sub}</p>
      </div>
    </div>
  );
}

function DoorsGo({ n }: { n: number }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#047857] px-4 text-[13px] font-semibold text-white hover:bg-[#065F46] disabled:opacity-60"
    >
      {pending && <Loader2 size={15} className="animate-spin" />}
      {pending ? 'Importing…' : `Import ${n} members`}
    </button>
  );
}

function Doors() {
  const [p, setP] = useState<DoorsPreview | undefined>(undefined);
  const [state, action] = useActionState<DoorsState, FormData>(importFromDoors, {});
  useEffect(() => {
    doorsPreview()
      .then(setP)
      .catch(() => setP(null));
  }, []);
  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-[#E7EBF3] p-5">
      <Head
        icon={<MonitorSmartphone size={18} />}
        title="From the door system"
        sub="Already on AxTraxNG? Bring everyone in with their cards and access."
      />
      {state.done ? (
        <p className="inline-flex items-start gap-2 text-[13px] font-semibold text-[#047857]">
          <Check size={16} className="mt-0.5 shrink-0" />
          {state.done.created} added, {state.done.withAccess} with their access kept
          {state.done.existing ? ` · ${state.done.existing} were already here` : ''}
        </p>
      ) : p === undefined ? (
        <p className="inline-flex items-center gap-2 text-[13px] text-ink-500">
          <Loader2 size={14} className="animate-spin" /> Checking the door system…
        </p>
      ) : p === null ? (
        <p className="rounded-xl bg-amber-50 px-3 py-2.5 text-[12.5px] text-amber-900 ring-1 ring-amber-200">
          Connect the door PC first (Doors &amp; access). The people on it show here within a minute.
        </p>
      ) : p.create === 0 ? (
        <p className="text-[13px] text-[#047857]">Everyone in the door system is already in Lango.</p>
      ) : (
        <>
          <p className="text-[13px]">
            <b>{p.create}</b> to add{p.withAccess ? `, ${p.withAccess} with access they already have` : ''}
            {p.existing ? ` · ${p.existing} already here` : ''}. Staff groups are left out.
          </p>
          <form action={action}>
            <DoorsGo n={p.create} />
          </form>
          <p className="text-[12px] text-ink-500">
            Anyone with no end date gets 14 days to pay. Nobody is locked out on the day.
          </p>
        </>
      )}
      {state.error && <p className="text-[12.5px] text-rose-700">{state.error}</p>}
    </section>
  );
}

const cellCls =
  'h-9 w-full min-w-0 rounded-lg border border-transparent bg-transparent px-2 text-[13px] text-ink-900 outline-none transition hover:border-[#E5E8EE] focus:border-[#047857] focus:bg-white';

function Preview({
  rows,
  setRows,
  known,
  today,
  file,
  onBack,
  onImport,
}: {
  rows: Draft[];
  setRows: (r: Draft[]) => void;
  known: NonNullable<ReadState['known']>;
  today: string;
  file: string;
  onBack: () => void;
  onImport: (ready: Draft[], skipped: number) => void;
}) {
  const [onlyFix, setOnlyFix] = useState(false);
  const checks = useMemo(() => checkDrafts(rows, known, today), [rows, known, today]);
  const fix = checks.filter((c) => c.skip).length;
  const ready = rows.length - fix;
  const set = (i: number, patch: Partial<Draft>) => {
    const next = rows.slice();
    next[i] = { ...(next[i] as Draft), ...patch };
    setRows(next);
  };
  const shown = rows.map((r, i) => ({ r, i, c: checks[i] })).filter((x) => !onlyFix || x.c?.skip);
  return (
    <div className="flex max-h-[88vh] flex-col">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-[#EEF1F6] px-6 py-4 pr-14">
        <div className="min-w-0">
          <h2 id="import-title" className="text-[17px] font-semibold tracking-tight">
            Check before importing
          </h2>
          <p className="truncate text-[12.5px] text-ink-500">{file} · edit any cell, or remove rows you don’t want</p>
        </div>
        <div className="ml-auto flex items-center gap-2 text-[12.5px]">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 font-semibold text-emerald-800">
            <i className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            {ready} ready
          </span>
          {fix > 0 && (
            <button
              type="button"
              onClick={() => setOnlyFix((v) => !v)}
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-semibold ${onlyFix ? 'bg-amber-500 text-white' : 'bg-amber-50 text-amber-800 hover:bg-amber-100'}`}
            >
              <i className={`h-1.5 w-1.5 rounded-full ${onlyFix ? 'bg-white' : 'bg-amber-500'}`} />
              {fix} to fix
            </button>
          )}
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full min-w-[900px] border-separate border-spacing-0 text-left">
          <thead className="sticky top-0 z-[1] bg-white">
            <tr>
              {['Row', 'First name', 'Last name', 'Mobile', 'Member no.', 'Paid until', 'Service', ''].map((h) => (
                <th
                  key={h}
                  className="border-b border-[#EEF1F6] px-2 py-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500 first:pl-6 last:pr-6"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map(({ r, i, c }) => {
              const bad = !!c?.skip;
              return (
                <tr key={r.key} className={bad ? 'bg-amber-50/40' : ''}>
                  <td
                    className={`border-b border-l-[3px] border-b-[#F0F2F6] py-1.5 pl-5 pr-2 align-top text-[12px] tabular-nums text-ink-500 ${bad ? 'border-l-amber-500' : 'border-l-emerald-500'}`}
                  >
                    <div className="pt-2">{r.line}</div>
                  </td>
                  <td className="border-b border-[#F0F2F6] px-1 py-1.5 align-top">
                    <input
                      aria-label="First name"
                      value={r.first}
                      onChange={(e) => set(i, { first: e.target.value })}
                      className={cellCls}
                    />
                    {(c?.skip || !!c?.notes.length) && (
                      <p className={`px-2 pb-1 text-[11.5px] ${bad ? 'font-medium text-amber-800' : 'text-ink-500'}`}>
                        {c?.skip ?? c?.notes.join(' · ')}
                      </p>
                    )}
                  </td>
                  <td className="border-b border-[#F0F2F6] px-1 py-1.5 align-top">
                    <input
                      aria-label="Last name"
                      value={r.last}
                      onChange={(e) => set(i, { last: e.target.value })}
                      className={cellCls}
                    />
                  </td>
                  <td className="border-b border-[#F0F2F6] px-1 py-1.5 align-top">
                    <input
                      aria-label="Mobile"
                      value={r.phone}
                      inputMode="tel"
                      onChange={(e) => set(i, { phone: e.target.value })}
                      className={`${cellCls} tabular-nums`}
                    />
                  </td>
                  <td className="w-[110px] border-b border-[#F0F2F6] px-1 py-1.5 align-top">
                    <input
                      aria-label="Member number"
                      value={r.no}
                      inputMode="numeric"
                      placeholder="Next free"
                      onChange={(e) => set(i, { no: e.target.value.replace(/\D/g, '').slice(0, 5) })}
                      className={`${cellCls} tabular-nums placeholder:text-slate-400`}
                    />
                  </td>
                  <td className="w-[150px] border-b border-[#F0F2F6] px-1 py-1.5 align-top">
                    <input
                      aria-label="Paid until"
                      type="date"
                      value={r.until}
                      onChange={(e) => set(i, { until: e.target.value, badDate: undefined })}
                      className={cellCls}
                    />
                  </td>
                  <td className="w-[170px] border-b border-[#F0F2F6] px-1 py-1.5 align-top">
                    <select
                      aria-label="Service"
                      value={r.service}
                      onChange={(e) => set(i, { service: e.target.value })}
                      className={cellCls}
                    >
                      <option value="">—</option>
                      {r.service && !known.services.includes(r.service) && (
                        <option value={r.service}>{r.service} (not found)</option>
                      )}
                      {known.services.map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="w-12 border-b border-[#F0F2F6] py-1.5 pr-5 align-top">
                    <button
                      type="button"
                      aria-label={`Remove row ${r.line}`}
                      onClick={() => setRows(rows.filter((x) => x.key !== r.key))}
                      className="mt-0.5 grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                    >
                      <Trash2 size={15} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {shown.length === 0 && (
          <p className="px-6 py-10 text-center text-[13px] text-ink-500">
            {rows.length ? 'Nothing left to fix.' : 'No rows left.'}
          </p>
        )}
      </div>
      <footer className="flex flex-wrap items-center gap-3 border-t border-[#EEF1F6] px-6 py-4">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-[#E5E8EE] px-3.5 text-[13px] font-semibold hover:bg-slate-50"
        >
          <ArrowLeft size={15} /> Choose another file
        </button>
        <span className="ml-auto text-[12.5px] text-ink-500">
          {fix ? `${fix} row${fix === 1 ? '' : 's'} to fix will be skipped` : 'All rows ready'}
        </span>
        <button
          type="button"
          disabled={!ready}
          onClick={() =>
            onImport(
              rows.filter((_, i) => !checks[i]?.skip),
              fix,
            )
          }
          className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#047857] px-4 text-[13px] font-semibold text-white hover:bg-[#065F46] disabled:opacity-50"
        >
          <Upload size={15} /> Import {ready} member{ready === 1 ? '' : 's'}
        </button>
      </footer>
    </div>
  );
}
