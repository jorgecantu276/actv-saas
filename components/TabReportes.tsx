'use client';


import { useClientReady } from '../lib/use-client-ready';
import type { Registration, AthleteHistory, StaffScreenProps } from '../lib/legacy-types';
import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { createPortal } from 'react-dom';
import { supabase } from '../lib/supabase';
import SaleReceipt from './SaleReceipt';
import { loadSaleReceipt, type SaleReceipt as SaleReceiptData } from '../lib/sale-receipt';
import { Search, Download, UserCheck, ArrowUpDown, X, FileSpreadsheet, ShieldAlert, Printer, ChevronLeft, ChevronRight, ChevronDown, History, Calendar } from 'lucide-react';
import ConciliacionCobros from './ConciliacionCobros';
import { describePago, puedeReimprimir } from '../lib/eligibilidadFolio';

// ✅ FUNCIÓN: Capitaliza la primera letra de cada palabra
const capitalizarNombres = (texto: string | null | undefined) => {
  if (!texto) return '';
  return texto
    .toLowerCase()
    .split(' ')
    .map(palabra => palabra.charAt(0).toUpperCase() + palabra.slice(1))
    .join(' ');
};



const calcularEdadNumero = (fechaNacimiento: string | undefined, fechaEvento: string | undefined) => {
  if (!fechaNacimiento || !fechaEvento) return null;
  const nac = new Date(fechaNacimiento);
  const ev = new Date(fechaEvento);
  let edad = ev.getFullYear() - nac.getFullYear();
  const m = ev.getMonth() - nac.getMonth();
  if (m < 0 || (m === 0 && ev.getDate() < nac.getDate())) {
    edad--;
  }
  return isNaN(edad) ? null : edad;
};

const obtenerCategoria = (edad: number | null) => {
  if (edad === null) return 'Sin categoría';
  if (edad <= 19) return '19 y menores';
  if (edad <= 29) return '20 a 29';
  if (edad <= 39) return '30 a 39';
  if (edad <= 49) return '40 a 49';
  if (edad <= 59) return '50 a 59';
  if (edad <= 69) return '60 a 69';
  return '70 y más';
};

