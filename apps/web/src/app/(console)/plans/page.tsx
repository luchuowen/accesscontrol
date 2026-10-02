import { redirect } from 'next/navigation';

/** Plans & pricing became Services (2 Oct 2026). Old links still land in the right place. */
export default function Plans() {
  redirect('/services');
}
