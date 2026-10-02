'use client';
import { Check, FileSpreadsheet, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useActionState, useState, useTransition } from 'react';
import { type ExcelState, importExcel } from './actions';

function Btn({ children, primary, pending }: { children: React.ReactNode; primary?: boolean; pending: boolean }) {
  return (
    <button
      type="submit"
      disabled={pending}
      className={`inline-flex h-10 items-center gap-2 rounded-[10px] px-4 text-sm font-semibold disabled:opacity-60 ${primary ? 'bg-[#047857] text-white hover:bg-[#065F46]' : 'border border-[#E5E8EE] bg-white hover:bg-slate-50'}`}
    >
      {pending && <Loader2 size={15} className="animate-spin" />}
      {children}
    </button>
  );
}

/** Upload → check every row → import. The same file is sent twice: once to preview, once to confirm. */
export function ExcelImport() {
  const [state, action] = useActionState<ExcelState, FormData>(importExcel, {});
  const [file, setFile] = useState<File | null>(null);
  const [checked, setChecked] = useState<File | null>(null);
  const [pending, start] = useTransition();
  const name = file?.name ?? '';
  // The chosen file is kept here: the preview and the confirmation send the same file.
  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!file) return;
    const fd = new FormData();
    fd.set('file', file);
    if (state.rows && checked === file) fd.set('confirm', '1');
    else setChecked(file);
    start(() => action(fd));
  };
  if (state.done)
    return (
      <div className="flex flex-col items-start gap-2">
        <span className="inline-flex items-center gap-2 text-sm font-semibold text-[#047857]">
          <Check size={16} /> {state.done.created} members added
          {state.done.withAccess ? `, ${state.done.withAccess} with their paid access kept` : ''}
        </span>
        <Link href="/members" className="text-sm font-semibold text-ink-900 underline">
          See members
        </Link>
      </div>
    );
  const skipped = state.rows?.filter((r) => r.problem?.endsWith('skipped')).length ?? 0;
  const notes = state.rows?.filter((r) => r.problem && !r.problem.endsWith('skipped')).length ?? 0;
  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <label className="flex cursor-pointer items-center gap-3 rounded-xl border-[1.5px] border-dashed border-[#CBD5E1] bg-slate-50 px-4 py-4 hover:border-[#047857]">
        <FileSpreadsheet size={22} className="shrink-0 text-[#047857]" />
        <span className="min-w-0 flex-1">
          <b className="block truncate text-sm font-semibold">{name || 'Choose your Excel or CSV file'}</b>
          <small className="text-xs text-ink-500">.xlsx or .csv · first row = column headings</small>
        </span>
        <input
          type="file"
          accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null); // a different file is checked again before anything is added
          }}
          className="sr-only"
        />
      </label>
      {state.error && (
        <div className="rounded-[10px] bg-rose-50 px-3 py-2 text-[13px] text-rose-800 ring-1 ring-rose-200">
          {state.error}
        </div>
      )}
      {state.rows && checked === file ? (
        <>
          <div className="text-sm">
            <b>{state.ready}</b> ready to add
            {skipped ? <span className="text-rose-700"> · {skipped} skipped</span> : null}
            {notes ? <span className="text-amber-700"> · {notes} with a note</span> : null}
          </div>
          <ul className="max-h-80 divide-y divide-slate-100 overflow-auto rounded-xl border border-[#E7EBF3] text-[12.5px]">
            {state.rows.slice(0, 300).map((r) => {
              const skip = r.problem?.endsWith('skipped');
              return (
                <li key={r.line} className={`px-3 py-2 ${skip ? 'text-slate-400' : ''}`}>
                  <div className="flex justify-between gap-2">
                    <b className={`truncate font-semibold ${skip ? 'line-through' : ''}`}>
                      {r.first || '(no name)'} {r.last !== '—' ? r.last : ''}
                    </b>
                    <span className="shrink-0 font-mono text-[11.5px] text-ink-500">{r.no ?? 'new no.'}</span>
                  </div>
                  <div className="truncate text-ink-500">
                    {r.phone ?? 'no mobile'}
                    {r.until
                      ? ` · ${r.service} until ${new Date(r.until).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`
                      : ''}
                  </div>
                  {r.problem && (
                    <div className="text-amber-700">
                      Row {r.line}: {r.problem}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          <div className="flex gap-2">
            <Btn primary pending={pending}>
              Add {state.ready} members
            </Btn>
          </div>
        </>
      ) : (
        <div>
          <Btn pending={pending}>Check the file</Btn>
        </div>
      )}
    </form>
  );
}