export default function TabReportes({ eventos, userRole }: Pick<StaffScreenProps, 'eventos' | 'userRole' | 'userId'>) {
  const isMounted = useClientReady();

  const [inscripciones, setInscripciones] = useState<Registration[]>([]);
  const [serverTotal, setServerTotal] = useState(0);
  const [loadError, setLoadError] = useState('');
  const [exporting, setExporting] = useState(false);

  const [filtroEvento, setFiltroEvento] = useState('');
  const [busqueda, setBusqueda] = useState('');
  const [orden, setOrden] = useState('fecha_desc');
  const [cargando, setCargando] = useState(true);
  const [misEventosPermitidos, setMisEventosPermitidos] = useState<string[]>([]);

  const [paginaActual, setPaginaActual] = useState(1);
  const inscripcionesPorPagina = 25;
  const cambiarBusqueda = (value: string) => { setBusqueda(value); setPaginaActual(1); };
  const cambiarFiltroEvento = (value: string) => { setFiltroEvento(value); setPaginaActual(1); };
  const cambiarOrden = (value: string) => { setOrden(value); setPaginaActual(1); };

  // ESTADOS PARA EL HISTORIAL DEL ATLETA
  const [atletaHistorial, setAtletaHistorial] = useState<AthleteHistory | null>(null);
  const [ordenHistorial, setOrdenHistorial] = useState('reciente');


  const [ticketReciente, setTicketReciente] = useState<SaleReceiptData | null>(null);

  const eventId = filtroEvento || eventos[0]?.id || '';
  const consultarDatosSeguros = useCallback(async (offset = 0, limit = 25) => {
    if (!eventId) return { rows: [] as Registration[], total: 0 };
    const { data, error } = await supabase.rpc('actv_operations_roster', {
      p_event_id: eventId, p_query: busqueda, p_offset: offset, p_limit: limit, p_sort: orden,
    });
    if (error) throw new Error(error.message);
    return data as { rows: Registration[]; total: number };
  }, [eventId, busqueda, orden]);
  useEffect(() => {
    let active = true;
    void consultarDatosSeguros((paginaActual - 1) * inscripcionesPorPagina).then(data => {
      if (!active) return;
      setInscripciones(data.rows); setServerTotal(data.total); setLoadError('');
      setMisEventosPermitidos(eventos.map(event => event.id)); setCargando(false);
    }).catch(error => { if (active) { setInscripciones([]); setServerTotal(0); setLoadError(error.message); setCargando(false); } });
    return () => { active = false; };
  }, [consultarDatosSeguros, paginaActual, eventos]);
  const inscritosProcesados = inscripciones;
  const totalPaginas = Math.ceil(serverTotal / inscripcionesPorPagina);
  const indexUltimaInscripcion = paginaActual * inscripcionesPorPagina;
  const indexPrimeraInscripcion = indexUltimaInscripcion - inscripcionesPorPagina;
  const inscritosPaginados = inscritosProcesados;
  const exportRows = async () => {
    const rows: Registration[] = [];
    for (let offset = 0;; offset += 100) {
      const page = await consultarDatosSeguros(offset, 100);
      rows.push(...page.rows);
      if (rows.length >= page.total || !page.rows.length) return rows;
    }
  };

  // LOGICA PARA EL HISTORIAL DEL ATLETA
  const verHistorial = async (atletaId: string) => {
    try {
      const historial: Registration[] = [];
      for (let offset = 0;; offset += 100) {
        const { data, error } = await supabase.rpc('actv_operations_history', { p_athlete_id: atletaId, p_offset: offset, p_limit: 100 });
        if (error) throw error;
        const page = data as { rows: Registration[]; total: number };
        historial.push(...page.rows);
        if (historial.length >= page.total || !page.rows.length) break;
      }
      if (historial.length) { setAtletaHistorial({ atleta: historial[0].atletas, inscripciones: historial }); setOrdenHistorial('reciente'); }
    } catch (error) { alert(String((error as { message?: string }).message ?? 'No fue posible consultar el historial.')); }
  };

  const historialProcesado = atletaHistorial ? [...atletaHistorial.inscripciones] : [];
  historialProcesado.sort((a, b) => {
    if (ordenHistorial === 'reciente') return new Date(b.eventos?.fecha || 0).getTime() - new Date(a.eventos?.fecha || 0).getTime();
    if (ordenHistorial === 'antiguo') return new Date(a.eventos?.fecha || 0).getTime() - new Date(b.eventos?.fecha || 0).getTime();
    if (ordenHistorial === 'az') return (a.eventos?.nombre_carrera || '').localeCompare(b.eventos?.nombre_carrera || '');
    if (ordenHistorial === 'za') return (b.eventos?.nombre_carrera || '').localeCompare(a.eventos?.nombre_carrera || '');
    return 0;
  });

  // =======================================================
  // EXPORTAR A CSV (Capitalizado y Nombres Separados)
  // =======================================================
  const exportReport = async (format: 'csv' | 'xls') => {
    if (exporting) return;
    setExporting(true);
    try {
      const data = await exportRows();
      const headers = ['Folio', 'Fecha de Registro', 'Nombres', 'Apellidos', 'Fecha de Nacimiento', 'Edad al Evento', 'Categoría', 'Teléfono', 'Emergencia', 'Club/Equipo', 'Ciudad', 'Género', 'Talla', 'Paquete', 'Cajero', 'Importe registrado', 'Estado del pago', 'Carrera'];
      const rows = data.map(i => {
        const age = calcularEdadNumero(i.atletas?.fecha_nacimiento, i.eventos?.fecha);
        return [i.folio_asignado, new Date(i.created_at).toLocaleDateString('es-MX'), capitalizarNombres(i.atletas?.nombre), capitalizarNombres(i.atletas?.apellido),
          i.atletas?.fecha_nacimiento ?? 'N/A', age ?? 'N/A', obtenerCategoria(age), i.atletas?.telefono ?? '', i.atletas?.telefono_emergencia ?? '',
          i.atletas?.club ?? '', i.atletas?.ciudad ?? '', i.atletas?.genero ?? '', i.atletas?.talla_playera ?? '', i.paquete_comprado ?? '',
          i.perfiles?.nombre_completo ?? 'No registrado', i.monto_pagado ?? '', i.actv_eligible === null ? 'Histórico sin validar' : i.actv_eligible ? 'Vigente' : 'No vigente', i.eventos?.nombre_carrera ?? ''];
      });
      const text = (value: unknown) => String(value ?? '');
      const cell = (value: unknown) => { const raw = text(value); return /^[=+@-]/.test(raw) ? "'" + raw : raw; };
      const csv = [headers, ...rows].map(row => row.map(value => '"' + cell(value).replaceAll('"', '""') + '"').join(',')).join('\n');
      const html = (value: unknown) => cell(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
      const table = '<html><head><meta charset="utf-8" /></head><body><table><tr>' + headers.map(value => '<th>' + html(value) + '</th>').join('') + '</tr>' + rows.map(row => '<tr>' + row.map(value => '<td>' + html(value) + '</td>').join('') + '</tr>').join('') + '</table></body></html>';
      const blob = new Blob(['\uFEFF' + (format === 'csv' ? csv : table)], { type: format === 'csv' ? 'text/csv;charset=utf-8;' : 'application/vnd.ms-excel;charset=utf-8;' });
      const url = URL.createObjectURL(blob), link = document.createElement('a');
      link.href = url; link.download = 'Reporte_ACTV_' + Date.now() + '.' + format;
      document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
    } catch (error) { alert(error instanceof Error ? error.message : 'No se pudo exportar.'); }
    finally { setExporting(false); }
  };
  const exportarCSV = () => exportReport('csv');
  const exportarXLSX = () => exportReport('xls');

  const reimprimirTicket = async (inscripcion: Registration) => {
    try {
      setTicketReciente(await loadSaleReceipt({ p_registration_id: inscripcion.id }));
    } catch (error) { alert(error instanceof Error ? error.message : 'Recibo no disponible.'); }
  };



  const eventosDropdown = userRole === 'Moderador'
    ? eventos.filter((ev) => misEventosPermitidos.includes(ev.id))
    : eventos;

  return (
    <section className="animate-in fade-in slide-in-from-bottom-2 duration-500 space-y-8">



      <Link href="/pagos" className="no-print inline-flex w-fit items-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white">
        Abrir espacio de pagos
      </Link>
      {userRole === 'Administrador' && <ConciliacionCobros canMatch />}

      {loadError && <p role="alert" className="rounded-xl bg-red-50 p-4 text-red-800">{loadError}</p>}
      {exporting && <p role="status">Preparando todas las páginas de la exportación…</p>}
      {/* CABECERA ENTERPRISE */}
      <div className="bg-white p-6 md:p-8 rounded-3xl shadow-sm ring-1 ring-slate-200 no-print">
        <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-6">
          <div>
            <h2 className="text-xl font-black text-slate-900 tracking-tight flex items-center">
              <UserCheck className="mr-2.5 text-blue-600 w-6 h-6" /> Centro de Reportes
            </h2>
            <p className="text-xs font-medium text-slate-500 mt-1">Consulta por páginas las inscripciones de esta carrera. La exportación recorre todas las páginas de la búsqueda.</p>
          </div>

          <div className="flex flex-wrap gap-3 w-full xl:w-auto">
            {(userRole === 'Administrador' || userRole === 'Moderador') && (
              <>
                <button disabled={exporting} onClick={() => void exportarCSV()} className="flex-1 md:flex-none text-xs font-bold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 px-4 py-2.5 rounded-xl transition-all flex items-center justify-center shadow-sm">
                  <Download className="w-4 h-4 mr-2 text-green-600" /> Exportar CSV
                </button>
                <button disabled={exporting} onClick={() => void exportarXLSX()} className="flex-1 md:flex-none text-xs font-bold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 px-4 py-2.5 rounded-xl transition-all flex items-center justify-center shadow-sm">
                  <FileSpreadsheet className="w-4 h-4 mr-2 text-indigo-600" /> Exportar Excel
                </button>
              </>
            )}
          </div>
        </div>

        {/* FILTROS */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-8">
          <div className="relative group">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 group-focus-within:text-slate-900 transition-colors" />
            <input
              type="text"
              placeholder="Buscar nombre o folio..."
              className="w-full bg-slate-50 border border-slate-200 p-3 pl-11 rounded-xl outline-none text-sm focus:border-slate-400 focus:ring-4 focus:ring-slate-900/5 transition-all text-slate-900 placeholder:text-slate-400 font-medium"
              value={busqueda}
              onChange={(e) => cambiarBusqueda(e.target.value)}
            />
          </div>

          <div className="relative">
            <select
              className="w-full bg-slate-50 border border-slate-200 p-3 px-4 rounded-xl outline-none text-sm text-slate-900 font-bold appearance-none cursor-pointer focus:border-slate-400 transition-all"
              value={filtroEvento}
              onChange={(e) => cambiarFiltroEvento(e.target.value)}
            >
              <option value="">{userRole === 'Moderador' ? 'Mis Carreras Asignadas' : 'Todas las carreras'}</option>
              {eventosDropdown.map((ev) => <option key={ev.id} value={ev.id}>{ev.nombre_carrera}</option>)}
            </select>
            <ChevronDown className="absolute right-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
          </div>

          <div className="relative">
            <ArrowUpDown className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
            <select
              className="w-full bg-slate-50 border border-slate-200 p-3 pl-11 rounded-xl outline-none text-sm text-slate-900 font-bold appearance-none cursor-pointer focus:border-slate-400 transition-all"
              value={orden}
              onChange={(e) => cambiarOrden(e.target.value)}
            >
              <option value="fecha_desc">Registro (Más recientes)</option>
              <option value="fecha_asc">Registro (Más antiguos)</option>
              <option value="folio_asc">Folio (Menor a Mayor)</option>
              <option value="nombre_asc">Nombre (A - Z)</option>
            </select>
            <ChevronDown className="absolute right-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
          </div>
        </div>
      </div>

      {userRole === 'Moderador' && misEventosPermitidos.length === 0 && (
        <div className="mb-6 bg-amber-50 border border-amber-200 text-amber-800 p-5 rounded-2xl flex items-center shadow-sm no-print">
          <ShieldAlert className="w-5 h-5 mr-3 text-amber-500 flex-shrink-0"/>
          <p className="text-sm font-bold">No tienes ninguna carrera asignada. Contacta a un administrador para que te otorgue permisos de visualización.</p>
        </div>
      )}

      {cargando ? (
        <div className="py-20 text-center text-slate-400 font-bold tracking-widest uppercase text-xs">Cargando reportes...</div>
      ) : (
        <>
          {/* TABLA ESTILO ENTERPRISE */}
          <div className="bg-white rounded-3xl ring-1 ring-slate-200 overflow-hidden shadow-sm no-print">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm min-w-[1400px]">
                <thead>
                  <tr className="bg-slate-50/50 border-b border-slate-100">
                    <th className="px-6 py-4 font-bold text-slate-400 uppercase text-[10px] tracking-widest">Fecha</th>
                    <th className="px-6 py-4 font-bold text-slate-400 uppercase text-[10px] tracking-widest">Folio</th>
                    <th className="px-6 py-4 font-bold text-slate-400 uppercase text-[10px] tracking-widest">Corredor / Carrera</th>
                    <th className="px-6 py-4 font-bold text-slate-400 uppercase text-[10px] tracking-widest">Edad / Cat.</th>
                    <th className="px-6 py-4 font-bold text-slate-400 uppercase text-[10px] tracking-widest">Club</th>
                    <th className="px-6 py-4 font-bold text-slate-400 uppercase text-[10px] tracking-widest">Contacto</th>
                    <th className="px-6 py-4 font-bold text-slate-400 uppercase text-[10px] tracking-widest">Talla / Gen</th>
                    <th className="px-6 py-4 font-bold text-slate-400 uppercase text-[10px] tracking-widest">Paquete / Pago</th>
                    <th className="px-6 py-4 font-bold text-slate-400 uppercase text-[10px] tracking-widest">Cajero</th>
                    <th className="px-6 py-4 font-bold text-slate-400 uppercase text-[10px] tracking-widest text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {inscritosPaginados.map((i) => {
                    const edadNumerica = calcularEdadNumero(i.atletas?.fecha_nacimiento, i.eventos?.fecha);
                    const categoriaTxt = obtenerCategoria(edadNumerica);
                    const isMujer = i.atletas?.genero === 'Mujer';
                    const colorCategoria = isMujer ? '#e75488' : '#0767ff';

                    return (
                    <tr key={i.id} className="hover:bg-slate-50/80 transition-colors group">
                      <td className="px-6 py-4 text-slate-500 font-medium">{new Date(i.created_at).toLocaleDateString('es-MX')}</td>
                      <td className="px-6 py-4 font-black text-red-600 text-base">{i.folio_asignado}</td>
                      <td className="px-6 py-4">
                        <button
                          onClick={() => verHistorial(i.atleta_id)}
                          className="font-bold text-blue-600 hover:text-blue-800 hover:underline tracking-tight text-left transition-all focus:outline-none"
                        >
                          {capitalizarNombres(i.atletas?.nombre)} {capitalizarNombres(i.atletas?.apellido)}
                        </button>
                        <p className="text-[10px] text-slate-500 font-medium mt-0.5 line-clamp-1">{i.eventos?.nombre_carrera}</p>
                      </td>

                      <td className="px-6 py-4">
                        <p className="font-black text-slate-700">{edadNumerica !== null ? `${edadNumerica} años` : 'N/A'}</p>
                        <span style={{ backgroundColor: colorCategoria }} className="inline-block text-[9px] text-white px-2 py-0.5 mt-1 rounded-md font-bold uppercase tracking-wider shadow-sm">
                          {categoriaTxt}
                        </span>
                      </td>

                      <td className="px-6 py-4 text-slate-700 font-bold">{i.atletas?.club || 'Libre'}</td>
                      <td className="px-6 py-4 text-slate-600 font-medium">
                        {i.atletas?.telefono || '-'}
                        <span className="block text-[9px] text-red-500 font-bold uppercase mt-1">Emer: {i.atletas?.telefono_emergencia || '-'}</span>
                      </td>
                      <td className="px-6 py-4">
                        <p className="font-bold text-slate-900">{i.atletas?.talla_playera || '-'}</p>
                        <p className="text-[10px] text-slate-400 mt-1 uppercase">{i.atletas?.genero || '-'}</p>
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-slate-700 font-medium block line-clamp-1">{i.paquete_comprado}</span>
                        <span className="text-[10px] text-slate-600 font-black mt-1 block">{describePago(i)}</span>
                      </td>

                      <td className="px-6 py-4 text-[10px] font-black text-slate-500 uppercase">
                        {i.monto_pagado === 'WP / Online' ? <span className="text-blue-600 bg-blue-50 px-2 py-1 rounded">WordPress</span> : (i.perfiles?.nombre_completo || 'Sistema Web')}
                      </td>

                      <td className="px-6 py-4 text-right">
                        <div className="flex justify-end gap-2 opacity-100 lg:opacity-0 group-hover:opacity-100 transition-opacity">
                          <button disabled={!puedeReimprimir(i)} onClick={() => reimprimirTicket(i)} className="p-2 bg-white border border-slate-200 text-slate-600 rounded-xl hover:bg-slate-50 hover:text-slate-900 hover:border-slate-300 transition-all shadow-sm disabled:opacity-40" title="Reimprimir">
                            <Printer className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )})}
                </tbody>
              </table>
            </div>
            {inscritosProcesados.length === 0 && (
              <div className="p-20 text-center">
                <UserCheck className="w-12 h-12 text-slate-200 mx-auto mb-4" />
                <p className="text-slate-400 font-bold tracking-tight">No hay registros que coincidan con tu búsqueda.</p>
              </div>
            )}
          </div>

          {/* PAGINACIÓN */}
          {inscritosProcesados.length > 0 && (
            <div className="flex flex-col sm:flex-row justify-between items-center bg-white p-5 rounded-3xl ring-1 ring-slate-200 shadow-sm gap-4 no-print mt-6">
              <p className="text-xs text-slate-500 font-bold">
                Mostrando <span className="text-slate-900">{indexPrimeraInscripcion + 1}</span> a <span className="text-slate-900">{Math.min(indexUltimaInscripcion, serverTotal)}</span> de <span className="text-blue-600">{serverTotal}</span> inscripciones
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPaginaActual(prev => Math.max(prev - 1, 1))}
                  disabled={paginaActual === 1}
                  className="p-2.5 bg-white border border-slate-200 rounded-xl text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-sm"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>

                <div className="flex items-center bg-slate-50 border border-slate-200 rounded-xl px-3 py-1 text-[11px] font-black text-slate-700 tracking-widest uppercase">
                  <span className="mr-2">Página</span>
                  <div className="relative">
                    <select
                      value={paginaActual}
                      onChange={(e) => setPaginaActual(Number(e.target.value))}
                      className="bg-white border border-slate-200 rounded-lg py-1.5 pl-3 pr-7 outline-none text-xs font-bold text-slate-900 appearance-none cursor-pointer focus:border-slate-400 shadow-sm"
                    >
                      {Array.from({ length: totalPaginas }, (_, i) => (
                        <option key={i + 1} value={i + 1}>{i + 1}</option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-3 w-3 text-slate-400 pointer-events-none" />
                  </div>
                  <span className="ml-2">/ {totalPaginas}</span>
                </div>

                <button
                  onClick={() => setPaginaActual(prev => Math.min(prev + 1, totalPaginas))}
                  disabled={paginaActual === totalPaginas}
                  className="p-2.5 bg-white border border-slate-200 rounded-xl text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-sm"
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* ✅ MODAL: HISTORIAL DEL ATLETA */}
      {isMounted && atletaHistorial && createPortal(
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-[99999] p-4 sm:p-6 no-print overflow-y-auto">
          <div className="bg-white rounded-[32px] p-6 sm:p-8 max-w-md w-full shadow-2xl relative animate-in zoom-in-95 duration-200 my-auto max-h-[90vh] overflow-y-auto custom-scrollbar flex flex-col">

            <button type="button" onClick={() => setAtletaHistorial(null)} className="absolute top-5 right-5 sm:top-6 sm:right-6 text-slate-400 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-full p-2 transition-all z-20"><X size={20}/></button>

            <div className="mb-6 pr-8 flex-shrink-0">
              <div className="bg-indigo-50 w-12 h-12 rounded-2xl flex items-center justify-center mb-4 border border-indigo-100">
                <History className="w-6 h-6 text-indigo-600"/>
              </div>
              <h3 className="text-xl font-black text-slate-900 tracking-tight leading-none">Historial de Carreras</h3>
              <p className="text-sm font-bold text-indigo-600 mt-2">{capitalizarNombres(atletaHistorial.atleta.nombre)} {capitalizarNombres(atletaHistorial.atleta.apellido)}</p>
            </div>

            <div className="mb-4 flex-shrink-0">
              <div className="relative">
                <ArrowUpDown className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
                <select
                  className="w-full bg-slate-50 border border-slate-200 p-3 pl-11 rounded-xl outline-none text-sm text-slate-900 font-bold appearance-none cursor-pointer focus:border-slate-400 transition-all"
                  value={ordenHistorial}
                  onChange={(e) => setOrdenHistorial(e.target.value)}
                >
                  <option value="reciente">Más recientes primero</option>
                  <option value="antiguo">Más antiguas primero</option>
                  <option value="az">A - Z (Por nombre de carrera)</option>
                  <option value="za">Z - A (Por nombre de carrera)</option>
                </select>
                <ChevronDown className="absolute right-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
              </div>
            </div>

            {/* ✅ LISTA DE CARRERAS CON BOTÓN DE REIMPRESIÓN INCORPORADO */}
            <div className="space-y-3 flex-1 overflow-y-auto custom-scrollbar pr-1">
              {historialProcesado.map((insc) => (
                <div key={insc.id} className="bg-slate-50 border border-slate-200 p-4 rounded-2xl flex flex-col hover:border-slate-300 transition-colors">
                  <div className="flex justify-between items-start mb-2">
                    <h4 className="font-bold text-slate-900 text-sm leading-tight pr-2">{insc.eventos?.nombre_carrera}</h4>
                    <span className="font-black text-red-600 text-sm bg-white px-2 py-0.5 rounded border border-slate-100 shadow-sm">{insc.folio_asignado}</span>
                  </div>
                  <div className="flex items-center text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-2">
                    <Calendar className="w-3 h-3 mr-1" />
                    {insc.eventos?.fecha ? new Date(insc.eventos?.fecha + 'T12:00:00').toLocaleDateString('es-MX', {day: '2-digit', month: 'short', year: 'numeric'}) : 'Sin fecha'}
                  </div>
                  <div className="flex justify-between items-end text-xs mt-auto pt-3 border-t border-slate-200">
                    <div>
                      <span className="text-slate-600 font-medium block">{insc.paquete_comprado}</span>
                      <span className="font-bold text-slate-600 mt-0.5 block">{describePago(insc)}</span>
                    </div>
                    <button
                      disabled={!puedeReimprimir(insc)}
                      onClick={() => reimprimirTicket(insc)}
                      className="flex items-center bg-white border border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-100 px-3 py-1.5 rounded-lg transition-colors font-bold shadow-sm active:scale-95"
                    >
                      <Printer className="w-3.5 h-3.5 mr-1.5" /> Ticket
                    </button>
                  </div>
                </div>
              ))}
            </div>

          </div>
        </div>,
        document.body
      )}

      {/* ✅ POPUP IMPRESIÓN REPORTE (z-index ajustado a 999999 para sobreponerse al historial) */}
      {ticketReciente && <SaleReceipt receipt={ticketReciente} onClose={() => setTicketReciente(null)} />}

    </section>
  );
}
