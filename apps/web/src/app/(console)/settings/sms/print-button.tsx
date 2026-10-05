'use client';
import { Download } from 'lucide-react';

/** Opens the print dialog; the receipt prints as one clean A4 page, so "Save as PDF" there gives the PDF. */
export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      title="Print or save as PDF"
      className="btn-primary h-10 px-4 print:hidden"
    >
      <Download size={16} /> Save PDF
    </button>
  );
}
