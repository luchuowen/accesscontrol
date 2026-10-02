'use client';
import { Check, Copy } from 'lucide-react';
import { useState } from 'react';

/** Read-only value with a one-click copy button (e.g. a webhook URL to paste into a provider dashboard). */
export function CopyField({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard blocked: the field is selectable as a fallback */
    }
  };
  return (
    <div className="relative">
      <input
        readOnly
        value={value}
        aria-label={label}
        onFocus={(e) => e.currentTarget.select()}
        className="input bg-ink-50 pr-12 font-mono text-xs text-ink-700"
      />
      <button
        type="button"
        onClick={copy}
        aria-label={copied ? 'Copied' : `Copy ${label}`}
        title={copied ? 'Copied' : 'Copy'}
        className="absolute inset-y-0 right-0 grid w-11 place-items-center text-ink-500 hover:text-ink-900"
      >
        {copied ? <Check size={16} className="text-emerald-600" /> : <Copy size={16} />}
      </button>
    </div>
  );
}
