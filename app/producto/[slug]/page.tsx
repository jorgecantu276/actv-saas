import { redirect } from 'next/navigation';
import { wordpressOrigin } from '@/lib/wordpress-origin';

export default async function ExistingProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  redirect(wordpressOrigin + '/producto/' + encodeURIComponent(slug) + '/');
}
