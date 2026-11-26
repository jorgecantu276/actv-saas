'use client';


import type { Athlete, RaceEvent, StaffProfile, StaffScreenProps } from '../lib/legacy-types';
import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import SaleReceipt from './SaleReceipt';
import { loadSaleReceipt, type SaleReceipt as SaleReceiptData } from '../lib/sale-receipt';
import { Search, PlusCircle, X, Ticket, UserPlus, Printer, Calendar, Store, Users, Map as MapIcon, Flag, ChevronDown } from 'lucide-react';
import CajaCobros, { type Cart, type StaffOrder } from './CajaCobros';



export default function TabCaja({ atletas, eventos, recargarDatos, userRole, userId }: Omit<StaffScreenProps, 'clubes'>) {

  const [enviando, setEnviando] = useState(false);
  const [atletasSeleccionados, setAtletasSeleccionados] = useState<Athlete[]>([]);
  const [eventoSeleccionado, setEventoSeleccionado] = useState<RaceEvent | null>(null);

  const [paquetesAtletas, setPaquetesAtletas] = useState<Record<string, 1 | 2>>({});

  const [busquedaAtleta, setBusquedaAtleta] = useState('');
  const [mostrarDropdown, setMostrarDropdown] = useState(false);
  const [showQuickRegister, setShowQuickRegister] = useState(false);
  const [ticketReciente, setTicketReciente] = useState<SaleReceiptData | null>(null);

  const [cobroEnCurso, setCobroEnCurso] = useState(false);

  const [idReimpresion, setIdReimpresion] = useState('');
  const [esRelevo, setEsRelevo] = useState(false);

  const [verTodosEventos, setVerTodosEventos] = useState(false);
  const [rolReal, setRolReal] = useState(userRole || '');
  const [misEventosPermitidos, setMisEventosPermitidos] = useState<string[]>([]);
  const [clubesDB, setClubesDB] = useState<string[]>([]);
  const [receiptReprint, setReceiptReprint] = useState(false);

  const [aceptoTerminos, setAceptoTerminos] = useState(false);

  const [ladaTelefono, setLadaTelefono] = useState('+52');
  const [ladaEmergencia, setLadaEmergencia] = useState('+52');

  const [cuposOcupados, setCuposOcupados] = useState<Record<string, number>>({});

  const [formQuickAtleta, setFormQuickAtleta] = useState({
    nombre: '', apellido: '', genero: 'Hombre', telefono: '', email: '', talla_playera: '', ciudad: 'Matamoros',
    telefono_emergencia: '', fecha_nacimiento: '', club: ''
  });

  useEffect(() => {
    const cargarDatosIniciales = async () => {
      if (userId) {
        const { data: perfil, error: errPerfil } = await supabase.from('perfiles').select('*').eq('id', userId).maybeSingle();
        const perfilData = perfil as StaffProfile | null;

        if (perfilData && !errPerfil) {
          const dbRol = String(perfilData.rol || '').toLowerCase();
          setRolReal(perfilData.rol || userRole || '');

          if (dbRol.includes('admin') || dbRol.includes('pdv')) {
            setVerTodosEventos(true);
          } else {
            let evAsignados: string[] | string = perfilData.eventos_asignados || perfilData.eventos_assigned || [];
            if (typeof evAsignados === 'string') {
              const rawAssigned = evAsignados;
              try { evAsignados = JSON.parse(rawAssigned); } catch { evAsignados = [rawAssigned]; }
            }
            if (Array.isArray(evAsignados)) {
              setMisEventosPermitidos(evAsignados);
            }
          }
        }
      } else {
        const rLower = String(userRole || '').toLowerCase();
        if (rLower.includes('admin') || rLower.includes('pdv')) {
          setVerTodosEventos(true);
        }
      }

      const { data: clubesData } = await supabase.from('clubes').select('nombre');
      if (clubesData) setClubesDB(clubesData.map((c) => c.nombre));
    };

    cargarDatosIniciales();
  }, [userId, userRole]);

  const rawClubs = [...clubesDB, ...(atletas || []).map((a) => a.club)].filter(Boolean);
  const clubesExistentes = Array.from(new Set(rawClubs)).map(c => String(c).trim()).sort((a, b) => a.localeCompare(b, 'es', { numeric: true, sensitivity: 'base' }));

  const eventosSeguros = eventos || [];
  const eventosVisibles = verTodosEventos
    ? eventosSeguros
    : eventosSeguros.filter((ev) => misEventosPermitidos.includes(ev.id));

  const idsEventos = eventosVisibles.map((evento: { id: string }) => evento.id).join(',');
  useEffect(() => {
    if (!idsEventos) return;
    let active = true;
    void (async () => {
      const { data, error } = await supabase.rpc('actv_availability', { p_event_ids: idsEventos.split(',') });
      if (active) {
        if (error) setCuposOcupados({});
        else setCuposOcupados(Object.fromEntries(
          (data as { event_id: string; used: number }[]).map(row => [row.event_id, row.used]),
        ));
      }
    })();
    return () => { active = false; };
  }, [idsEventos, cobroEnCurso]);

  const agregarAtletaLista = (atleta: Athlete) => {
    if (!atletasSeleccionados.some(a => a.id === atleta.id)) {
      setAtletasSeleccionados([...atletasSeleccionados, atleta]);
    }
    setBusquedaAtleta('');
    setMostrarDropdown(false);
  };



  const handleReimprimir = async () => {
    if (!eventoSeleccionado || !idReimpresion.trim()) {
      alert('Selecciona la carrera y escribe el folio original.');
      return;
    }
    try {
      const receipt = await loadSaleReceipt({ p_event_id: eventoSeleccionado.id, p_folio: idReimpresion.trim() });
      setReceiptReprint(true);
      setTicketReciente(receipt);
    } catch (error) { alert(error instanceof Error ? error.message : 'Recibo no disponible.'); }
  };

  const handleSubmitQuickAtleta = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!aceptoTerminos) { alert("Por favor, acepta los términos y condiciones para continuar."); return; }

    const normalizarTexto = (txt: string) =>
      String(txt || '').normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

    const obtenerUltimos4 = (tel: string) =>
      String(tel || '').replace(/\D/g, '').slice(-4);

    const inputNombre = normalizarTexto(formQuickAtleta.nombre);
    const inputApellido = normalizarTexto(formQuickAtleta.apellido);

    const telLimpioInput = formQuickAtleta.telefono.replace(/\D/g, '');
    const telefonoCompletoInput = `${ladaTelefono}${telLimpioInput}`;
    const inputUltimos4 = obtenerUltimos4(telefonoCompletoInput);

    const atletaDuplicado = (atletas || []).find((atl) => {
      const atlNombre = normalizarTexto(atl.nombre);
      const atlApellido = normalizarTexto(atl.apellido);
      const atlUltimos4 = obtenerUltimos4(atl.telefono);

      return atlNombre === inputNombre && atlApellido === inputApellido && atlUltimos4 === inputUltimos4;
    });

    if (atletaDuplicado) {
      alert(`⚠️ ¡Atleta ya registrado!\n\nSe detectó una coincidencia en el sistema:\n• Nombre: ${atletaDuplicado.nombre} ${atletaDuplicado.apellido}\n• Teléfono: ${atletaDuplicado.telefono}\n\nNo es necesario crearlo de nuevo, búscalo directamente en la barra superior para agregarlo a la venta.`);
      return;
    }

    setEnviando(true);
    const datos: Record<keyof typeof formQuickAtleta, string | null> & { usuario_id?: string | null } = { ...formQuickAtleta };
    if (!datos.email || datos.email.trim() === '') datos.email = null;
    if (!datos.fecha_nacimiento || datos.fecha_nacimiento.trim() === '') datos.fecha_nacimiento = null;
    if (!datos.club || datos.club.trim() === '') datos.club = null;

    const emerLimpio = formQuickAtleta.telefono_emergencia.replace(/\D/g, '');

    datos.telefono = telefonoCompletoInput;
    datos.telefono_emergencia = `${ladaEmergencia}${emerLimpio}`;
    datos.usuario_id = userId;

    const { data, error } = await supabase.from('atletas').insert([datos]).select();
    if (error) {
      alert("Error al registrar: " + error.message);
    } else if (data) {
      agregarAtletaLista(data[0]);
      setShowQuickRegister(false);
      setAceptoTerminos(false);
      setFormQuickAtleta({ nombre: '', apellido: '', genero: 'Hombre', telefono: '', email: '', talla_playera: '', ciudad: 'Matamoros', telefono_emergencia: '', fecha_nacimiento: '', club: '' });
      setPaquetesAtletas({});
      if (recargarDatos) recargarDatos();
    }
    setEnviando(false);
  };

  const paquete = (athleteId: string, index: number): 1 | 2 =>
    paquetesAtletas[athleteId] ?? (esRelevo && index > 0 && eventoSeleccionado?.precio_2 ? 2 : 1);
  const carrito: Cart | null = eventoSeleccionado && atletasSeleccionados.length ? {
    eventId: eventoSeleccionado.id,
    relay: esRelevo && atletasSeleccionados.length > 1,
    items: atletasSeleccionados.map((athlete, index) => ({
      athlete_id: athlete.id,
      package: paquete(athlete.id, index),
    })),
  } : null;
  const totalEstimado = eventoSeleccionado ? carrito?.items.reduce((total, item) =>
    total + Math.round(Number(item.package === 2 ? eventoSeleccionado.precio_2 : eventoSeleccionado.precio_1) * 100),
  0) ?? 0 : 0;
  const mostrarRecibo = async (order: StaffOrder) => {
    if (order.state !== 'issued') return;
    const receipt = await loadSaleReceipt({ p_order_id: order.order_id });
    setReceiptReprint(false);
    setTicketReciente(receipt);
    setAtletasSeleccionados([]);
    setEventoSeleccionado(null);
    setPaquetesAtletas({});
    setEsRelevo(false);
    if (recargarDatos) recargarDatos();
  };

  return (
    <section className="flex flex-col relative pb-16 animate-in fade-in slide-in-from-bottom-2 duration-500">



      {/* MENÚ SUPERIOR TIPO WORDPRESS ADMIN */}
      <div className="bg-white border-b border-slate-200 px-5 py-3 flex flex-col md:flex-row justify-between items-center gap-4 shadow-sm rounded-t-2xl no-print z-10">
        <div className="flex items-center gap-4">
          <img
            src="/actv-wordmark.svg"
            alt="logo actv"
            className="h-9 w-auto object-contain transition-transform duration-300 hover:scale-105"
          />
          <div className="flex flex-col">
            <h1 className="text-sm font-black uppercase tracking-tight text-slate-900 flex items-center leading-none">
              {String(rolReal).toLowerCase().includes('pdv') ? <Store className="w-4 h-4 mr-1.5 text-emerald-500" /> : <Ticket className="w-4 h-4 mr-1.5 text-blue-600" />}
              Punto de Venta
            </h1>
            <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-1">
              Acceso: <span className={String(rolReal).toLowerCase().includes('pdv') ? 'text-emerald-600' : 'text-blue-600'}>{rolReal || userRole}</span>
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 w-full md:w-auto justify-end">
          <div className="flex bg-slate-50 border border-slate-200/80 rounded-xl overflow-hidden focus-within:ring-2 focus-within:ring-slate-900/5 focus-within:border-slate-400 transition-all">
            <input
              type="text"
              placeholder="Reimprimir (Ej. 080)"
              className="px-3.5 py-2 text-xs outline-none w-full md:w-40 bg-transparent text-slate-900 placeholder:text-slate-400 font-medium tracking-wide"
              value={idReimpresion}
              onChange={(e) => setIdReimpresion(e.target.value)}
            />
            <button type="button" onClick={handleReimprimir} className="bg-slate-100 text-slate-600 px-3.5 hover:bg-slate-200 hover:text-slate-900 transition-colors border-l border-slate-200/80">
              <Printer size={14}/>
            </button>
          </div>
          <button
            type="button"
            onClick={() => { setLadaTelefono('+52'); setLadaEmergencia('+52'); setShowQuickRegister(true); }}
            disabled={cobroEnCurso}
            className="bg-slate-900 text-white text-xs font-semibold py-2 px-4 rounded-xl flex items-center hover:bg-black transition-all shadow-sm active:scale-[0.98] disabled:opacity-45"
          >
            <UserPlus className="w-4 h-4 mr-1.5"/> Nuevo Atleta
          </button>
        </div>
      </div>

      {/* ÁREA DE TRABAJO PRINCIPAL */}
      <div className="bg-white p-5 md:p-8 flex-grow rounded-b-2xl shadow-sm border-x border-b border-slate-200 w-full no-print">
        <fieldset disabled={cobroEnCurso} inert={cobroEnCurso} className="space-y-8 disabled:opacity-60">

          <div className="md:col-span-2 relative">
            <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">1. Buscar y Agregar Corredores *</label>
            <div className="relative">
              <Search className="absolute left-4 top-3.5 h-4 w-4 text-slate-400" />
              <input type="text" placeholder="Nombre o teléfono..." value={busquedaAtleta} onChange={(e) => {setBusquedaAtleta(e.target.value); setMostrarDropdown(true);}} onFocus={() => setMostrarDropdown(true)} className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 pl-11 outline-none focus:border-slate-400 focus:ring-4 focus:ring-slate-900/5 text-slate-900 placeholder:text-slate-400 text-sm shadow-sm transition-all" />
            </div>

            {mostrarDropdown && busquedaAtleta && (
              <ul className="absolute z-20 w-full bg-white border border-slate-200 shadow-xl rounded-xl mt-2 overflow-hidden max-h-60 overflow-y-auto divide-y divide-slate-50">
                {(atletas || []).filter((a) => (a.nombre + ' ' + a.apellido + ' ' + a.telefono).toLowerCase().includes(busquedaAtleta.toLowerCase())).slice(0, 20).map((a) => (
                  <li key={a.id} className="p-3.5 hover:bg-slate-50 cursor-pointer flex justify-between items-center transition-colors" onClick={() => agregarAtletaLista(a)}>
                    <div><p className="font-bold text-slate-900 text-sm">{a.nombre} {a.apellido}</p><p className="text-[11px] font-medium text-slate-500 mt-0.5">{a.telefono}</p></div>
                    <PlusCircle className="text-slate-400 w-5 h-5 hover:text-slate-900 transition-colors" />
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-3 flex flex-wrap gap-2">
              {atletasSeleccionados.map(a => (
                <span key={a.id} className="bg-slate-900 text-white text-xs font-medium px-3.5 py-1.5 rounded-lg flex items-center gap-2 shadow-sm animate-in fade-in zoom-in duration-150">
                  {a.nombre} {a.apellido} <X className="w-3.5 h-3.5 cursor-pointer text-slate-400 hover:text-white transition-colors" onClick={() => setAtletasSeleccionados(atletasSeleccionados.filter(x => x.id !== a.id))} />
                </span>
              ))}
            </div>

            {/* SWITCH PARA RELEVOS */}
            {atletasSeleccionados.length > 1 && (
              <div className="mt-4 flex items-center bg-slate-50 border border-slate-200/80 p-4 rounded-xl animate-in fade-in duration-200">
                <input
                  type="checkbox"
                  id="toggleRelevo"
                  checked={esRelevo}
                  onChange={(e) => {
                    setEsRelevo(e.target.checked);
                    setPaquetesAtletas({});
                  }}
                  className="w-4 h-4 text-slate-900 bg-white border-slate-300 rounded focus:ring-slate-900 cursor-pointer"
                />
                <label htmlFor="toggleRelevo" className="ml-3 text-[11px] font-bold text-slate-700 uppercase tracking-wider cursor-pointer select-none">
                  Modo Relevos / Equipo (Compartir mismo número base con letras A, B, C)
                </label>
              </div>
            )}
          </div>

          <div className="pt-2 border-t border-slate-100">
            <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-4 mt-4">
              2. {!verTodosEventos ? 'Seleccionar Carrera Permitida *' : 'Seleccionar Carrera *'}
            </label>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-5 max-h-[650px] overflow-y-auto pb-4 pt-1 px-1 custom-scrollbar">
              {eventosVisibles.map((ev) => {
                const foliosUsados = cuposOcupados[String(ev.id)];
                const lugaresDisponibles = ev.cupo_maximo == null || foliosUsados === undefined
                  ? null
                  : Number(ev.cupo_maximo) - foliosUsados;
                const agotado = lugaresDisponibles !== null && lugaresDisponibles <= 0;
                const esSeleccionado = eventoSeleccionado?.id === ev.id;

                return (
                  <div key={ev.id} onClick={() => {
                    if(!agotado) {
                      setPaquetesAtletas({});
                      setEventoSeleccionado(ev);
                    }
                  }} className={`relative flex flex-col h-full bg-white rounded-2xl transition-all duration-300 overflow-hidden group border ${agotado ? 'opacity-50 cursor-not-allowed border-slate-200 bg-slate-50' : esSeleccionado ? 'border-slate-900 shadow-md scale-[1.01] z-10' : 'border-slate-200 shadow-sm hover:shadow-md hover:border-slate-300 cursor-pointer'}`}>

                    <div className="w-full aspect-[3/4] bg-slate-50 shrink-0 relative overflow-hidden">
                      {ev.imagen_evento ? (
                        <img src={ev.imagen_evento} className={`w-full h-full object-cover object-center transition-transform duration-500 ${agotado ? 'grayscale' : 'group-hover:scale-[1.03]'}`} alt="poster" />
                      ) : (
                        <div className={`w-full h-full ${agotado ? 'bg-slate-200' : 'bg-slate-900'}`}></div>
                      )}
                    </div>

                    <div className="p-4 flex flex-col flex-grow justify-between gap-3 bg-white">
                      <h4 className="font-bold text-slate-900 text-sm leading-snug line-clamp-2 group-hover:text-black transition-colors">{ev.nombre_carrera}</h4>

                      <div className="flex flex-col gap-2 mt-auto pt-2 border-t border-slate-50">
                        <span className="text-[10px] text-slate-400 font-bold flex items-center tracking-wide"><Calendar className="w-3.5 h-3.5 mr-1.5 text-slate-400"/>{ev.fecha}</span>
                        <div className="flex justify-between items-center w-full mt-1">
                          <span className={`text-[9px] font-black px-2 py-0.5 rounded-md uppercase tracking-wider ${agotado ? 'text-slate-500 bg-slate-100' : 'text-slate-900 bg-slate-100'}`}>
                            {agotado ? 'Agotado' : lugaresDisponibles === null ? 'Verificar cupo' : `${lugaresDisponibles} cupos`}
                          </span>
                          <span className="text-[10px] font-black text-slate-500 bg-slate-50 px-2 py-0.5 rounded-md border border-slate-100">{ev.distancia}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
              {eventosVisibles.length === 0 && (
                  <div className="col-span-full py-12 text-center bg-slate-50 rounded-2xl border border-dashed border-slate-200 text-slate-400 font-medium">
                      No tienes carreras asignadas para vender en este momento. Contacta al administrador para habilitar tus permisos en tu perfil.
                  </div>
              )}
            </div>
          </div>

          {/* DESGLOSE DE COBRO INDIVIDUAL POR CORREDOR */}
          {eventoSeleccionado && atletasSeleccionados.length > 0 && (
            <div className="bg-slate-50 p-5 rounded-2xl border border-slate-200 animate-in fade-in slide-in-from-bottom-2 duration-200">
              <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-3">3. Desglose de Paquetes *</label>

              <div className="space-y-2.5">
                {atletasSeleccionados.map((a, index) => {
                  const currentPkg = paquete(a.id, index);
                  const labelRelevo = index === 0 ? 'Capitán / Titular (Costo Base)' : `Corredor ${index + 1} (Relevo Adicional)`;

                  return (
                    <div key={a.id} className="flex flex-col sm:flex-row justify-between items-start sm:items-center bg-white p-4 rounded-xl border border-slate-200 shadow-sm gap-3 transition-all hover:border-slate-300">
                      <div>
                        <p className="font-bold text-slate-900 text-sm tracking-tight">{a.nombre} {a.apellido}</p>
                        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1">{esRelevo ? labelRelevo : `Corredor ${index + 1}`}</p>
                      </div>

                      <div className="relative w-full sm:w-auto">
                        <select
                          value={currentPkg}
                          onChange={(e) => {
                            setPaquetesAtletas({
                              ...paquetesAtletas,
                              [a.id]: e.target.value === '2' ? 2 : 1,
                            });
                          }}
                          className="w-full sm:w-64 bg-slate-50 border border-slate-200 text-slate-900 text-xs font-bold rounded-lg px-3 py-2.5 outline-none focus:border-slate-400 transition-all cursor-pointer appearance-none pr-8"
                        >
                          <option value={1}>{eventoSeleccionado.nombre_precio_1} - ${eventoSeleccionado.precio_1}</option>
                          {eventoSeleccionado.precio_2 && (
                            <option value={2}>{eventoSeleccionado.nombre_precio_2} - ${eventoSeleccionado.precio_2}</option>
                          )}
                        </select>
                        <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

        </fieldset>
        <div className="mt-6">
          {userId && <CajaCobros userId={userId} cart={carrito} estimate={totalEstimado} onLock={setCobroEnCurso} onReceipt={mostrarRecibo} />}
        </div>
      </div>

      {/* BARRA DE ESTADO INFERIOR FIJA */}
      <div className="fixed bottom-0 left-0 right-0 bg-white/90 backdrop-blur-md text-slate-500 px-4 py-3 flex justify-between items-center text-[10px] sm:text-xs font-bold z-40 no-print border-t border-slate-200/80">
        <div className="flex items-center gap-2"><Users className="w-3.5 h-3.5 text-slate-400 hidden sm:block"/><span>ATLETAS: <span className="text-slate-900 font-black">{atletas?.length || 0}</span></span></div>
        <div className="flex items-center gap-2"><Flag className="w-3.5 h-3.5 text-slate-400 hidden sm:block"/><span>CLUBES: <span className="text-slate-900 font-black">{clubesExistentes.length}</span></span></div>
        <div className="flex items-center gap-2"><MapIcon className="w-3.5 h-3.5 text-slate-400 hidden sm:block"/><span>CARRERAS: <span className="text-slate-900 font-black">{eventos?.length || 0}</span></span></div>
      </div>

      {/* ========================================================== */}
      {/* MODAL REGISTRO EXPRESS */}
      {/* ========================================================== */}
      {showQuickRegister && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-[9999] p-4 no-print overflow-y-auto">
          <div className="bg-white p-6 md:p-10 max-w-xl w-full rounded-3xl shadow-2xl relative my-auto border border-slate-200/80 animate-in zoom-in-95 duration-200 max-h-[90vh] overflow-y-auto custom-scrollbar">
            <button type="button" onClick={() => setShowQuickRegister(false)} className="absolute top-5 right-5 text-slate-400 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 p-1.5 rounded-full transition-colors z-20"><X size={18}/></button>

            <div className="text-center mb-6">
              <div className="bg-slate-50 border border-slate-100 w-12 h-12 rounded-xl flex items-center justify-center mx-auto mb-3">
                <UserPlus className="w-6 h-6 text-slate-900"/>
              </div>
              <h3 className="text-xl font-black text-slate-900 tracking-tight">Registro Express</h3>
              <p className="text-xs font-medium text-slate-400 mt-1">Añade un nuevo atleta al padrón instantáneamente.</p>
            </div>

            <form onSubmit={handleSubmitQuickAtleta} className="space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider pl-1">Nombre(s) *</label>
                  <input required value={formQuickAtleta.nombre} onChange={(e) => setFormQuickAtleta({...formQuickAtleta, nombre: e.target.value})} className="w-full bg-slate-50 border border-slate-200 p-3 rounded-xl outline-none text-slate-900 focus:border-slate-400 focus:ring-4 focus:ring-slate-900/5 transition-all text-sm font-medium" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider pl-1">Apellido(s) *</label>
                  <input required value={formQuickAtleta.apellido} onChange={(e) => setFormQuickAtleta({...formQuickAtleta, apellido: e.target.value})} className="w-full bg-slate-50 border border-slate-200 p-3 rounded-xl outline-none text-slate-900 focus:border-slate-400 focus:ring-4 focus:ring-slate-900/5 transition-all text-sm font-medium" />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider pl-1">Género</label>
                  <select value={formQuickAtleta.genero} onChange={(e) => setFormQuickAtleta({...formQuickAtleta, genero: e.target.value})} className="w-full bg-slate-50 border border-slate-200 p-3 rounded-xl outline-none text-slate-900 focus:border-slate-400 transition-all text-sm font-semibold appearance-none bg-[url('data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2224%22%20height%3D%2224%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%2394a3b8%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpolyline%20points%3D%226%209%2012%2015%2018%209%22%3E%3C%2Fpolyline%3E%3C%2Fsvg%3E')] bg-no-repeat bg-[right_12px_center] bg-[length:16px_16px] pr-8 cursor-pointer">
                    <option>Hombre</option><option>Mujer</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider pl-1">Talla Playera *</label>
                  <select required value={formQuickAtleta.talla_playera} onChange={(e) => setFormQuickAtleta({...formQuickAtleta, talla_playera: e.target.value})} className="w-full bg-slate-50 border border-slate-200 p-3 rounded-xl outline-none text-slate-900 focus:border-slate-400 transition-all text-sm font-semibold appearance-none bg-[url('data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2224%22%20height%3D%2224%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%2394a3b8%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpolyline%20points%3D%226%209%2012%2015%2018%209%22%3E%3C%2Fpolyline%3E%3C%2Fsvg%3E')] bg-no-repeat bg-[right_12px_center] bg-[length:16px_16px] pr-8 cursor-pointer">
                    <option value="">Seleccionar...</option>
                    <option>XS</option><option>S</option><option>M</option><option>L</option><option>XL</option><option>XXL</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider pl-1">Club / Equipo</label>
                  <select value={formQuickAtleta.club} onChange={(e) => setFormQuickAtleta({...formQuickAtleta, club: e.target.value})} className="w-full bg-slate-50 border border-slate-200 p-3 rounded-xl outline-none text-slate-900 focus:border-slate-400 transition-all text-sm font-semibold appearance-none bg-[url('data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2224%22%20height%3D%2224%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%2394a3b8%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpolyline%20points%3D%226%209%2012%2015%2018%209%22%3E%3C%2Fpolyline%3E%3C%2Fsvg%3E')] bg-no-repeat bg-[right_12px_center] bg-[length:16px_16px] pr-8 cursor-pointer">
                    <option value="">Libre (Opcional)</option>
                    {clubesExistentes.map((club, idx: number) => (
                      <option key={idx} value={club}>{club}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider pl-1">Fecha Nacimiento *</label>
                  <input type="date" required value={formQuickAtleta.fecha_nacimiento} onChange={(e) => setFormQuickAtleta({...formQuickAtleta, fecha_nacimiento: e.target.value})} className="w-full bg-slate-50 border border-slate-200 p-3 rounded-xl outline-none text-slate-900 focus:border-slate-400 transition-all text-sm font-medium" />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider pl-1">Celular *</label>
                  <div className="flex bg-slate-50 border border-slate-200 rounded-xl overflow-hidden focus-within:border-slate-400 focus-within:ring-4 focus-within:ring-slate-900/5 transition-all">
                    <select
                      value={ladaTelefono}
                      onChange={(e) => setLadaTelefono(e.target.value)}
                      className="bg-slate-100 border-r border-slate-200 text-xs font-bold px-3 py-3 outline-none text-slate-700 cursor-pointer"
                    >
                      <option value="+52">🇲🇽 +52</option>
                      <option value="+1">🇺🇸 +1</option>
                    </select>
                    <input required type="tel" placeholder="10 dígitos" value={formQuickAtleta.telefono} onChange={(e) => setFormQuickAtleta({...formQuickAtleta, telefono: e.target.value})} className="w-full bg-transparent p-3 outline-none text-slate-900 text-sm font-medium" />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider pl-1 text-red-500">Emergencia *</label>
                  <div className="flex bg-red-50/30 border border-red-200 rounded-xl overflow-hidden focus-within:border-red-400 focus-within:ring-4 focus-within:ring-red-900/5 transition-all">
                    <select
                      value={ladaEmergencia}
                      onChange={(e) => setLadaEmergencia(e.target.value)}
                      className="bg-red-100/40 border-r border-red-200 text-xs font-bold px-3 py-3 outline-none text-slate-700 cursor-pointer"
                    >
                      <option value="+52">🇲🇽 +52</option>
                      <option value="+1">🇺🇸 +1</option>
                    </select>
                    <input type="tel" required placeholder="10 dígitos" value={formQuickAtleta.telefono_emergencia} onChange={(e) => setFormQuickAtleta({...formQuickAtleta, telefono_emergencia: e.target.value})} className="w-full bg-transparent p-3 outline-none text-slate-900 text-sm font-medium" />
                  </div>
                </div>

                <div className="sm:col-span-2 space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider pl-1">Ciudad Residencia *</label>
                  <input required value={formQuickAtleta.ciudad} className="w-full bg-slate-50 border border-slate-200 p-3 rounded-xl outline-none text-slate-900 focus:border-slate-400 transition-all text-sm font-medium" onChange={(e) => setFormQuickAtleta({...formQuickAtleta, ciudad: e.target.value})} />
                </div>
              </div>

              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 mt-6">
                <div className="flex items-start">
                  <div className="flex items-center h-5">
                    <input id="terminos" type="checkbox" required checked={aceptoTerminos} onChange={(e) => setAceptoTerminos(e.target.checked)} className="h-4 w-4 border-slate-300 rounded text-slate-900 focus:ring-slate-900" />
                  </div>
                  <div className="ml-3 text-sm">
                    <label htmlFor="terminos" className="font-bold text-slate-800 cursor-pointer select-none">Acepto Términos y Condiciones *</label>
                    <p className="text-[10px] font-medium text-slate-500 mt-0.5 leading-tight">El corredor declara que asume los riesgos y se encuentra en condiciones óptimas.</p>
                  </div>
                </div>
              </div>

              <button type="submit" disabled={enviando || !aceptoTerminos} className={`w-full text-white py-3.5 rounded-xl font-bold text-sm shadow-sm transition-all active:scale-[0.98] mt-2 ${aceptoTerminos ? 'bg-slate-900 hover:bg-black' : 'bg-slate-300 cursor-not-allowed'}`}>
                {enviando ? 'Registrando...' : 'Confirmar y Agregar'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* POPUP DE CONFIRMACIÓN DE VENTA NORMAL */}
      {ticketReciente && <SaleReceipt receipt={ticketReciente} reprint={receiptReprint} onClose={() => setTicketReciente(null)} />}

    </section>
  );
}
