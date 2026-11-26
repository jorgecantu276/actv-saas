import type { ReactNode } from 'react';

export function PaymentAlert({ children }: { children: ReactNode }) {
  return <p role="alert" className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-900">{children}</p>;
}
