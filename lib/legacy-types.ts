/** View contracts used by the retained staff screens. These do not grant access:
 * authorization remains in the database/Edge contracts. */
export interface Athlete {
  id: string;
  nombre: string;
  apellido: string;
  fecha_nacimiento: string;
  club: string;
  genero: string;
  talla_playera: string;
  telefono: string;
  telefono_emergencia: string;
  ciudad: string;
  email: string;
  pr_5k: string;
  pr_10k: string;
  pr_21k: string;
  pr_42k: string;
  created_at: string;
  perfiles?: { nombre_completo: string } | null;
}

export interface RaceEvent {
  id: string;
  nombre_carrera: string;
  fecha: string;
  organizador: string;
  distancia: string;
  cupo_maximo: number;
  folio_inicial: number;
  imagen_evento: string;
  descripcion: string;
  nombre_precio_1: string;
  precio_1: number;
  nombre_precio_2: string;
  precio_2: number;
}

export interface Club {
  id: string;
  nombre: string;
  responsable1: string;
  telefono1: string;
  responsable2: string;
  telefono2: string;
  logo_url: string;
  facebook_url: string;
  instagram_url: string;
  web_url: string;
}

export interface StaffProfile {
  id: string;
  nombre_completo: string;
  telefono: string;
  email: string;
  rol: string;
  eventos_asignados: string[];
  eventos_assigned?: string[] | string;
}

export interface Registration {
  id: string;
  atleta_id: string;
  evento_id: string;
  folio_asignado: string;
  created_at: string;
  paquete_comprado: string;
  monto_pagado: string;
  actv_eligible: boolean | null;
  entry_allowed?: boolean;
  kit_entregado: boolean | null;
  foto_evidencia: string | null;
  asistencia?: boolean | null;
  atletas: ReceiptAthlete;
  eventos: Pick<RaceEvent, 'nombre_carrera' | 'fecha'>;
  perfiles?: { nombre_completo: string } | null;
}

export interface AthleteHistory {
  atleta: ReceiptAthlete;
  inscripciones: Registration[];
}

export interface Receipt {
  id_db?: string;
  order_id?: string;
  fecha_hora: string;
  evento_nombre?: string;
  evento_fecha?: string;
  paquete_comprado: string;
  monto_total: string | number | null;
  folios: string;
  folios_array: string[];
  corredores: string;
  atletas_data: ReceiptAthlete[];
  cajero?: string;
  cajero_original?: string | null;
  historico?: boolean;
  esReimpresion?: boolean;
  metodo_pago?: string;
}

export type ReceiptAthlete = Pick<Athlete, 'nombre' | 'apellido'> & Partial<Omit<Athlete, 'nombre' | 'apellido'>>;

export interface Client {
  id: string;
  nombre_completo: string;
  empresa_o_club: string;
  telefono: string;
  email: string;
}

export interface Service {
  id: string;
  nombre: string;
  precio_unitario: string;
  tipo_cobro: string;
}

export interface QuoteLine {
  id: string;
  nombre: string;
  precio_unitario: string | number;
  precio_aplicado?: string | number;
  tipo: string;
  total_linea: string | number;
}

export interface Quote {
  id: string;
  folio: string | number;
  created_at: string;
  nombre_evento: string;
  fecha_evento: string;
  asistentes_esperados: number;
  descuento: string | number;
  tipo_descuento: string;
  subtotal: string | number;
  iva: string | number;
  total: string | number;
  clientes: Client;
  desglose_servicios: QuoteLine[];
}

export interface StaffScreenProps {
  atletas: Athlete[];
  eventos: RaceEvent[];
  clubes: Club[];
  recargarDatos: () => void | Promise<void>;
  userRole: string | null;
  userId: string | null;
}
