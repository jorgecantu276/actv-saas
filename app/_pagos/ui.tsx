import type { ReactNode } from 'react';

export const paymentButton = 'rounded-lg bg-blue-700 px-5 py-3 text-sm font-semibold text-white hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:cursor-not-allowed disabled:opacity-50';
export const secondaryButton = 'rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:opacity-50';
export const paymentInput = 'mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-950 focus-visible:outline-2 focus-visible:outline-blue-700';

export function PaymentPage({ label, title, children }: { label: string; title: string; children: ReactNode }) {
  return (
    <main className="min-h-screen flex-1 bg-slate-100 px-5 pb-16 text-slate-950 sm:px-8">
      <header className="mx-auto flex max-w-3xl items-center justify-between gap-4 border-b border-slate-300 py-5">
        <span className="font-sans text-2xl font-black tracking-tighter text-blue-800">ACTV</span>
        <span className="text-sm font-medium text-slate-600">{label}</span>
      </header>
      <div className="mx-auto mt-10 max-w-3xl sm:mt-14">
        <h1 className="font-sans text-4xl font-bold tracking-tight sm:text-5xl">{title}</h1>
        {children}
      </div>
    </main>
  );
}

export function PaymentAlert({ children }: { children: ReactNode }) {
  return <p role="alert" className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-900">{children}</p>;
}
