import { redirect } from 'next/navigation';

/** Messages became Communications (inbox) and Settings › Messages (what gets sent). */
export default function Messages() {
  redirect('/communications');
}
