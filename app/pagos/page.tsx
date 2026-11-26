import type { Metadata } from 'next';
import AdminPayments from '@/components/AdminPayments';

export const metadata: Metadata = { title: 'Pagos | ACTV' };

export default function PaymentsPage() {
  return <AdminPayments />;
}
