'use client';
import { Loader2 } from 'lucide-react';
import { useFormStatus } from 'react-dom';

/** Submit button that shows progress and blocks double clicks while its form's server action runs. */
export function SubmitButton({
  children,
  pendingText,
  className,
}: {
  children: React.ReactNode;
  pendingText: string;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} aria-busy={pending} className={`${className ?? ''} disabled:opacity-70`}>
      {pending ? (
        <>
          <Loader2 size={16} className="animate-spin" /> {pendingText}
        </>
      ) : (
        children
      )}
    </button>
  );
}
