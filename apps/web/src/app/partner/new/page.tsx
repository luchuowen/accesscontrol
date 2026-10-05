import { redirect } from 'next/navigation';

/** Old address of the Add a club page: the form is now a popup on the Clubs page. */
export default function NewClub() {
  redirect('/partner/clubs?add=1');
}
