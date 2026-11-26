'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import QRCode from 'react-qr-code';
import { loadSaleReceipt, receiptAmount, type SaleReceipt as Receipt } from '../lib/sale-receipt';

/** The same server-issued identity is reused by every screen and every copy. */
export default function SaleReceipt({ receipt, reprint = true, onClose }: {
  receipt: Receipt; reprint?: boolean; onClose: () => void;
}) {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const historical = receipt.payment_status !== 'confirmed';
  const title = historical ? 'COPIA HISTÓRICA · PAGO SIN VALIDAR' : reprint ? 'REIMPRESIÓN' : 'PAGO CONFIRMADO';
  const folios = receipt.participants.map(row => row.folio).join(', ');
  const requestPrint = async () => {
    setBusy(true);
    try {
      // Recheck scope, payment and unchanged issued identity immediately before print.
      const current = await loadSaleReceipt(receipt.order_id ? { p_order_id: receipt.order_id }
        : { p_registration_id: receipt.receipt_id });
      if (JSON.stringify(current) !== JSON.stringify(receipt)) {
        throw new Error('El recibo cambió. Cierra y vuelve a consultar la orden original.');
      }
      setMessage('Impresión solicitada; salida en papel sin confirmar. Puedes repetir este mismo recibo sin crear otra venta.');
      window.print();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'No fue posible consultar el recibo.'); }
    finally { setBusy(false); }
  };
  const share = () => {
    const text = `${title}\n${receipt.event_name}\n${receipt.participants.map(p => `${[p.name, p.surname].filter(Boolean).join(' ') || 'Nombre no registrado'}: ${p.folio}`).join('\n')}\n${receiptAmount(receipt)}\nRecibo: ${receipt.receipt_id}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer');
  };
  return createPortal(<>
    <style>{`
      #actv-sale-paper { display:none; }
      @media print {
        @page { margin:0; size:58mm auto; }
        html, body { margin:0!important; padding:0!important; background:white!important; }
        body > :not(#actv-sale-paper) { display:none!important; }
        #actv-sale-paper { display:block!important; width:58mm; padding:2mm; color:black; font:10pt 'Courier New',monospace; overflow-wrap:anywhere; }
        #actv-sale-paper p { margin:2mm 0; }
        #actv-sale-paper article + article { border-top:1px dashed black; margin-top:5mm; padding-top:5mm; }
        #actv-sale-paper article { break-inside:avoid; }
      }
    `}</style>
    <div className="fixed inset-0 z-[999999] flex items-center justify-center overflow-y-auto bg-slate-900/60 p-4 no-print">
      <div role="dialog" aria-modal="true" aria-label="Recibo de inscripción" className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
        <h2 className="text-xl font-bold">{title}</h2>
        <p>{receipt.event_name} · {receipt.event_date ?? 'Fecha desconocida'}</p>
        <p className="my-4 text-2xl font-black">{folios}</p>
        {receipt.participants.map(row => <p key={row.registration_id}>{[row.name, row.surname].filter(Boolean).join(' ') || 'Nombre no registrado'} · {row.package}{row.revision > 0 && ` · Corrección rev. ${row.revision}`}</p>)}
        <p className="my-3 font-bold">{receiptAmount(receipt)}</p>
        <p className="break-all text-xs">Recibo: {receipt.receipt_id}</p>
        {historical && <p className="my-2">La inscripción histórica conserva su folio. ACTV no tiene una captura que confirme este pago.</p>}
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={() => void requestPrint()} className="rounded bg-slate-900 px-4 py-3 text-white disabled:opacity-50">Solicitar impresión</button>
          <button type="button" onClick={share} className="rounded border px-4 py-3">WhatsApp</button>
          <button type="button" onClick={onClose} className="rounded border px-4 py-3">Cerrar</button>
        </div>
        <p role="status" className="mt-3 text-sm">{message || 'Dos copias de 58 mm: participante y organizador. La impresión no crea otra inscripción.'}</p>
      </div>
    </div>
    <div id="actv-sale-paper">
      {['PARTICIPANTE', 'ORGANIZADOR'].map(copy => <article key={copy}>
        {/* A bundled vector wordmark needs no remote image service. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/actv-wordmark.svg" width="160" height="54" alt="ACTV" style={{ margin: 'auto', display: 'block' }} />
        <p style={{ textAlign: 'center', fontWeight: 900 }}>{copy}<br />{title}</p>
        <p>Recibo: {receipt.receipt_id}</p>
        <p>Fecha: {receipt.issued_at ? new Date(receipt.issued_at).toLocaleString('es-MX') : 'Desconocida'}</p>
        <p>{receipt.event_name}<br />{receipt.event_date ?? 'Fecha del evento desconocida'}</p>
        {receipt.participants.map(row => <div key={row.registration_id} style={{ borderTop: '1px dashed black' }}>
          <p><strong>FOLIO: {row.folio}</strong><br />{[row.name, row.surname].filter(Boolean).join(' ') || 'Nombre no registrado'}<br />{row.package ?? 'Paquete no registrado'}</p>
          {row.revision > 0 && <p>Datos corregidos · revisión {row.revision}</p>}
          {row.provenance !== 'accepted_order' && <p style={{ fontSize: '8pt' }}>Datos históricos observados; aceptación original incompleta.</p>}
          <p>Talla: {row.shirt_size ?? '—'} · Club: {row.club ?? '—'}</p>
          <div style={{ textAlign: 'center' }}><QRCode value={row.folio} size={100} /></div>
        </div>)}
        <p>{historical ? 'IMPORTE HISTÓRICO:' : 'PAGO TOTAL:'} {receiptAmount(receipt)}</p>
        <p>Método: {receipt.channel ?? 'Desconocido'}<br />Cajero: {receipt.cashier_name ?? (receipt.cashier_id ? receipt.cashier_id : 'No registrado')}</p>
        <p style={{ fontSize: '8pt' }}>Consulta recibos fiscales y aclaraciones con ACTV. actv.mx</p>
        {copy === 'ORGANIZADOR' && <p style={{ marginTop: '10mm' }}>____________________<br />Firma de recepción</p>}
      </article>)}
    </div>
  </>, document.body);
}
