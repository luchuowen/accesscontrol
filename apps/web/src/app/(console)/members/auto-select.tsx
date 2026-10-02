'use client';

/** A filter select that applies itself on change (no extra Apply button). */
export function AutoSelect({
  name,
  value,
  label,
  options,
}: {
  name: string;
  value: string;
  label: string;
  options: [string, string][];
}) {
  return (
    <select
      name={name}
      defaultValue={value}
      aria-label={label}
      onChange={(e) => e.currentTarget.form?.requestSubmit()}
      className="h-10 rounded-[10px] border border-[#E5E8EE] bg-white px-3 text-[13px] text-ink-900"
    >
      {options.map(([v, l]) => (
        <option key={v || 'all'} value={v}>
          {l}
        </option>
      ))}
    </select>
  );
}
