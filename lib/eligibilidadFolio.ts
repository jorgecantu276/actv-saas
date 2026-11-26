import { supabase } from './supabase';

export type PagoRegistrado = {
  actv_eligible?: boolean | null;
  monto_pagado: string;
};

export function puedeReimprimir(row: PagoRegistrado) {
  return row.actv_eligible !== false && row.monto_pagado !== 'WP / Online';
}

export function describePago(row: PagoRegistrado) {
  if (row.actv_eligible === false) return 'Folio no vigente · revisar pago';
  if (row.monto_pagado === 'WP / Online') return 'Importación histórica sin confirmar';
  return row.actv_eligible === true ? `$${row.monto_pagado} MXN` : `$${row.monto_pagado} MXN · registro histórico`;
}

export async function consultarPago(id: string): Promise<PagoRegistrado | null> {
  const { data, error } = await supabase.from('inscripciones').select('actv_eligible,monto_pagado').eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}
