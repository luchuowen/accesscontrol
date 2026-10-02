import { redirect } from 'next/navigation';

/** Import now lives in a modal on the Members page. */
export default function ImportMembers() {
  redirect('/members');
}
