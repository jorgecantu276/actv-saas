import { redirect } from 'next/navigation';
import { wordpressOrigin } from '@/lib/wordpress-origin';

export default function ExistingStorePage() {
  redirect(wordpressOrigin + '/ajustes/orders/');
}
