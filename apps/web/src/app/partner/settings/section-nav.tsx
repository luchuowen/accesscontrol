'use client';
import { useEffect, useState } from 'react';

export interface Section {
  id: string;
  label: string;
  /** done: green dot · todo: amber "!" · none: nothing */
  state: 'done' | 'todo' | 'none';
}

/** Sticky list of the page's sections; highlights the one in view. */
export function SectionNav({ sections, focus }: { sections: Section[]; focus?: string }) {
  const [active, setActive] = useState(focus ?? sections[0]?.id);
  useEffect(() => {
    const els = sections.map((s) => document.getElementById(s.id)).filter((e): e is HTMLElement => !!e);
    const io = new IntersectionObserver(
      (entries) => {
        const hit = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (hit) setActive(hit.target.id);
      },
      { rootMargin: '-15% 0px -70% 0px' },
    );
    for (const e of els) io.observe(e);
    // After a save, bring the section that was saved (and its notice) into view.
    const target = focus ?? (location.hash ? location.hash.slice(1) : undefined);
    if (target) {
      setActive(target);
      document.getElementById(target)?.scrollIntoView({ block: 'start' });
    }
    return () => io.disconnect();
  }, [sections, focus]);
  return (
    <nav className="sticky top-8 flex flex-col gap-0.5 self-start text-[13px]">
      {sections.map((s) => (
        <a
          key={s.id}
          href={`#${s.id}`}
          onClick={() => setActive(s.id)}
          className={`flex items-center justify-between rounded-lg px-3 py-2 transition ${active === s.id ? 'bg-white font-medium text-ink-900 shadow-sm ring-1 ring-[#E4E8EF]' : 'text-ink-500 hover:text-ink-900'}`}
        >
          {s.label}
          {s.state === 'done' && <span className="h-1.5 w-1.5 rounded-full bg-[#10B981]" aria-label="set up" />}
          {s.state === 'todo' && (
            <span
              className="grid h-4 w-4 place-items-center rounded-full bg-amber-100 text-[10px] font-semibold text-amber-800"
              aria-label="needs setup"
            >
              !
            </span>
          )}
        </a>
      ))}
    </nav>
  );
}
