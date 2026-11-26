'use client';


import { useClientReady } from '../lib/use-client-ready';
import type { Athlete, Registration, AthleteHistory, Receipt, StaffScreenProps } from '../lib/legacy-types';
import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../lib/supabase';
import QRCode from 'react-qr-code';
import { consultarPago, describePago, puedeReimprimir } from '../lib/eligibilidadFolio';
import { Search, Download, Users, Edit, Trash2, ArrowUpDown, X, Mail, Phone, MapPin, Award, Calendar, Timer, FileSpreadsheet, ChevronLeft, ChevronRight, UserCircle, ChevronDown, History, Printer, MessageCircle } from 'lucide-react';

// ✅ FUNCIÓN: Capitaliza la primera letra de cada palabra
const capitalizarNombres = (texto: string | null | undefined) => {
  if (!texto) return '';
  return texto
    .toLowerCase()
    .split(' ')
    .map(palabra => palabra.charAt(0).toUpperCase() + palabra.slice(1))
    .join(' ');
};

const calcularEdadActual = (fechaNacimiento: string) => {
  if (!fechaNacimiento) return 'N/A';
  const hoy = new Date();
  const nac = new Date(fechaNacimiento);
  let edad = hoy.getFullYear() - nac.getFullYear();
  const m = hoy.getMonth() - nac.getMonth();
  if (m < 0 || (m === 0 && hoy.getDate() < nac.getDate())) edad--;
  return edad;
};

