'use client';

import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../lib/supabase';
import QRCode from 'react-qr-code';
import { Search, Download, UserCheck, ArrowUpDown, X, FileSpreadsheet, ShieldAlert, Printer, MessageCircle, ChevronLeft, ChevronRight, ChevronDown, History, Calendar } from 'lucide-react';
import ConciliacionCobros from './ConciliacionCobros';
import { consultarPago, describePago, puedeReimprimir } from '../lib/eligibilidadFolio';

// ✅ FUNCIÓN: Capitaliza la primera letra de cada palabra
const capitalizarNombres = (texto: string | null | undefined) => {
  if (!texto) return '';
  return texto
    .toLowerCase()
    .split(' ')
    .map(palabra => palabra.charAt(0).toUpperCase() + palabra.slice(1))
    .join(' ');
};

const calcularEdadAlEvento = (fechaNacimiento: string, fechaEvento: string) => {
  if (!fechaNacimiento || !fechaEvento) return 'No definida';
  const nac = new Date(fechaNacimiento);
  const ev = new Date(fechaEvento);
  let edad = ev.getFullYear() - nac.getFullYear();
  const m = ev.getMonth() - nac.getMonth();
  if (m < 0 || (m === 0 && ev.getDate() < nac.getDate())) {
    edad--;
  }
  return isNaN(edad) ? 'No definida' : `${edad} años`;
};

