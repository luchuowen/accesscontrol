'use client';
import {
  ArrowLeft,
  ArrowRight,
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
  const [src, setSrc] = useState<'excel' | 'doors'>('excel');
  const [doors, setDoors] = useState<DoorsPreview | undefined>(undefined);
  const [doorState, doorAction] = useActionState<DoorsState, FormData>(importFromDoors, {});
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => onWide(step === 'preview'), [step, onWide]);
  useEffect(() => {
    doorsPreview()
      .then((p) => {
        setDoors(p);
        if (p && p.create > 0) setSrc('doors');
      })
      .catch(() => setDoors(null));
  }, []);
  useEffect(() => {
    if (!doorState.done) return;
    setSum({
      created: doorState.done.created,
      withAccess: doorState.done.withAccess,
      skipped: doorState.done.existing ?? 0,
    });
    setStep('summary');
  }, [doorState.done]);

  const load = async (f: File | undefined) => {
    if (!f) return;
    setReading(true);
    const fd = new FormData();
    fd.set('file', f);
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
      <div>
        <Title sub="Adding the members you checked." />
        <Stepper at={3} />
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
      </div>
    );
  if (step === 'summary')
    return (
      <div>
        <Title sub="Here is what changed." />
        <Stepper at={3} done />
        <div className="px-6 py-10 text-center">
          <span className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full bg-emerald-50 ring-1 ring-emerald-200">
            <CheckCircle2 size={28} className="text-[#047857]" />
          </span>
          <h2 className="text-[18px] font-semibold tracking-tight">
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
              <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">
                {src === 'doors' ? 'Already here' : 'Skipped'}
              </div>
              <div className="mt-1 text-[26px] font-semibold tabular-nums text-ink-700">{sum.skipped}</div>
            </div>
          </div>
        </div>
        <footer className="flex justify-end border-t border-[#EEF1F6] bg-[#FAFBFC] px-6 py-4">
          <button type="button" onClick={onClose} className="btn-primary">
            See members
          </button>
        </footer>
      </div>
    );

  const doorsOk = !!doors && doors.create > 0;
  return (
    <div>
      <Title sub="Bring in the members you already have. You can use both, one after the other." />
      <Stepper at={1} />
      <div className="grid gap-4 p-6 md:grid-cols-2">
        <Option
          on={src === 'doors'}
          disabled={!doorsOk}
          onPick={() => setSrc('doors')}
          icon={<MonitorSmartphone size={20} />}
          title="From the door system"
          sub="Everyone already set up in AxTraxNG."
          points={['Names and member numbers', 'Cards and wristbands', 'Current access dates']}
        >
          {doors === undefined ? (
            <span className="inline-flex items-center gap-2 text-[12.5px] text-ink-500">
              <Loader2 size={13} className="animate-spin" /> Checking the door system…
            </span>
          ) : doors === null ? (
            <span className="flex flex-col gap-1.5">
              <Pill tone="amber">Door PC not connected</Pill>
              <span className="text-[12px] text-ink-500">Your installer connects it under Doors &amp; access.</span>
            </span>
          ) : doors.create === 0 ? (
            <Pill tone="green">Everyone is already in Lango</Pill>
          ) : (
            <Pill tone="green">{doors.create} ready to bring in</Pill>
          )}
        </Option>
        <Option
          on={src === 'excel'}
          onPick={() => setSrc('excel')}
          icon={<FileSpreadsheet size={20} />}
          title="From a spreadsheet"
          sub="Excel or CSV, from another system or typed up from paper."
          points={['Name and mobile number', 'Member or card number (optional)', 'Paid until and service (optional)']}
        >
          <a
            href="/members/import/template"
            onClick={(e) => e.stopPropagation()}
            className="inline-flex w-fit items-center gap-1.5 text-[13px] font-semibold text-[#047857] hover:underline"
          >
            <Download size={14} /> Download the template (.xlsx)
          </a>
        </Option>
      </div>

      {src === 'excel' ? (
        <label
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            load(e.dataTransfer.files?.[0]);
          }}
          className="mx-6 mb-6 flex cursor-pointer items-center gap-4 rounded-2xl border-[1.5px] border-dashed border-[#CBD5E1] bg-slate-50 px-5 py-4 transition hover:border-[#047857]"
        >
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white text-ink-500 ring-1 ring-[#E5E8EE]">
            {reading ? <Loader2 size={20} className="animate-spin text-[#047857]" /> : <Upload size={20} />}
          </span>
          <span className="min-w-0 flex-1">
            <b className="block text-[14px] font-semibold">
              {reading ? 'Reading the file…' : 'Drop the spreadsheet here, or choose a file'}
            </b>
            <span className="text-[12.5px] text-ink-500">.xlsx or .csv · up to 3,000 rows</span>
          </span>
          <input
            ref={file}
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
      ) : (
        doors && (
          <div className="mx-6 mb-6 grid grid-cols-3 gap-3 rounded-2xl bg-slate-50 p-4">
            {[
              ['To add', doors.create],
              ['With access already', doors.withAccess],
              ['Already in Lango', doors.existing],
            ].map(([k, v]) => (
              <div key={k as string}>
                <div className="text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-500">{k}</div>
                <div className="mt-0.5 text-[22px] font-semibold tabular-nums">{v as number}</div>
              </div>
            ))}
            <p className="col-span-3 text-[12px] text-ink-500">
              Staff groups are left out. Anyone with no end date gets 14 days to pay, so nobody is locked out on the
              day.
            </p>
          </div>
        )
      )}
      {(read.error || doorState.error) && (
        <p className="mx-6 mb-4 rounded-[10px] bg-rose-50 px-3 py-2 text-[12.5px] text-rose-800 ring-1 ring-rose-200">
          {read.error ?? doorState.error}
        </p>
      )}

      <footer className="flex flex-wrap items-center gap-3 border-t border-[#EEF1F6] bg-[#FAFBFC] px-6 py-4">
        <span className="mr-auto text-[12.5px] text-ink-500">
          {src === 'excel'
            ? 'Nothing is saved until you have checked every row.'
            : 'You can still import a spreadsheet afterwards.'}
        </span>
        <button type="button" onClick={onClose} className="btn-ghost">
          Cancel
        </button>
        {src === 'excel' ? (
          <button type="button" disabled={reading} onClick={() => file.current?.click()} className="btn-primary">
            Choose file <ArrowRight size={15} />
          </button>
        ) : (
          <form action={doorAction}>
            <DoorsGo n={doors?.create ?? 0} />
          </form>
        )}
      </footer>
    </div>
  );
}

