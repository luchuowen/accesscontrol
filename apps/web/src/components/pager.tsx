import { ChevronLeft, ChevronRight } from 'lucide-react';
import Link from 'next/link';

/**
 * Table footer: "Showing 21–40 of 77", then Previous, page numbers (first, last and the pages around this one)
 * and Next. Links keep every other filter; `href(n)` builds the address of page n.
 */
export function Pager({
  page,
  per,
  total,
  noun,
  href,
}: {
  page: number;
  per: number;
  total: number;
  noun: string;
  href: (n: number) => string;
}) {
  const pages = Math.max(1, Math.ceil(total / per));
  const from = total ? (page - 1) * per + 1 : 0;
  const to = Math.min(total, page * per);
  const nums: (number | '…')[] = [];
  for (let n = 1; n <= pages; n++) {
    if (n === 1 || n === pages || Math.abs(n - page) <= 1) nums.push(n);
    else if (nums.at(-1) !== '…') nums.push('…');
  }
  const btn = 'inline-flex h-8 items-center gap-1 rounded-lg px-2.5 text-[12.5px] font-semibold';
  const off = `${btn} cursor-not-allowed text-ink-300`;
  const on = `${btn} text-ink-700 ring-1 ring-[#E5E8EE] hover:bg-slate-50`;
  return (
    <div className="flex flex-wrap items-center gap-3 border-t border-[#EEF1F6] px-4 py-3 print:hidden">
      <span className="mr-auto text-[12.5px] text-ink-500 tabular-nums">
        {total ? (
          <>
            Showing <b className="font-semibold text-ink-900">{from.toLocaleString('en-KE')}</b>–
            <b className="font-semibold text-ink-900">{to.toLocaleString('en-KE')}</b> of{' '}
            {total.toLocaleString('en-KE')} {noun}
          </>
        ) : (
          `No ${noun}`
        )}
      </span>
      {pages > 1 && (
        <nav aria-label="Pages" className="flex items-center gap-1">
          {page > 1 ? (
            <Link href={href(page - 1)} scroll={false} className={on}>
              <ChevronLeft size={15} /> Previous
            </Link>
          ) : (
            <span className={off}>
              <ChevronLeft size={15} /> Previous
            </span>
          )}
          <span className="hidden items-center gap-1 sm:flex">
            {nums.map((n, i) =>
              n === '…' ? (
                <span key={`gap${i}`} className="px-1 text-[12.5px] text-ink-300">
                  …
                </span>
              ) : (
                <Link
                  key={n}
                  href={href(n)}
                  scroll={false}
                  aria-current={n === page ? 'page' : undefined}
                  className={`grid h-8 min-w-8 place-items-center rounded-lg px-2 text-[12.5px] font-semibold tabular-nums ${n === page ? 'bg-ink-900 text-white' : 'text-ink-700 hover:bg-slate-50'}`}
                >
                  {n}
                </Link>
              ),
            )}
          </span>
          {page < pages ? (
            <Link href={href(page + 1)} scroll={false} className={on}>
              Next <ChevronRight size={15} />
            </Link>
          ) : (
            <span className={off}>
              Next <ChevronRight size={15} />
            </span>
          )}
        </nav>
      )}
    </div>
  );
}