const calcularEdadNumero = (fechaNacimiento: string, fechaEvento: string) => {
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

export default function TabReportes({ eventos, userRole, userId }: any) {
  const [isMounted, setIsMounted] = useState(false);
  useEffect(() => { setIsMounted(true); }, []);

  const [inscripciones, setInscripciones] = useState<any[]>([]);
  
  const [filtroEvento, setFiltroEvento] = useState('');
  const [busqueda, setBusqueda] = useState('');
  const [orden, setOrden] = useState('fecha_desc');
  const [cargando, setCargando] = useState(true);
  const [misEventosPermitidos, setMisEventosPermitidos] = useState<string[]>([]);

  const [paginaActual, setPaginaActual] = useState(1);
  const inscripcionesPorPagina = 25;

  // ESTADOS PARA EL HISTORIAL DEL ATLETA
  const [atletaHistorial, setAtletaHistorial] = useState<any | null>(null);
  const [ordenHistorial, setOrdenHistorial] = useState('reciente');

  useEffect(() => {
    setPaginaActual(1);
  }, [busqueda, filtroEvento, orden]);

  const [ticketReciente, setTicketReciente] = useState<any | null>(null);

  useEffect(() => {
    cargarDatosSeguros();
  }, [userId, userRole]);

  const cargarDatosSeguros = async () => {
    setCargando(true);
    let eventosPermitidos: string[] = [];

    if (userRole === 'Moderador' && userId) {
      const { data: perfil } = await supabase.from('perfiles').select('eventos_asignados').eq('id', userId).single();
      if (perfil && perfil.eventos_asignados) {
        eventosPermitidos = perfil.eventos_asignados;
      }
      setMisEventosPermitidos(eventosPermitidos);

      if (eventosPermitidos.length === 0) {
        setInscripciones([]);
        setCargando(false);
        return;
      }
    }

    let query = supabase.from('inscripciones').select(`
      *,
      atletas (nombre, apellido, telefono, telefono_emergencia, talla_playera, club, ciudad, genero, fecha_nacimiento),
      eventos (nombre_carrera, fecha),
      perfiles (nombre_completo)
    `);

    if (userRole === 'Moderador') {
      query = query.in('evento_id', eventosPermitidos);
    }

    const { data } = await query;
    if (data) setInscripciones(data);

    setCargando(false);
  };

  let inscritosProcesados = inscripciones.filter(i => {
    const coincideEvento = filtroEvento === '' || i.evento_id === filtroEvento;
    const nombreCompleto = `${i.atletas?.nombre} ${i.atletas?.apellido}`.toLowerCase();
    const coincideBusqueda = nombreCompleto.includes(busqueda.toLowerCase()) || i.folio_asignado.includes(busqueda);
    return coincideEvento && coincideBusqueda;
  });

  inscritosProcesados.sort((a, b) => {
    if (orden === 'fecha_desc') return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    if (orden === 'fecha_asc') return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    if (orden === 'folio_desc') return b.folio_asignado.localeCompare(a.folio_asignado);
    if (orden === 'folio_asc') return a.folio_asignado.localeCompare(b.folio_asignado);
    if (orden === 'nombre_asc') return (a.atletas?.nombre || '').localeCompare(b.atletas?.nombre || '');
    if (orden === 'nombre_desc') return (b.atletas?.nombre || '').localeCompare(a.atletas?.nombre || '');
    return 0;
  });

  const totalPaginas = Math.ceil(inscritosProcesados.length / inscripcionesPorPagina);
  const indexUltimaInscripcion = paginaActual * inscripcionesPorPagina;
  const indexPrimeraInscripcion = indexUltimaInscripcion - inscripcionesPorPagina;
  const inscritosPaginados = inscritosProcesados.slice(indexPrimeraInscripcion, indexUltimaInscripcion);

  // LOGICA PARA EL HISTORIAL DEL ATLETA
  const verHistorial = (atletaId: string) => {
    const historial = inscripciones.filter(i => i.atleta_id === atletaId);
    const atletaData = historial.length > 0 ? historial[0].atletas : null;
    if (atletaData) {
      setAtletaHistorial({
        atleta: atletaData,
        inscripciones: historial
      });
      setOrdenHistorial('reciente');
    }
  };

  let historialProcesado = atletaHistorial ? [...atletaHistorial.inscripciones] : [];
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
  const exportarCSV = () => {
    const cabeceras = ['Folio', 'Fecha de Registro', 'Nombres', 'Apellidos', 'Fecha de Nacimiento', 'Edad al Evento', 'Categoría', 'Teléfono', 'Emergencia', 'Club/Equipo', 'Ciudad', 'Género', 'Talla', 'Paquete', 'Cajero', 'Pago', 'Carrera'];
    const filas = inscritosProcesados.map(i => {
      const edadNum = calcularEdadNumero(i.atletas?.fecha_nacimiento, i.eventos?.fecha);
      const categoria = obtenerCategoria(edadNum);
      return [
        i.folio_asignado, 
        new Date(i.created_at).toLocaleDateString('es-MX'),
        capitalizarNombres(i.atletas?.nombre), 
        capitalizarNombres(i.atletas?.apellido), 
        i.atletas?.fecha_nacimiento || 'N/A',
        edadNum !== null ? edadNum : 'N/A', 
        categoria,
        i.atletas?.telefono || '', 
        i.atletas?.telefono_emergencia || '', 
        i.atletas?.club || 'Libre', 
        i.atletas?.ciudad || '', 
        i.atletas?.genero || '', 
        i.atletas?.talla_playera || '', 
        i.paquete_comprado || '', 
        i.perfiles?.nombre_completo || 'No registrado', 
        i.monto_pagado || '0', 
        i.eventos?.nombre_carrera || ''
      ];
    });
    const csvContent = [cabeceras.join(','), ...filas.map(r => r.map(f => `"${f}"`).join(','))].join('\n');
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.setAttribute('download', `Reporte_ACTV_${new Date().getTime()}.csv`);
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
  };

  // =======================================================
  // EXPORTAR A EXCEL (.xls) (Capitalizado y Nombres Separados)
  // =======================================================
  const exportarXLSX = () => {
    let tablaHTML = '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8" /></head><body><table>';
    
    tablaHTML += '<tr><th>Folio</th><th>Fecha de Registro</th><th>Nombres</th><th>Apellidos</th><th>Fecha de Nacimiento</th><th>Edad al Evento</th><th>Categoría</th><th>Teléfono</th><th>Emergencia</th><th>Club/Equipo</th><th>Ciudad</th><th>Género</th><th>Talla</th><th>Paquete</th><th>Cajero</th><th>Pago</th><th>Carrera</th></tr>';
    
    inscritosProcesados.forEach((i: any) => {
      const edadNum = calcularEdadNumero(i.atletas?.fecha_nacimiento, i.eventos?.fecha);
      const categoria = obtenerCategoria(edadNum);

      tablaHTML += `<tr>
        <td>${i.folio_asignado}</td>
        <td>${new Date(i.created_at).toLocaleDateString('es-MX')}</td>
        <td>${capitalizarNombres(i.atletas?.nombre)}</td>
        <td>${capitalizarNombres(i.atletas?.apellido)}</td>
        <td>${i.atletas?.fecha_nacimiento || 'N/A'}</td>
        <td>${edadNum !== null ? edadNum : 'N/A'}</td>
        <td>${categoria}</td>
        <td>${i.atletas?.telefono || ''}</td>
        <td>${i.atletas?.telefono_emergencia || ''}</td>
        <td>${i.atletas?.club || 'Libre'}</td>
        <td>${i.atletas?.ciudad || ''}</td>
        <td>${i.atletas?.genero || ''}</td>
        <td>${i.atletas?.talla_playera || ''}</td>
        <td>${i.paquete_comprado || ''}</td>
        <td>${i.perfiles?.nombre_completo || 'No registrado'}</td>
        <td>${i.monto_pagado || '0'}</td>
        <td>${i.eventos?.nombre_carrera || ''}</td>
      </tr>`;
    });
    
    tablaHTML += '</table></body></html>';
    
    const blob = new Blob([tablaHTML], { type: 'application/vnd.ms-excel;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.setAttribute('download', `Reporte_Excel_${new Date().getTime()}.xls`);
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
  };

  const reimprimirTicket = async (inscripcion: any) => {
    const pago = await consultarPago(inscripcion.id).catch(() => null);
    if (!pago || !puedeReimprimir(pago)) {
      alert('Este folio no tiene un pago vigente verificable. Consulta conciliación.');
      return;
    }
    setTicketReciente({
      id_db: inscripcion.id,
      fecha_hora: inscripcion.created_at,
      evento_nombre: inscripcion.eventos?.nombre_carrera,
      evento_fecha: inscripcion.eventos?.fecha,
      paquete_comprado: inscripcion.paquete_comprado,
      monto_total: pago.monto_pagado,
      folios: inscripcion.folio_asignado,
      folios_array: [inscripcion.folio_asignado],
      corredores: `${capitalizarNombres(inscripcion.atletas?.nombre)} ${capitalizarNombres(inscripcion.atletas?.apellido)}`,
      atletas_data: [inscripcion.atletas],
      cajero: inscripcion.perfiles?.nombre_completo || 'Usuario', 
      historico: pago.actv_eligible !== true,
      esReimpresion: true 
    });
  };

  const enviarTicketWA = () => {
    if (!ticketReciente) return;
    const title = ticketReciente.historico ? 'Copia histórica de inscripción · pago sin validar en ACTV' : '¡Inscripción confirmada!';
    const msj = `${title}\n\nCarrera: ${ticketReciente.evento_nombre}\nCorredor(es): ${ticketReciente.corredores}\nFolio(s): ${ticketReciente.folios}\nImporte registrado: $${ticketReciente.monto_total} MXN`;
    window.open(`https://wa.me/?text=${encodeURIComponent(msj)}`, '_blank');
  };

  const eventosDropdown = userRole === 'Moderador' 
    ? eventos.filter((ev: any) => misEventosPermitidos.includes(ev.id))
    : eventos;

  return (
    <section className="animate-in fade-in slide-in-from-bottom-2 duration-500 space-y-8">
      
      <style jsx global>{`
        @media print {
          @page { margin: 0; size: 58mm auto; }
          html, body { background: white !important; margin: 0 !important; padding: 0 !important; }
          body > :not(.print-area, #ticket-58mm) { display: none !important; }
          
          #ticket-58mm {
            display: block !important;
            width: 58mm;
            padding: 2mm;
            font-family: 'Courier New', Courier, monospace;
            font-size: 10pt;
            font-weight: 700;
            line-height: 1.2;
            color: black;
          }
          .print-area { display: none !important; } 
        }
      `}</style>

      {userRole === 'Administrador' && <ConciliacionCobros canMatch />}

      {/* CABECERA ENTERPRISE */}
      <div className="bg-white p-6 md:p-8 rounded-3xl shadow-sm ring-1 ring-slate-200 no-print">
        <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-6">
          <div>
            <h2 className="text-xl font-black text-slate-900 tracking-tight flex items-center">
              <UserCheck className="mr-2.5 text-blue-600 w-6 h-6" /> Centro de Reportes
            </h2>
            <p className="text-xs font-medium text-slate-500 mt-1">Audita y exporta las inscripciones de todas las carreras.</p>
          </div>
          
          <div className="flex flex-wrap gap-3 w-full xl:w-auto">
            {(userRole === 'Administrador' || userRole === 'Moderador') && (
              <>
                <button onClick={exportarCSV} className="flex-1 md:flex-none text-xs font-bold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 px-4 py-2.5 rounded-xl transition-all flex items-center justify-center shadow-sm">
                  <Download className="w-4 h-4 mr-2 text-green-600" /> Exportar CSV
                </button>
                <button onClick={exportarXLSX} className="flex-1 md:flex-none text-xs font-bold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 px-4 py-2.5 rounded-xl transition-all flex items-center justify-center shadow-sm">
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
              onChange={(e) => setBusqueda(e.target.value)} 
            />
          </div>
          
          <div className="relative">
            <select 
              className="w-full bg-slate-50 border border-slate-200 p-3 px-4 rounded-xl outline-none text-sm text-slate-900 font-bold appearance-none cursor-pointer focus:border-slate-400 transition-all" 
              value={filtroEvento} 
              onChange={(e) => setFiltroEvento(e.target.value)}
            >
              <option value="">{userRole === 'Moderador' ? 'Mis Carreras Asignadas' : 'Todas las carreras'}</option>
              {eventosDropdown.map((ev: any) => <option key={ev.id} value={ev.id}>{ev.nombre_carrera}</option>)}
            </select>
            <ChevronDown className="absolute right-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
          </div>

          <div className="relative">
            <ArrowUpDown className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
            <select 
              className="w-full bg-slate-50 border border-slate-200 p-3 pl-11 rounded-xl outline-none text-sm text-slate-900 font-bold appearance-none cursor-pointer focus:border-slate-400 transition-all" 
              value={orden} 
              onChange={(e) => setOrden(e.target.value)}
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
                Mostrando <span className="text-slate-900">{indexPrimeraInscripcion + 1}</span> a <span className="text-slate-900">{Math.min(indexUltimaInscripcion, inscritosProcesados.length)}</span> de <span className="text-blue-600">{inscritosProcesados.length}</span> inscripciones
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
              {historialProcesado.map((insc: any) => (
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
      {isMounted && ticketReciente && createPortal(
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md flex items-center justify-center z-[999999] p-4 no-print overflow-y-auto">
          <div className="bg-white p-8 rounded-[32px] max-w-sm w-full text-center relative font-sans shadow-2xl animate-in zoom-in-95 duration-200 my-auto border border-slate-100">
            <button type="button" onClick={() => setTicketReciente(null)} className="absolute top-5 right-5 text-slate-400 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 p-1.5 rounded-full transition-all"><X size={16} /></button>
            
            <h3 className="text-3xl font-black text-slate-900 mb-1 tracking-tight">ACTV</h3>
            <p className="text-[10px] text-slate-400 border-b border-slate-200 pb-4 mb-5 uppercase font-bold tracking-widest">{ticketReciente.historico ? 'Copia histórica · pago sin validar' : 'Reimpresión de ticket'}</p>
            
            <div className="text-left text-sm space-y-3 mb-6 text-slate-700">
              <p><strong className="text-slate-900">Evento:</strong> {ticketReciente.evento_nombre}</p>
              <p><strong className="text-slate-900">Corredor:</strong> {ticketReciente.corredores}</p>
              <div className="bg-slate-50 p-5 rounded-2xl text-center mt-5 border border-slate-200/80 shadow-inner">
                <p className="text-[10px] uppercase font-bold text-slate-400 mb-1 tracking-widest">Folio Asignado</p>
                <p className="text-4xl font-black text-red-600 tracking-tighter">{ticketReciente.folios}</p>
              </div>
            </div>
            
            <div className="space-y-2.5">
              <button type="button" onClick={enviarTicketWA} className="w-full bg-slate-100 text-slate-700 hover:text-slate-900 hover:bg-slate-200 py-3.5 rounded-xl font-bold flex items-center justify-center shadow-sm transition-all active:scale-[0.98] text-sm"><MessageCircle className="mr-2 w-4 h-4"/> Enviar por WhatsApp</button>
              <button type="button" onClick={() => window.print()} className="w-full bg-slate-900 text-white py-3.5 rounded-xl font-bold flex items-center justify-center shadow-lg shadow-slate-900/20 hover:bg-black transition-all active:scale-[0.98] text-sm"><Printer className="mr-2 w-4 h-4"/> Imprimir Recibo</button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* RECIBO GRANDE (A4/CARTA) */}
      {isMounted && ticketReciente && createPortal(
        <div className="print-area hidden print:flex flex-col bg-white text-black font-sans w-full p-10">
          <div className="flex justify-between items-center border-b-4 border-black pb-4 mb-8">
            <img src="https://actv.mx/wp-content/uploads/2026/02/Logo-ACTV-2026-min.png" alt="logo actv" className="h-20 w-auto" />
            <div className="text-right">
                <h1 className="text-4xl font-black uppercase tracking-tighter">ACTV - Reimpresión</h1>
                <h2 className="text-2xl font-bold text-gray-700 mt-2 uppercase">{ticketReciente.evento_nombre} <br/><span className="text-lg text-gray-500 capitalize">Fecha del evento: {ticketReciente.evento_fecha ? new Date(ticketReciente.evento_fecha + 'T12:00:00').toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' }).replace(/ de /g, '-') : ''}</span></h2>
            </div>
          </div>
          <div className="flex-grow space-y-6">
            {ticketReciente.atletas_data.map((atleta: any, index: number) => (
              <div key={index} className="border-2 border-slate-200 p-6 rounded-xl relative">
                <div className="absolute top-4 right-6 text-right">
                  <p className="text-[10px] font-black uppercase text-gray-400">Número de Folio</p>
                  <p className="text-4xl font-black text-[#8A0303]">{ticketReciente.folios_array[index]}</p>
                </div>
                <div className="w-2/3 mb-4">
                  <p className="text-[10px] font-black uppercase text-gray-400">Nombre del Atleta</p>
                  <p className="text-2xl font-black uppercase leading-none text-slate-900">{capitalizarNombres(atleta.nombre)} {capitalizarNombres(atleta.apellido)}</p>
                </div>
                <div className="grid grid-cols-2 gap-y-4 gap-x-2">
                  <div><p className="text-[10px] font-black uppercase text-gray-400">Club</p><p className="text-sm font-bold uppercase">{atleta.club || 'Libre'}</p></div>
                  <div><p className="text-[10px] font-black uppercase text-gray-400">Edad</p><p className="text-sm font-bold uppercase">{calcularEdadAlEvento(atleta.fecha_nacimiento, ticketReciente.evento_fecha)}</p></div>
                  <div><p className="text-[10px] font-black uppercase text-gray-400">Teléfono</p><p className="text-sm font-bold uppercase">{atleta.telefono}</p></div>
                  <div><p className="text-[10px] font-black uppercase text-gray-400">Emergencia</p><p className="text-sm font-bold uppercase">{atleta.telefono_emergencia}</p></div>
                </div>
              </div>
            ))}
            <div className="border-t-2 border-dashed border-gray-300 pt-6 flex justify-between items-center px-4">
               <div><p className="text-lg font-bold uppercase">{ticketReciente.paquete_comprado}</p><p className="text-3xl font-black">${ticketReciente.monto_total} MXN</p></div>
               <QRCode value={ticketReciente.folios} size={110} />
            </div>
          </div>
          <div className="mt-auto pt-8 border-t-2 border-black flex justify-between items-end">
              <div className="w-2/3">
                  <p className="text-[10px] text-justify leading-tight text-gray-700">"Yo, {ticketReciente.corredores}, declaro que participo voluntariamente, asumo los riesgos físicos y libero a ACTV y organizadores de toda responsabilidad por lesiones o incidentes derivados del evento. Autorizo el uso de mi imagen para fines publicitarios..."</p>
                  <div className="mt-16 border-t border-black w-64 pt-2 text-center text-[10px] font-bold">Firma de Conformidad</div>
              </div>
              <div className="text-right text-[10px] font-bold text-gray-700">
                  <p>Cajero: {ticketReciente.cajero}</p>
                  <p>actv.mx</p>
              </div>
          </div>
        </div>,
        document.body
      )}

      {/* TICKET TÉRMICO 58MM DOBLE */}
      {isMounted && ticketReciente && createPortal(
        <div id="ticket-58mm" className="hidden print:block font-bold">
          {[1, 2].map((copia) => (
            <div key={copia} style={{ pageBreakInside: 'avoid', breakInside: 'avoid' }}>
              
              <div style={{ textAlign: 'center', marginBottom: '5px' }}>
                <img src="https://actv.mx/wp-content/uploads/2026/02/Logo-ACTV-2026-min.png" alt="logo actv" style={{ width: '30mm', height: 'auto', margin: '0 auto 5px auto', display: 'block', filter: 'grayscale(100%) contrast(1.5)' }} />
                <h2 style={{ fontSize: '15pt', margin: 0, fontWeight: '900' }}>ACTV SaaS</h2>
                {ticketReciente.esReimpresion && <p style={{ fontSize: '10pt', margin: '2px 0', fontWeight: '900', borderTop: '1px dashed black', borderBottom: '1px dashed black', padding: '2px 0' }}>{ticketReciente.historico ? 'COPIA HISTÓRICA · PAGO SIN VALIDAR' : 'REIMPRESIÓN'}</p>}
                <p style={{ fontSize: '9pt', margin: 0, padding: '2px', backgroundColor: 'black', color: 'white' }}>{copia === 1 ? 'ORIGINAL - CLIENTE' : 'COPIA - ORGANIZADOR'}</p>
                <p style={{ marginTop: '5px' }}>==========================</p>
              </div>
              
              <p><strong>Ticket:</strong> {ticketReciente.id_db || 'N/A'}</p>
              <p><strong>Cajero:</strong> {ticketReciente.cajero || 'Usuario'}</p>
              <p><strong>Fecha:</strong> {new Date(ticketReciente.fecha_hora || Date.now()).toLocaleString('es-MX')}</p>
              <p><strong>Evento:</strong> {ticketReciente.evento_nombre}<br/><strong>Fecha del evento:</strong> {ticketReciente.evento_fecha ? new Date(ticketReciente.evento_fecha + 'T12:00:00').toLocaleDateString('es-MX', {day: '2-digit', month: 'long', year: 'numeric'}).replace(/ de /g, '-') : ''}</p>
              <p>==========================</p>
              
              {ticketReciente.atletas_data.map((atleta: any, idx: number) => (
                <div key={idx} style={{ marginBottom: '8px' }}>
                  <p style={{ fontSize: '11pt', fontWeight: '900' }}>{idx + 1}. {capitalizarNombres(atleta.nombre)} {capitalizarNombres(atleta.apellido)}</p>
                  <p style={{ fontSize: '13pt', fontWeight: '900', color: 'black' }}>FOLIO: {ticketReciente.folios_array[idx]}</p>
                  <div style={{ fontSize: '9pt', paddingLeft: '5px' }}>
                    <p>• Gen: {atleta.genero} / Talla: {atleta.talla_playera}</p>
                    <p>• Club: {atleta.club || 'Libre'}</p>
                    <p>• Tel: {atleta.telefono}</p>
                  </div>
                </div>
              ))}

              <p>==========================</p>
              <p><strong>Paquete:</strong> {ticketReciente.paquete_comprado}</p>
              <p style={{ fontSize: '12pt', fontWeight: '900' }}>{ticketReciente.historico ? 'IMPORTE REGISTRADO:' : 'PAGO TOTAL:'} ${ticketReciente.monto_total} MXN</p>
              
              <div style={{ display: 'flex', justifyContent: 'center', margin: '10px 0' }}>
                <QRCode value={ticketReciente.folios} size={90} style={{ height: "auto", maxWidth: "25mm", width: "25mm" }} />
              </div>

              <div style={{ fontSize: '7.5pt', textAlign: 'justify', marginTop: '10px', padding: '0 2px', lineHeight: '1.2' }}>
                <strong>EXONERACIÓN:</strong> Declaro que participo voluntariamente, asumo los riesgos físicos y libero a ACTV y organizadores de toda responsabilidad por lesiones o incidentes durante el evento.
              </div>

              {copia === 2 && (
                <div style={{ marginTop: '30px', textAlign: 'center' }}>
                  <p>__________________________</p>
                  <p style={{ fontSize: '8pt', marginTop: '3px' }}>Firma de Conformidad</p>
                </div>
              )}

              <p style={{ marginTop: '10px' }}>==========================</p>
              <div style={{ fontSize: '8pt', textAlign: 'center', marginTop: '5px' }}>
                <p>No válido para efectos fiscales.</p>
                <p style={{ marginTop: '5px' }}>¡GRACIAS POR CORRER CON ACTV!</p>
                <p style={{ marginTop: '5px', fontWeight: '900' }}>actv.mx</p>
              </div>
              
              {copia === 1 && <div style={{ borderBottom: '1px dashed black', margin: '2.5mm 0' }}></div>}
            </div>
          ))}
        </div>,
        document.body
      )}

    </section>
  );
}