function Title({ sub }: { sub: string }) {
  return (
    <div className="px-6 pb-4 pt-6 pr-14">
      <h2 id="import-title" className="text-[19px] font-semibold tracking-tight">
        Import members
      </h2>
      <p className="mt-1 text-[13.5px] text-ink-500">{sub}</p>
    </div>
  );
}

/** Choose a source · Check the rows · Import. */
function Stepper({ at, done }: { at: 1 | 2 | 3; done?: boolean }) {
  const steps = ['Choose a source', 'Check the rows', 'Import'];
  return (
    <ol className="flex items-center gap-2 border-b border-[#EEF1F6] px-6 pb-4">
      {steps.map((l, i) => {
        const n = i + 1;
        const past = n < at || (done && n === at);
        const now = n === at && !done;
        return (
          <li key={l} className="flex flex-1 items-center gap-2 last:flex-none">
            <span
              className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11.5px] font-bold ${past ? 'bg-emerald-600 text-white' : now ? 'bg-ink-900 text-white' : 'text-ink-300 ring-[1.5px] ring-[#E5E8EE]'}`}
            >
              {past ? <Check size={13} strokeWidth={3} /> : n}
            </span>
            <span
              className={`whitespace-nowrap text-[12.5px] font-semibold ${now || past ? 'text-ink-900' : 'text-ink-300'}`}
            >
              {l}
            </span>
            {n < 3 && (
              <i className={`mx-1 hidden h-[1.5px] flex-1 sm:block ${past ? 'bg-emerald-500' : 'bg-[#E5E8EE]'}`} />
            )}
          </li>
        );
      })}
    </ol>
  );
}

function Pill({ tone, children }: { tone: 'amber' | 'green'; children: React.ReactNode }) {
  return (
    <span
      className={`inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-semibold ${tone === 'amber' ? 'bg-amber-50 text-amber-800' : 'bg-emerald-50 text-emerald-800'}`}
    >
      <i className={`h-1.5 w-1.5 rounded-full ${tone === 'amber' ? 'bg-amber-500' : 'bg-emerald-500'}`} />
      {children}
    </span>
  );
}

function Option({
  on,
  disabled,
  onPick,
  icon,
  title,
  sub,
  points,
  children,
}: {
  on: boolean;
  disabled?: boolean;
  onPick: () => void;
  icon: React.ReactNode;
  title: string;
  sub: string;
  points: string[];
  children: React.ReactNode;
}) {
  return (
    <div
      role="radio"
      aria-checked={on}
      aria-disabled={disabled}
      tabIndex={disabled ? -1 : 0}
      onClick={() => !disabled && onPick()}
      onKeyDown={(e) => !disabled && (e.key === 'Enter' || e.key === ' ') && onPick()}
      className={`relative flex flex-col gap-3 rounded-2xl p-5 text-left transition ${disabled ? 'cursor-default bg-slate-50/60 ring-1 ring-[#E7EBF3]' : on ? 'cursor-pointer bg-white ring-2 ring-ink-900 shadow-[0_8px_24px_-16px_rgba(11,22,41,0.45)]' : 'cursor-pointer bg-white ring-1 ring-[#E5E8EE] hover:ring-[#C9D0DB]'}`}
    >
      <span
        className={`absolute right-4 top-4 h-[18px] w-[18px] rounded-full ${on ? 'border-[5.5px] border-ink-900' : 'border-[1.5px] border-[#CBD5E1]'}`}
      />
      <span
        className={`grid h-11 w-11 place-items-center rounded-xl ${disabled ? 'bg-slate-100 text-ink-300' : 'bg-[#0B1629] text-[#34D399]'}`}
      >
        {icon}
      </span>
      <span className="pr-6">
        <b className={`block text-[15px] font-semibold ${disabled ? 'text-ink-500' : ''}`}>{title}</b>
        <span className="mt-0.5 block text-[13px] text-ink-500">{sub}</span>
      </span>
      <ul className="grid gap-1.5 text-[12.5px] text-ink-700">
        {points.map((x) => (
          <li key={x} className="flex items-center gap-2">
            <i className={`h-1.5 w-1.5 rounded-full ${disabled ? 'bg-ink-300' : 'bg-emerald-500'}`} />
            {x}
          </li>
        ))}
      </ul>
      <div className="mt-auto">{children}</div>
    </div>
  );
}

function DoorsGo({ n }: { n: number }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending || n === 0} className="btn-primary disabled:opacity-50">
      {pending && <Loader2 size={15} className="animate-spin" />}
      {pending ? 'Importing…' : `Import ${n} members`}
    </button>
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
      <div className="pt-5">
        <Stepper at={2} />
      </div>
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