const calcularEdadAlEvento = (fechaNacimiento: string | undefined, fechaEvento: string | undefined) => {
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

export default function TabListaAtletas({ atletas, clubes, recargarDatos }: Pick<StaffScreenProps, 'atletas' | 'clubes' | 'recargarDatos'>) {
  const isMounted = useClientReady();

  const [busqueda, setBusqueda] = useState('');
  const [filtroClub, setFiltroClub] = useState('');
  const [orden, setOrden] = useState('nombre_asc');

  const [paginaActual, setPaginaActual] = useState(1);
  const atletasPorPagina = 25;
  const cambiarBusqueda = (value: string) => { setBusqueda(value); setPaginaActual(1); };
  const cambiarFiltroClub = (value: string) => { setFiltroClub(value); setPaginaActual(1); };
  const cambiarOrden = (value: string) => { setOrden(value); setPaginaActual(1); };

  // ✅ ESTADOS PARA EL HISTORIAL Y TICKETS
  const [atletaHistorial, setAtletaHistorial] = useState<AthleteHistory | null>(null);
  const [ordenHistorial, setOrdenHistorial] = useState('reciente');
  const [cargandoHistorial, setCargandoHistorial] = useState(false);
  const [ticketReciente, setTicketReciente] = useState<Receipt | null>(null);


  const [editando, setEditando] = useState<Athlete | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [formEdicion, setFormEdicion] = useState<Partial<Athlete>>({});

  const filtrados = atletas.filter((a) => {
    const nombreCompleto = `${a.nombre} ${a.apellido} ${a.telefono}`.toLowerCase();
    const coincideBusqueda = nombreCompleto.includes(busqueda.toLowerCase());
    const coincideClub = filtroClub === '' || a.club === filtroClub;
    return coincideBusqueda && coincideClub;
  });

  filtrados.sort((a, b) => {
    if (orden === 'nombre_asc') return (a.nombre).localeCompare(b.nombre);
    if (orden === 'nombre_desc') return (b.nombre).localeCompare(a.nombre);
    if (orden === 'recientes') return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    return 0;
  });

  const totalPaginas = Math.ceil(filtrados.length / atletasPorPagina);
  const indexUltimoAtleta = paginaActual * atletasPorPagina;
  const indexPrimerAtleta = indexUltimoAtleta - atletasPorPagina;
  const atletasPaginados = filtrados.slice(indexPrimerAtleta, indexUltimoAtleta);

  // =======================================================
  // ✅ LOGICA PARA CARGAR EL HISTORIAL BAJO DEMANDA
  // =======================================================
  const verHistorial = async (atleta: Athlete) => {
    setAtletaHistorial({ atleta, inscripciones: [] }); // Abre el modal de inmediato
    setCargandoHistorial(true);
    setOrdenHistorial('reciente');

    // Buscamos las inscripciones de este atleta en la base de datos
    const { data } = await supabase
      .from('inscripciones')
      .select('*, eventos(nombre_carrera, fecha), perfiles(nombre_completo)')
      .eq('atleta_id', atleta.id);

    if (data) {
      setAtletaHistorial({ atleta, inscripciones: data });
    }
    setCargandoHistorial(false);
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
  // ✅ LOGICA PARA REIMPRIMIR TICKETS
  // =======================================================
  const reimprimirTicket = async (inscripcion: Registration) => {
    const pago = await consultarPago(inscripcion.id).catch(() => null);
    if (!atletaHistorial || !pago || !puedeReimprimir(pago)) {
      alert('Este folio no tiene un pago vigente verificable. Consulta conciliación.');
      return;
    }
    setTicketReciente({
      id_db: inscripcion.id,
      fecha_hora: inscripcion.created_at || new Date().toISOString(),
      evento_nombre: inscripcion.eventos?.nombre_carrera,
      evento_fecha: inscripcion.eventos?.fecha,
      paquete_comprado: inscripcion.paquete_comprado,
      monto_total: pago.monto_pagado,
      folios: inscripcion.folio_asignado,
      folios_array: [inscripcion.folio_asignado],
      corredores: `${capitalizarNombres(atletaHistorial.atleta.nombre)} ${capitalizarNombres(atletaHistorial.atleta.apellido)}`,
      atletas_data: [atletaHistorial.atleta],
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

  const exportarCSV = () => {
    const cabeceras = ['Nombre', 'Apellido', 'Edad', 'Genero', 'Club', 'Ciudad', 'Telefono', 'Email', 'Talla', 'PR 5K', 'PR 10K', 'PR 21K', 'PR 42K'];
    const filas = filtrados.map((a) => [
      capitalizarNombres(a.nombre), capitalizarNombres(a.apellido), calcularEdadActual(a.fecha_nacimiento), a.genero, a.club, a.ciudad, a.telefono, a.email, a.talla_playera, a.pr_5k, a.pr_10k, a.pr_21k, a.pr_42k
    ]);
    const csvContent = [cabeceras.join(','), ...filas.map((r) => r.map((f) => `"${String(f ?? '')}"`).join(','))].join('\n');
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `Padron_Atletas_ACTV.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const exportarXLSX = () => {
    let tablaHTML = '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8" /></head><body><table>';

    tablaHTML += '<tr><th>Nombre</th><th>Apellido</th><th>Edad</th><th>Género</th><th>Club</th><th>Ciudad</th><th>Teléfono</th><th>Email</th><th>Talla</th><th>PR 5K</th><th>PR 10K</th><th>PR 21K</th><th>PR 42K</th></tr>';

    filtrados.forEach((a) => {
      tablaHTML += `<tr>
        <td>${capitalizarNombres(a.nombre) || ''}</td>
        <td>${capitalizarNombres(a.apellido) || ''}</td>
        <td>${calcularEdadActual(a.fecha_nacimiento)}</td>
        <td>${a.genero || ''}</td>
        <td>${a.club || 'Libre'}</td>
        <td>${a.ciudad || ''}</td>
        <td>${a.telefono || ''}</td>
        <td>${a.email || ''}</td>
        <td>${a.talla_playera || ''}</td>
        <td>${a.pr_5k || ''}</td>
        <td>${a.pr_10k || ''}</td>
        <td>${a.pr_21k || ''}</td>
        <td>${a.pr_42k || ''}</td>
      </tr>`;
    });

    tablaHTML += '</table></body></html>';

    const blob = new Blob([tablaHTML], { type: 'application/vnd.ms-excel;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.setAttribute('download', `Padron_Atletas_ACTV_${new Date().getTime()}.xls`);
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
  };

  const eliminarAtleta = async (id: string, nombre: string) => {
    if (window.confirm(`¿Eliminar permanentemente a ${nombre}? Se borrará su historial de récords.`)) {
      const { error } = await supabase.from('atletas').delete().eq('id', id);
      if (!error) recargarDatos();
    }
  };

  const abrirEdicion = (atleta: Athlete) => {
    setEditando(atleta);
    setFormEdicion({ ...atleta });
  };

  const handleChangeEdicion = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setFormEdicion({ ...formEdicion, [e.target.name]: e.target.value });
  };

  const guardarEdicion = async (e: React.FormEvent) => {
    e.preventDefault();
    setGuardando(true);
    const datosParaEnviar: { [K in keyof Athlete]?: Athlete[K] | null } = { ...formEdicion };

    delete datosParaEnviar.perfiles;

    if (!datosParaEnviar.email || datosParaEnviar.email.trim() === '') datosParaEnviar.email = null;
    if (!datosParaEnviar.pr_5k || datosParaEnviar.pr_5k.trim() === '') datosParaEnviar.pr_5k = null;
    if (!datosParaEnviar.pr_10k || datosParaEnviar.pr_10k.trim() === '') datosParaEnviar.pr_10k = null;
    if (!datosParaEnviar.pr_21k || datosParaEnviar.pr_21k.trim() === '') datosParaEnviar.pr_21k = null;
    if (!datosParaEnviar.pr_42k || datosParaEnviar.pr_42k.trim() === '') datosParaEnviar.pr_42k = null;

    const { error } = await supabase.from('atletas').update(datosParaEnviar).eq('id', formEdicion.id);
    if (error) alert("Error al actualizar: " + error.message);
    else { setEditando(null); if (recargarDatos) recargarDatos(); }
    setGuardando(false);
  };

  const clubesOrdenados = [...(clubes || [])].sort((a, b) => {
    const nombreA = String(a?.nombre || '').trim();
    const nombreB = String(b?.nombre || '').trim();
    return nombreA.localeCompare(nombreB, 'es', { numeric: true, sensitivity: 'base' });
  });

  return (
    <section className="animate-in fade-in slide-in-from-bottom-2 duration-500 space-y-8">

      {/* ESTILOS DE IMPRESIÓN */}
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

      {/* CABECERA */}
      <div className="bg-white p-6 md:p-8 rounded-3xl shadow-sm ring-1 ring-slate-200 no-print">
        <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-6">
          <div>
            <h2 className="text-xl font-black text-slate-900 tracking-tight flex items-center">
              <Users className="mr-2.5 text-slate-900 w-6 h-6" /> Padrón de Atletas
            </h2>
            <p className="text-xs font-medium text-slate-500 mt-1">Gestiona la base de datos maestra de competidores.</p>
          </div>

          <div className="flex flex-wrap gap-3 w-full xl:w-auto">
            <button onClick={exportarCSV} className="flex-1 md:flex-none text-xs font-bold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 px-4 py-2.5 rounded-xl transition-all flex items-center justify-center shadow-sm">
              <Download className="w-4 h-4 mr-2 text-green-600" /> Exportar CSV
            </button>
            <button onClick={exportarXLSX} className="flex-1 md:flex-none text-xs font-bold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 px-4 py-2.5 rounded-xl transition-all flex items-center justify-center shadow-sm">
              <FileSpreadsheet className="w-4 h-4 mr-2 text-indigo-600" /> Exportar Excel
            </button>
          </div>
        </div>

        {/* FILTROS */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-8">
          <div className="relative group">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 group-focus-within:text-slate-900 transition-colors" />
            <input
              type="text"
              placeholder="Nombre o teléfono..."
              className="w-full bg-slate-50 border border-slate-200 p-3 pl-11 rounded-xl outline-none text-sm focus:border-slate-400 focus:ring-4 focus:ring-slate-900/5 transition-all text-slate-900 placeholder:text-slate-400 font-medium"
              value={busqueda}
              onChange={(e) => cambiarBusqueda(e.target.value)}
            />
          </div>

          <div className="relative">
            <Award className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
            <select
              className="w-full bg-slate-50 border border-slate-200 p-3 pl-11 rounded-xl outline-none text-sm text-slate-900 font-bold appearance-none cursor-pointer focus:border-slate-400 transition-all"
              value={filtroClub}
              onChange={(e) => cambiarFiltroClub(e.target.value)}
            >
              <option value="">Todos los Clubes</option>
              <option value="Libre">Libre</option>
              {clubesOrdenados.map((c) => <option key={c.id} value={c.nombre}>{c.nombre}</option>)}
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
              <option value="nombre_asc">Nombre (A - Z)</option>
              <option value="nombre_desc">Nombre (Z - A)</option>
              <option value="recientes">Registro más reciente</option>
            </select>
            <ChevronDown className="absolute right-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
          </div>
        </div>
      </div>

      {/* TABLA ESTILO ENTERPRISE */}
      <div className="bg-white rounded-3xl ring-1 ring-slate-200 overflow-hidden shadow-sm no-print">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm min-w-[1000px]">
            <thead>
              <tr className="bg-slate-50/50 border-b border-slate-100">
                <th className="px-6 py-4 font-bold text-slate-400 uppercase text-[10px] tracking-widest">Atleta</th>
                <th className="px-6 py-4 font-bold text-slate-400 uppercase text-[10px] tracking-widest">Perfil</th>
                <th className="px-6 py-4 font-bold text-slate-400 uppercase text-[10px] tracking-widest">Contacto</th>
                <th className="px-6 py-4 font-bold text-slate-400 uppercase text-[10px] tracking-widest">Club / Ciudad</th>
                <th className="px-6 py-4 font-bold text-slate-400 uppercase text-[10px] tracking-widest">Récords</th>
                <th className="px-6 py-4 font-bold text-slate-400 uppercase text-[10px] tracking-widest">Registrado por</th>
                <th className="px-6 py-4 font-bold text-slate-400 uppercase text-[10px] tracking-widest text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {atletasPaginados.map((a) => (
                <tr key={a.id} className="hover:bg-slate-50/80 transition-colors group">
                  <td className="px-6 py-4">
                    {/* ✅ NOMBRE COMO BOTÓN PARA ABRIR HISTORIAL */}
                    <button
                      onClick={() => verHistorial(a)}
                      className="font-bold text-blue-600 hover:text-blue-800 hover:underline uppercase tracking-tight text-left transition-all focus:outline-none"
                    >
                      {capitalizarNombres(a.nombre)} {capitalizarNombres(a.apellido)}
                    </button>
                    <p className="text-[10px] font-medium text-slate-400 mt-0.5">ID: {a.id.toString().slice(-6).toUpperCase()}</p>
                  </td>
                  <td className="px-6 py-4">
                    <p className="font-bold text-slate-700">{calcularEdadActual(a.fecha_nacimiento)} años</p>
                    <p className="text-[10px] font-black text-slate-400 uppercase mt-0.5 bg-slate-100 w-fit px-1.5 rounded">{a.genero}</p>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center text-slate-600 font-medium"><Phone className="w-3.5 h-3.5 mr-2 text-slate-400"/> {a.telefono}</div>
                    <div className="flex items-center text-[11px] text-slate-400 lowercase mt-1"><Mail className="w-3.5 h-3.5 mr-2 text-slate-300"/> {a.email || 'sin correo'}</div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center font-black text-slate-900"><Award className="w-3.5 h-3.5 mr-2 text-slate-900"/> {a.club}</div>
                    <div className="flex items-center text-[11px] text-slate-400 uppercase mt-1 font-bold"><MapPin className="w-3.5 h-3.5 mr-2 text-slate-300"/> {capitalizarNombres(a.ciudad)}</div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex flex-col gap-1">
                      {a.pr_5k && <span className="text-[9px] font-black bg-slate-100 text-slate-600 px-2 py-0.5 rounded-md border border-slate-200">5K: {a.pr_5k}</span>}
                      {a.pr_10k && <span className="text-[9px] font-black bg-slate-100 text-slate-600 px-2 py-0.5 rounded-md border border-slate-200">10K: {a.pr_10k}</span>}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center shrink-0">
                        <UserCircle className="w-5 h-5 text-slate-400" />
                      </div>
                      <div>
                        <p className="text-xs font-bold text-slate-700 leading-none">{a.perfiles?.nombre_completo || 'Sistema / Web'}</p>
                        <p className="text-[9px] text-slate-400 font-medium mt-1">{new Date(a.created_at).toLocaleDateString('es-MX')}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex justify-end gap-2 opacity-100 lg:opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => abrirEdicion(a)} className="p-2 bg-white border border-slate-200 text-slate-600 rounded-xl hover:bg-slate-900 hover:text-white hover:border-slate-900 transition-all shadow-sm">
                        <Edit className="w-4 h-4" />
                      </button>
                      <button onClick={() => eliminarAtleta(a.id, a.nombre)} className="p-2 bg-white border border-slate-200 text-red-500 rounded-xl hover:bg-red-50 hover:border-red-200 transition-all shadow-sm">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {filtrados.length === 0 && (
          <div className="p-20 text-center">
            <Users className="w-12 h-12 text-slate-200 mx-auto mb-4" />
            <p className="text-slate-400 font-bold tracking-tight">No se encontraron atletas con esos criterios.</p>
          </div>
        )}
      </div>

      {/* PAGINACIÓN */}
      {filtrados.length > 0 && (
        <div className="flex flex-col sm:flex-row justify-between items-center bg-white p-5 rounded-3xl ring-1 ring-slate-200 shadow-sm gap-4 no-print">
          <p className="text-xs text-slate-500 font-bold">
            Mostrando <span className="text-slate-900">{(paginaActual - 1) * atletasPorPagina + 1}</span> a <span className="text-slate-900">{Math.min(paginaActual * atletasPorPagina, filtrados.length)}</span> de <span className="text-slate-900">{filtrados.length}</span> atletas registrados
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

            <div className="space-y-3 flex-1 overflow-y-auto custom-scrollbar pr-1">
              {cargandoHistorial ? (
                 <div className="py-10 text-center text-slate-400 font-bold tracking-widest uppercase text-xs animate-pulse">Buscando tickets...</div>
              ) : historialProcesado.length === 0 ? (
                 <div className="py-10 text-center text-slate-400 font-medium text-sm">Este atleta aún no tiene carreras registradas.</div>
              ) : (
                historialProcesado.map((insc) => (
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
                        className="flex items-center bg-white border border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-100 px-3 py-1.5 rounded-lg transition-colors font-bold shadow-sm active:scale-95 disabled:opacity-40"
                      >
                        <Printer className="w-3.5 h-3.5 mr-1.5" /> Ticket
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

          </div>
        </div>,
        document.body
      )}

      {/* ✅ POPUP IMPRESIÓN REPORTE (z-index 999999 para sobreponerse al historial) */}
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
            {ticketReciente.atletas_data.map((atleta, index: number) => (
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
                  <p className="text-[10px] text-justify leading-tight text-gray-700">&quot;Yo, {ticketReciente.corredores}, declaro que participo voluntariamente, asumo los riesgos físicos y libero a ACTV y organizadores de toda responsabilidad por lesiones o incidentes derivados del evento. Autorizo el uso de mi imagen para fines publicitarios...&quot;</p>
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
              <p><strong>Fecha:</strong> {new Date(ticketReciente.fecha_hora).toLocaleString('es-MX')}</p>
              <p><strong>Evento:</strong> {ticketReciente.evento_nombre}<br/><strong>Fecha del evento:</strong> {ticketReciente.evento_fecha ? new Date(ticketReciente.evento_fecha + 'T12:00:00').toLocaleDateString('es-MX', {day: '2-digit', month: 'long', year: 'numeric'}).replace(/ de /g, '-') : ''}</p>
              <p>==========================</p>

              {ticketReciente.atletas_data.map((atleta, idx: number) => (
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

      {/* MODAL DE EDICIÓN (ATLETA) */}
      {isMounted && editando && createPortal(
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-[9999] p-4 no-print overflow-y-auto">
          <div className="bg-white rounded-[32px] p-8 md:p-10 max-w-2xl w-full shadow-2xl relative my-auto border border-slate-100 animate-in zoom-in-95 duration-200 max-h-[90vh] overflow-y-auto custom-scrollbar">
            <button type="button" onClick={() => setEditando(null)} className="absolute top-6 right-6 text-slate-400 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 p-2 rounded-full transition-all"><X size={20}/></button>

            <div className="mb-8">
              <div className="bg-slate-100 w-12 h-12 rounded-2xl flex items-center justify-center mb-4">
                <Edit className="w-6 h-6 text-slate-900"/>
              </div>
              <h3 className="text-2xl font-black text-slate-900 tracking-tight leading-none">Editar Atleta</h3>
              <p className="text-sm font-medium text-slate-400 mt-2">Modifica la información del perfil seleccionado.</p>
            </div>

            <form onSubmit={guardarEdicion} className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider pl-1">Nombre(s) *</label>
                  <input type="text" name="nombre" required value={formEdicion.nombre || ''} onChange={handleChangeEdicion} className="w-full bg-slate-50 border border-slate-200 p-3.5 rounded-2xl outline-none text-slate-900 focus:border-slate-400 focus:ring-4 focus:ring-slate-900/5 transition-all text-sm font-bold" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider pl-1">Apellido(s) *</label>
                  <input type="text" name="apellido" required value={formEdicion.apellido || ''} onChange={handleChangeEdicion} className="w-full bg-slate-50 border border-slate-200 p-3.5 rounded-2xl outline-none text-slate-900 focus:border-slate-400 focus:ring-4 focus:ring-slate-900/5 transition-all text-sm font-bold" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider pl-1 flex items-center"><Calendar className="w-3.5 h-3.5 mr-1.5"/> Fecha Nacimiento</label>
                  <input type="date" name="fecha_nacimiento" required value={formEdicion.fecha_nacimiento || ''} onChange={handleChangeEdicion} className="w-full bg-slate-50 border border-slate-200 p-3.5 rounded-2xl outline-none text-slate-900 focus:border-slate-400 transition-all text-sm font-medium" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider pl-1">Género</label>
                  <div className="relative">
                    <select name="genero" required value={formEdicion.genero || 'Hombre'} onChange={handleChangeEdicion} className="w-full bg-slate-50 border border-slate-200 p-3.5 rounded-2xl outline-none text-slate-900 font-bold appearance-none cursor-pointer focus:border-slate-400">
                      <option value="Hombre">Hombre</option>
                      <option value="Mujer">Mujer</option>
                    </select>
                    <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider pl-1 flex items-center"><Award className="w-3.5 h-3.5 mr-1.5"/> Club / Equipo</label>
                  <div className="relative">
                    <select name="club" required value={formEdicion.club || 'Libre'} onChange={handleChangeEdicion} className="w-full bg-slate-50 border border-slate-200 p-3.5 rounded-2xl outline-none text-slate-900 font-bold appearance-none cursor-pointer focus:border-slate-400">
                      <option value="Libre">Libre</option>
                      {clubesOrdenados.map((c) => (
                        <option key={c.id} value={c.nombre}>{c.nombre}</option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider pl-1">Talla Playera</label>
                  <div className="relative">
                    <select name="talla_playera" required value={formEdicion.talla_playera || ''} onChange={handleChangeEdicion} className="w-full bg-slate-50 border border-slate-200 p-3.5 rounded-2xl outline-none text-slate-900 font-bold appearance-none cursor-pointer focus:border-slate-400">
                      <option value="" disabled>Talla...</option>
                      <option value="XS">XS</option><option value="S">S</option><option value="M">M</option><option value="L">L</option><option value="XL">XL</option><option value="XXL">XXL</option>
                    </select>
                    <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider pl-1 flex items-center"><Phone className="w-3.5 h-3.5 mr-1.5"/> Tel. Celular</label>
                  <input type="text" name="telefono" required value={formEdicion.telefono || ''} onChange={handleChangeEdicion} className="w-full bg-slate-50 border border-slate-200 p-3.5 rounded-2xl outline-none text-slate-900 focus:border-slate-400 transition-all text-sm font-medium" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-red-400 uppercase tracking-wider pl-1 flex items-center"><Phone className="w-3.5 h-3.5 mr-1.5"/> Tel. Emergencia</label>
                  <input type="text" name="telefono_emergencia" required value={formEdicion.telefono_emergencia || ''} onChange={handleChangeEdicion} className="w-full bg-red-50/30 border border-red-100 p-3.5 rounded-2xl outline-none text-slate-900 focus:border-red-400 transition-all text-sm font-medium" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider pl-1 flex items-center"><MapPin className="w-3.5 h-3.5 mr-1.5"/> Ciudad</label>
                  <input type="text" name="ciudad" required value={formEdicion.ciudad || ''} onChange={handleChangeEdicion} className="w-full bg-slate-50 border border-slate-200 p-3.5 rounded-2xl outline-none text-slate-900 focus:border-slate-400 transition-all text-sm font-medium" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider pl-1 flex items-center"><Mail className="w-3.5 h-3.5 mr-1.5"/> Email</label>
                  <input type="email" name="email" value={formEdicion.email || ''} onChange={handleChangeEdicion} className="w-full bg-slate-50 border border-slate-200 p-3.5 rounded-2xl outline-none text-slate-900 focus:border-slate-400 transition-all text-sm font-medium" />
                </div>
              </div>

              <div className="bg-slate-50 rounded-[24px] p-6 border border-slate-200/60 mt-4">
                <h4 className="text-[10px] font-bold text-slate-500 mb-4 uppercase tracking-widest flex items-center"><Timer className="w-3.5 h-3.5 mr-2"/> Récords Personales (Opcional)</h4>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <input type="text" name="pr_5k" placeholder="5K" value={formEdicion.pr_5k || ''} onChange={handleChangeEdicion} className="w-full bg-white border border-slate-200 p-2.5 rounded-xl text-xs outline-none focus:border-slate-400 text-slate-900 font-mono shadow-sm" />
                  <input type="text" name="pr_10k" placeholder="10K" value={formEdicion.pr_10k || ''} onChange={handleChangeEdicion} className="w-full bg-white border border-slate-200 p-2.5 rounded-xl text-xs outline-none focus:border-slate-400 text-slate-900 font-mono shadow-sm" />
                  <input type="text" name="pr_21k" placeholder="21K" value={formEdicion.pr_21k || ''} onChange={handleChangeEdicion} className="w-full bg-white border border-slate-200 p-2.5 rounded-xl text-xs outline-none focus:border-slate-400 text-slate-900 font-mono shadow-sm" />
                  <input type="text" name="pr_42k" placeholder="42K" value={formEdicion.pr_42k || ''} onChange={handleChangeEdicion} className="w-full bg-white border border-slate-200 p-2.5 rounded-xl text-xs outline-none focus:border-slate-400 text-slate-900 font-mono shadow-sm" />
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-3 pt-6">
                <button type="button" onClick={() => setEditando(null)} className="flex-1 py-4 rounded-2xl font-bold text-slate-500 bg-slate-100 hover:bg-slate-200 transition-all active:scale-[0.98]">Cancelar</button>
                <button type="submit" disabled={guardando} className="flex-[2] py-4 rounded-2xl font-black uppercase text-white bg-slate-900 hover:bg-black shadow-lg shadow-slate-900/10 transition-all active:scale-[0.98] disabled:opacity-50">
                  {guardando ? 'Guardando cambios...' : 'Guardar Cambios'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}
    </section>
  );
}
