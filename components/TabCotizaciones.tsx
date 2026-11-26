'use client';


import { useClientReady } from '../lib/use-client-ready';
import type { Client, Service, Quote, StaffScreenProps } from '../lib/legacy-types';
import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../lib/supabase';
import { FileText, Users, Briefcase, PlusCircle, X, Calculator, Percent, CheckCircle, Printer, Mail, Phone, Calendar, Edit, Trash2, Search, MessageCircle, ChevronLeft, ChevronRight, ChevronDown, ArrowUpDown } from 'lucide-react';

export default function TabCotizaciones({ userRole }: Pick<StaffScreenProps, 'userRole'>) {
  const isMounted = useClientReady();

  const [clientes, setClientes] = useState<Client[]>([]);
  const [servicios, setServicios] = useState<Service[]>([]);
  const [cotizaciones, setCotizaciones] = useState<Quote[]>([]);

  const [showModalCliente, setShowModalCliente] = useState(false);
  const [showModalServicio, setShowModalServicio] = useState(false);
  const [showModalCotizacion, setShowModalCotizacion] = useState(false);

  const [cotizacionParaImprimir, setCotizacionParaImprimir] = useState<Quote | null>(null);
  const [tipoImpresion, setTipoImpresion] = useState<'carta' | 'ticket' | null>(null);

  const [editandoServicio, setEditandoServicio] = useState<Service | null>(null);
  const [formEditServicio, setFormEditServicio] = useState({ nombre: '', precio_unitario: '', tipo_cobro: 'Fijo' });

  const [formCliente, setFormCliente] = useState({ nombre_completo: '', empresa_o_club: '', telefono: '', email: '' });
  const [formServicio, setFormServicio] = useState({ nombre: '', precio_unitario: '', tipo_cobro: 'Fijo' });
  const [formCotizacion, setFormCotizacion] = useState({
    cliente_id: '', nombre_evento: '', fecha_evento: '', asistentes_esperados: 0, descuento: 0, tipo_descuento: 'Fijo'
  });
  const [serviciosSeleccionados, setServiciosSeleccionados] = useState<string[]>([]);
  const [guardando, setGuardando] = useState(false);

  const [preciosCustom, setPreciosCustom] = useState<Record<string, string | number>>({});

  const [busquedaCotizacion, setBusquedaCotizacion] = useState('');
  const [ordenCotizacion, setOrdenCotizacion] = useState('reciente');

  const [paginaActual, setPaginaActual] = useState(1);
  const cotizacionesPorPagina = 25;
  const cambiarBusquedaCotizacion = (value: string) => { setBusquedaCotizacion(value); setPaginaActual(1); };
  const cambiarOrdenCotizacion = (value: string) => { setOrdenCotizacion(value); setPaginaActual(1); };


  const consultarDatosB2B = useCallback(() => Promise.all([
    supabase.from('clientes').select('*').order('created_at', { ascending: false }),
    supabase.from('servicios').select('*').order('nombre', { ascending: true }),
    supabase.from('cotizaciones').select('*, clientes(*)').order('created_at', { ascending: false }),
  ]), []);
  const aplicarDatosB2B = useCallback(([resClientes, resServicios, resCotizaciones]: Awaited<ReturnType<typeof consultarDatosB2B>>) => {
    if (resClientes.data) setClientes(resClientes.data);
    if (resServicios.data) setServicios(resServicios.data);
    if (resCotizaciones.data) setCotizaciones(resCotizaciones.data);
  }, []);
  const cargarDatosB2B = async () => aplicarDatosB2B(await consultarDatosB2B());

  useEffect(() => {
    let active = true;
    void consultarDatosB2B().then(result => { if (active) aplicarDatosB2B(result); });
    return () => { active = false; };
  }, [consultarDatosB2B, aplicarDatosB2B]);


  const calcularTotales = () => {
    let subtotal = 0;
    const asistentes = Number(formCotizacion.asistentes_esperados) || 0;
    const descuentoValor = Number(formCotizacion.descuento) || 0;

    serviciosSeleccionados.forEach(id => {
      const srv = servicios.find(s => s.id === id);
      if (srv) {
        const precioActual = preciosCustom[srv.id] !== undefined ? Number(preciosCustom[srv.id]) : Number(srv.precio_unitario);
        subtotal += (srv.tipo_cobro === 'Por Atleta') ? (precioActual * asistentes) : precioActual;
      }
    });

    let totalDescuentoDinero = 0;
    if (formCotizacion.tipo_descuento === 'Fijo') {
      totalDescuentoDinero = descuentoValor;
    } else if (formCotizacion.tipo_descuento === 'Porcentaje') {
      totalDescuentoDinero = subtotal * (descuentoValor / 100);
    } else if (formCotizacion.tipo_descuento === 'Por Atleta') {
      totalDescuentoDinero = descuentoValor * asistentes;
    }

    const subtotalConDescuento = subtotal - totalDescuentoDinero;
    const iva = subtotalConDescuento > 0 ? subtotalConDescuento * 0.16 : 0;
    const total = (subtotalConDescuento > 0 ? subtotalConDescuento : 0) + iva;

    return { subtotal, iva, descuento: totalDescuentoDinero, total };
  };

  const { subtotal, iva, total, descuento: montoDescuentoCalculado } = calcularTotales();

  const manejarImpresion = (cot: Quote, formato: 'carta' | 'ticket') => {
    setTipoImpresion(formato);
    setCotizacionParaImprimir(cot);
    setTimeout(() => {
      window.print();
    }, 500);
  };

  const enviarWhatsApp = (cot: Quote) => {
    const telefonoOriginal = cot.clientes?.telefono || '';
    const telefonoLimpio = telefonoOriginal.replace(/\D/g, '');

    const tipoDesc = cot.tipo_descuento || 'Fijo';
    let txtDesc = '';
    if (parseFloat(String(cot.descuento)) > 0) {
      if (tipoDesc === 'Porcentaje') txtDesc = `\nDescuento: ${cot.descuento}%`;
      else if (tipoDesc === 'Por Atleta') txtDesc = `\nDescuento: $${cot.descuento} x Atleta`;
      else txtDesc = `\nDescuento: $${cot.descuento} MXN`;
    }

    const msj = `Hola ${cot.clientes?.nombre_completo || 'Cliente'}, le compartimos el resumen de su cotización de ACTV:\n\n*COT-${String(cot.folio).padStart(4, '0')}*\nEvento: ${cot.nombre_evento}\nAtletas Proyectados: ${cot.asistentes_esperados}\n${txtDesc}\n*Total Neto: $${parseFloat(String(cot.total)).toLocaleString('es-MX')} MXN*\n\nSi desea ver el documento completo en PDF, háganoslo saber. ¡Estamos a sus órdenes!\n\nactv.mx`;
    window.open(`https://wa.me/${telefonoLimpio}?text=${encodeURIComponent(msj)}`, '_blank');
  };

  const handleGuardarCliente = async (e: React.FormEvent) => {
    e.preventDefault();
    setGuardando(true);
    const { error } = await supabase.from('clientes').insert([formCliente]);
    if (!error) { setShowModalCliente(false); setFormCliente({ nombre_completo: '', empresa_o_club: '', telefono: '', email: '' }); cargarDatosB2B(); }
    setGuardando(false);
  };

  const handleGuardarServicio = async (e: React.FormEvent) => {
    e.preventDefault();
    setGuardando(true);
    const { error } = await supabase.from('servicios').insert([formServicio]);
    if (!error) { setShowModalServicio(false); setFormServicio({ nombre: '', precio_unitario: '', tipo_cobro: 'Fijo' }); cargarDatosB2B(); }
    setGuardando(false);
  };

  const abrirEdicionServicio = (srv: Service) => {
    setEditandoServicio(srv);
    setFormEditServicio({ nombre: srv.nombre, precio_unitario: srv.precio_unitario, tipo_cobro: srv.tipo_cobro });
  };

  const handleActualizarServicio = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editandoServicio) return;
    setGuardando(true);
    const { error } = await supabase.from('servicios').update(formEditServicio).eq('id', editandoServicio.id);
    if (!error) { setEditandoServicio(null); cargarDatosB2B(); }
    setGuardando(false);
  };

  const handleEliminarServicio = async (id: string, nombre: string) => {
    if (window.confirm(`¿Estás seguro de eliminar el servicio "${nombre}" del catálogo general?`)) {
      const { error } = await supabase.from('servicios').delete().eq('id', id);
      if (!error) cargarDatosB2B();
      else alert("No se pudo eliminar: " + error.message);
    }
  };

  const handleGuardarCotizacion = async (e: React.FormEvent) => {
    e.preventDefault();
    const serviciosElegidos = serviciosSeleccionados
      .map(id => servicios.find(service => service.id === id))
      .filter((service): service is Service => service !== undefined);
    if (serviciosElegidos.length !== serviciosSeleccionados.length) {
      alert('Un servicio seleccionado ya no está disponible. Revisa la cotización.');
      return;
    }
    setGuardando(true);

    const carrito = serviciosElegidos.map(srv => {
      const precioFinal = preciosCustom[srv.id] !== undefined ? Number(preciosCustom[srv.id]) : Number(srv.precio_unitario);

      return {
        id: srv.id,
        nombre: srv.nombre,
        precio_unitario: precioFinal,
        tipo: srv.tipo_cobro,
        total_linea: (srv.tipo_cobro === 'Por Atleta') ? (precioFinal * formCotizacion.asistentes_esperados) : precioFinal
      };
    });

    const nuevaCotizacion = {
      cliente_id: formCotizacion.cliente_id,
      nombre_evento: formCotizacion.nombre_evento,
      fecha_evento: formCotizacion.fecha_evento || null,
      asistentes_esperados: formCotizacion.asistentes_esperados,
      descuento: montoDescuentoCalculado,
      tipo_descuento: formCotizacion.tipo_descuento,
      desglose_servicios: carrito,
      subtotal,
      iva,
      total
    };

    const { error } = await supabase.from('cotizaciones').insert([nuevaCotizacion]);
    if (!error) {
      setShowModalCotizacion(false);
      setFormCotizacion({ cliente_id: '', nombre_evento: '', fecha_evento: '', asistentes_esperados: 0, descuento: 0, tipo_descuento: 'Fijo' });
      setServiciosSeleccionados([]);
      setPreciosCustom({});
      cargarDatosB2B();
    } else {
      const { error: err2 } = await supabase.from('cotizaciones').insert([{
        cliente_id: formCotizacion.cliente_id, nombre_evento: formCotizacion.nombre_evento, fecha_evento: formCotizacion.fecha_evento || null, asistentes_esperados: formCotizacion.asistentes_esperados,
        descuento: montoDescuentoCalculado, desglose_servicios: carrito, subtotal, iva, total
      }]);
      if (!err2) {
        setShowModalCotizacion(false); setFormCotizacion({ cliente_id: '', nombre_evento: '', fecha_evento: '', asistentes_esperados: 0, descuento: 0, tipo_descuento: 'Fijo' }); setServiciosSeleccionados([]); setPreciosCustom({}); cargarDatosB2B();
      } else { alert("Error: " + err2.message); }
    }
    setGuardando(false);
  };

  const toggleServicio = (id: string) => {
    if (serviciosSeleccionados.includes(id)) {
      setServiciosSeleccionados(serviciosSeleccionados.filter(sId => sId !== id));
    } else {
      setServiciosSeleccionados([...serviciosSeleccionados, id]);
    }
  };

  const cerrarModalCotizacion = () => {
    setShowModalCotizacion(false);
    setPreciosCustom({});
    setServiciosSeleccionados([]);
  };

  const cotizacionesVisibles = cotizaciones
    .filter(c =>
      c.nombre_evento?.toLowerCase().includes(busquedaCotizacion.toLowerCase()) ||
      c.clientes?.nombre_completo?.toLowerCase().includes(busquedaCotizacion.toLowerCase()) ||
      `COT-${String(c.folio).padStart(4, '0')}`.toLowerCase().includes(busquedaCotizacion.toLowerCase())
    )
    .sort((a, b) => {
      if (ordenCotizacion === 'reciente') return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      if (ordenCotizacion === 'antigua') return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      if (ordenCotizacion === 'az') return (a.nombre_evento || '').localeCompare(b.nombre_evento || '');
      if (ordenCotizacion === 'za') return (b.nombre_evento || '').localeCompare(a.nombre_evento || '');
      return 0;
    });

  const totalPaginasCot = Math.ceil(cotizacionesVisibles.length / cotizacionesPorPagina);
  const indexUltimaCot = paginaActual * cotizacionesPorPagina;
  const indexPrimeraCot = indexUltimaCot - cotizacionesPorPagina;
  const cotizacionesPaginadas = cotizacionesVisibles.slice(indexPrimeraCot, indexUltimaCot);

  if (userRole !== 'Administrador') return null;

  return (
    <section className="animate-in fade-in slide-in-from-bottom-2 duration-500 space-y-8 relative">

      <style jsx global>{`
        @media screen {
          .print-only { display: none !important; }
        }
        @media print {
          html, body { background: white !important; margin: 0 !important; padding: 0 !important; height: auto !important; overflow: visible !important; }
          body > :not(.print-only) { display: none !important; }
          .print-only { display: block !important; position: absolute; top: 0; left: 0; width: 100%; }
          #print-carta { display: block !important; width: 100%; }
          #print-ticket { display: block !important; width: 58mm; padding: 2mm; font-family: 'Courier New', Courier, monospace; font-size: 10pt; font-weight: 700; line-height: 1.2; color: black; }
          ${tipoImpresion === 'carta' ? '@page { size: letter; margin: 10mm; }' : ''}
          ${tipoImpresion === 'ticket' ? '@page { size: 58mm auto; margin: 0; }' : ''}
        }
      `}</style>

      {/* SECCIÓN 1: COTIZACIONES */}
      <div className="space-y-6 no-print">

        {/* CABECERA */}
        <div className="bg-white p-6 md:p-8 rounded-3xl shadow-sm ring-1 ring-slate-200">
          <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center border-b border-slate-100 pb-5 gap-4">
            <div>
              <h2 className="text-xl font-black text-slate-900 tracking-tight flex items-center">
                <FileText className="mr-2.5 text-slate-900 w-6 h-6" /> Cotizaciones Realizadas
              </h2>
              <p className="text-xs font-medium text-slate-500 mt-1">Historial y control de presupuestos B2B emitidos.</p>
            </div>
            <div className="flex flex-wrap gap-2.5 w-full xl:w-auto justify-end">
              <button onClick={() => setShowModalCliente(true)} className="flex-1 md:flex-none justify-center text-xs font-bold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 px-4 py-2.5 rounded-xl flex items-center transition-all shadow-sm active:scale-95"><Users className="w-4 h-4 mr-2 text-slate-400" /> Nuevo Cliente</button>
              <button onClick={() => setShowModalServicio(true)} className="flex-1 md:flex-none justify-center text-xs font-bold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 px-4 py-2.5 rounded-xl flex items-center transition-all shadow-sm active:scale-95"><Briefcase className="w-4 h-4 mr-2 text-slate-400" /> Nuevo Servicio</button>
              <button onClick={() => setShowModalCotizacion(true)} className="w-full md:w-auto justify-center text-xs font-bold text-white bg-slate-900 hover:bg-black px-5 py-2.5 rounded-xl flex items-center shadow-md active:scale-95 transition-all"><PlusCircle className="w-4 h-4 mr-2" /> Nueva Cotización</button>
            </div>
          </div>

          {/* BARRA DE BÚSQUEDA Y FILTROS */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-8">
            <div className="md:col-span-2 relative group">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 group-focus-within:text-slate-900 transition-colors" />
              <input
                type="text"
                placeholder="Buscar por folio, evento o cliente..."
                value={busquedaCotizacion}
                onChange={(e) => cambiarBusquedaCotizacion(e.target.value)}
                className="w-full pl-11 pr-4 py-3 bg-slate-50 border border-slate-200 focus:border-slate-400 focus:ring-4 focus:ring-slate-900/5 rounded-xl outline-none text-sm text-slate-900 placeholder:text-slate-400 font-medium transition-all"
              />
            </div>
            <div className="relative">
              <ArrowUpDown className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
              <select
                value={ordenCotizacion}
                onChange={(e) => cambiarOrdenCotizacion(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 text-slate-900 text-sm rounded-xl pl-11 pr-8 py-3 outline-none focus:border-slate-400 font-bold appearance-none cursor-pointer transition-all"
              >
                <option value="reciente">Más recientes</option>
                <option value="antigua">Más antiguas</option>
                <option value="az">A - Z (Evento)</option>
                <option value="za">Z - A (Evento)</option>
              </select>
              <ChevronDown className="absolute right-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
            </div>
          </div>
        </div>

        {/* TABLA PRINCIPAL */}
        <div className="bg-white rounded-3xl ring-1 ring-slate-200 overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm min-w-[1000px]">
              <thead className="bg-slate-50/50 border-b border-slate-100">
                <tr>
                  <th className="px-6 py-4 font-bold text-slate-400 uppercase text-[10px] tracking-widest">Folio</th>
                  <th className="px-6 py-4 font-bold text-slate-400 uppercase text-[10px] tracking-widest">Fecha de elaboración</th>
                  <th className="px-6 py-4 font-bold text-slate-400 uppercase text-[10px] tracking-widest">Evento / Fecha Meta</th>
                  <th className="px-6 py-4 font-bold text-slate-400 uppercase text-[10px] tracking-widest">Cliente Corporativo</th>
                  <th className="px-6 py-4 font-bold text-slate-400 uppercase text-[10px] tracking-widest text-center">Asistentes</th>
                  <th className="px-6 py-4 font-bold text-slate-400 uppercase text-[10px] tracking-widest text-right">Total Neto</th>
                  <th className="px-6 py-4 font-bold text-slate-400 uppercase text-[10px] tracking-widest text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {cotizacionesPaginadas.map(c => (
                  <tr key={c.id} className="hover:bg-slate-50/80 transition-colors group">
                    <td className="px-6 py-4 font-black text-indigo-600">COT-{String(c.folio).padStart(4, '0')}</td>
                    <td className="px-6 py-4 font-medium text-slate-500">{new Date(c.created_at).toLocaleDateString('es-MX')}</td>
                    <td className="px-6 py-4">
                      <p className="font-bold text-slate-900 tracking-tight">{c.nombre_evento}</p>
                      <p className="text-[10px] text-slate-400 font-medium mt-0.5 flex items-center"><Calendar size={11} className="mr-1"/> Meta: {c.fecha_evento || 'Por definir'}</p>
                    </td>
                    <td className="px-6 py-4">
                      <p className="font-bold text-slate-700">{c.clientes?.nombre_completo}</p>
                      <p className="text-[10px] text-slate-400 font-black uppercase mt-0.5 bg-slate-100 w-fit px-1.5 rounded">{c.clientes?.empresa_o_club || 'Particular'}</p>
                    </td>
                    <td className="px-6 py-4 text-center font-bold text-slate-600 text-base">{c.asistentes_esperados.toLocaleString()}</td>
                    <td className="px-6 py-4 text-right font-black text-slate-900 text-base">${parseFloat(String(c.total || 0)).toLocaleString('es-MX')}</td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex justify-end gap-2 opacity-100 sm:opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => enviarWhatsApp(c)} className="p-2 bg-white border border-slate-200 text-green-600 rounded-xl hover:bg-green-50 hover:border-green-200 transition-all shadow-sm" title="Enviar Resumen WhatsApp">
                          <MessageCircle size={16} />
                        </button>
                        <button onClick={() => manejarImpresion(c, 'ticket')} className="p-2 bg-white border border-slate-200 text-slate-600 rounded-xl hover:bg-slate-100 transition-all shadow-sm" title="Imprimir Ticket 58mm">
                          <FileText size={16} />
                        </button>
                        <button onClick={() => manejarImpresion(c, 'carta')} className="p-2 bg-white border border-slate-200 text-indigo-600 rounded-xl hover:bg-indigo-50 hover:border-indigo-200 transition-all shadow-sm" title="Imprimir Propuesta Carta">
                          <Printer size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {cotizacionesVisibles.length === 0 && (
            <div className="p-20 text-center">
              <FileText className="w-12 h-12 text-slate-200 mx-auto mb-4" />
              <p className="text-slate-400 font-bold tracking-tight">No se encontraron cotizaciones en la base de datos.</p>
            </div>
          )}
        </div>

        {/* PAGINACIÓN */}
        {cotizacionesVisibles.length > 0 && (
          <div className="flex flex-col sm:flex-row justify-between items-center bg-white p-5 rounded-3xl ring-1 ring-slate-200 shadow-sm gap-4">
            <p className="text-xs text-slate-500 font-bold">
              Mostrando <span className="text-slate-900">{indexPrimeraCot + 1}</span> a <span className="text-slate-900">{Math.min(indexUltimaCot, cotizacionesVisibles.length)}</span> de <span className="text-slate-900">{cotizacionesVisibles.length}</span> cotizaciones emitidas
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setPaginaActual(prev => Math.max(prev - 1, 1))}
                disabled={paginaActual === 1}
                className="p-2.5 bg-white border border-slate-200 rounded-xl text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-sm"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <div className="flex items-center px-5 bg-slate-50 border border-slate-200 rounded-xl text-[11px] font-black text-slate-700 uppercase tracking-widest">
                Página {paginaActual} / {totalPaginasCot}
              </div>
              <button
                onClick={() => setPaginaActual(prev => Math.min(prev + 1, totalPaginasCot))}
                disabled={paginaActual === totalPaginasCot}
                className="p-2.5 bg-white border border-slate-200 rounded-xl text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-sm"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* SECCIÓN 2: GESTIÓN DE SERVICIOS */}
      <div className="space-y-6 no-print pt-4">
        <div className="border-b border-slate-100 pb-4">
          <h2 className="text-lg font-black text-slate-900 tracking-tight flex items-center">
            <Briefcase className="mr-2 text-slate-900 w-5 h-5" /> Catálogo Base de Servicios
          </h2>
          <p className="text-xs font-medium text-slate-500 mt-1">Administra la lista de precios y conceptos estándar del catálogo.</p>
        </div>

        <div className="bg-white rounded-3xl ring-1 ring-slate-200 overflow-hidden shadow-sm">
          <table className="w-full text-left text-sm min-w-[600px]">
            <thead>
              <tr className="bg-slate-50/50 border-b border-slate-100">
                <th className="px-6 py-4 font-bold text-slate-400 uppercase text-[10px] tracking-widest">Nombre del Servicio</th>
                <th className="px-6 py-4 font-bold text-slate-400 uppercase text-[10px] tracking-widest">Precio Base Unitario</th>
                <th className="px-6 py-4 font-bold text-slate-400 uppercase text-[10px] tracking-widest">Tipo de Cobro</th>
                <th className="px-6 py-4 font-bold text-slate-400 uppercase text-[10px] tracking-widest text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {servicios.map(s => (
                <tr key={s.id} className="hover:bg-slate-50/80 transition-colors group">
                  <td className="px-6 py-4 font-bold text-slate-900 text-sm">{s.nombre}</td>
                  <td className="px-6 py-4 font-black text-slate-700">${parseFloat(String(s.precio_unitario)).toLocaleString('es-MX')}</td>
                  <td className="px-6 py-4"><span className="text-[10px] font-black text-slate-400 bg-slate-100 px-2 py-0.5 rounded uppercase">{s.tipo_cobro}</span></td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex justify-end gap-2 opacity-100 sm:opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => abrirEdicionServicio(s)} className="p-2 bg-white border border-slate-200 text-slate-600 rounded-xl hover:bg-slate-900 hover:text-white hover:border-slate-900 transition-all shadow-sm">
                        <Edit size={15} />
                      </button>
                      <button onClick={() => handleEliminarServicio(s.id, s.nombre)} className="p-2 bg-white border border-slate-200 text-red-500 rounded-xl hover:bg-red-50 hover:border-red-200 transition-all shadow-sm">
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* MODAL: EDITAR SERVICIO BASE */}
      {isMounted && editandoServicio && createPortal(
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-[9999] p-4 no-print">
          <div className="bg-white rounded-[32px] p-6 md:p-8 w-full max-w-sm relative border border-slate-100 shadow-2xl animate-in zoom-in-95 duration-200">
            <button onClick={() => setEditandoServicio(null)} className="absolute top-5 right-5 text-slate-400 hover:text-slate-900 bg-slate-100 p-1.5 rounded-full transition-all"><X size={16}/></button>
            <div className="mb-6 pb-3 border-b border-slate-100">
              <h3 className="text-lg font-black text-slate-900 flex items-center"><Edit className="mr-2 text-blue-500 w-5 h-5"/> Editar Servicio Base</h3>
            </div>
            <form onSubmit={handleActualizarServicio} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider pl-1">Nombre</label>
                <input required className="w-full bg-slate-50 border border-slate-200 p-3 rounded-xl text-sm text-slate-900 outline-none font-medium focus:border-slate-400" value={formEditServicio.nombre} onChange={e => setFormEditServicio({...formEditServicio, nombre: e.target.value})} />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider pl-1">Precio Unitario ($)</label>
                <input required type="number" step="0.01" className="w-full bg-slate-50 border border-slate-200 p-3 rounded-xl text-sm text-slate-900 outline-none font-black focus:border-slate-400" value={formEditServicio.precio_unitario} onChange={e => setFormEditServicio({...formEditServicio, precio_unitario: e.target.value})} />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider pl-1">Tipo de Cobro</label>
                <div className="relative">
                  <select className="w-full bg-slate-50 border border-slate-200 p-3 rounded-xl text-sm text-slate-900 font-bold outline-none appearance-none cursor-pointer focus:border-slate-400" value={formEditServicio.tipo_cobro} onChange={e => setFormEditServicio({...formEditServicio, tipo_cobro: e.target.value})}>
                    <option value="Fijo">Precio Fijo</option>
                    <option value="Por Atleta">Por Atleta</option>
                  </select>
                  <ChevronDown className="absolute right-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
                </div>
              </div>
              <button type="submit" disabled={guardando} className="w-full bg-slate-900 hover:bg-black text-white py-3.5 rounded-xl font-bold shadow-md transition-all active:scale-[0.98] text-sm mt-2">Guardar Cambios</button>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* ✅ CORRECCIÓN RESPONSIVA: MODAL COMPLETO DE NUEVA COTIZACIÓN BLINDADO CONTRA EL SALTO SUPERIOR */}
      {isMounted && showModalCotizacion && createPortal(
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-[9999] p-4 no-print overflow-y-auto">
          {/* max-h-[90vh] y my-auto aseguran el scroll interno centrado perfecto en celulares */}
          <div className="bg-white rounded-[32px] p-6 md:p-10 max-w-5xl w-full shadow-2xl relative animate-in zoom-in-95 duration-200 my-auto max-h-[90vh] overflow-y-auto custom-scrollbar grid grid-cols-1 lg:grid-cols-5 gap-8">
            <button onClick={cerrarModalCotizacion} className="absolute top-6 right-6 text-slate-400 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-full p-2 z-20 transition-all"><X size={18}/></button>

            {/* LADO IZQUIERDO: FORMULARIO */}
            <div className="lg:col-span-3 order-2 lg:order-1">
              <div className="border-b pb-4 mb-6">
                <h3 className="text-xl font-black text-slate-900 tracking-tight flex items-center"><Calculator className="mr-2 text-slate-900 w-5 h-5"/> Generar Cotización</h3>
              </div>
              <form id="formCot" onSubmit={handleGuardarCotizacion} className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider pl-1">Cliente Corporativo *</label>
                  <div className="relative">
                    <select required value={formCotizacion.cliente_id} onChange={e => setFormCotizacion({...formCotizacion, cliente_id: e.target.value})} className="w-full bg-slate-50 border border-slate-200 p-3.5 rounded-xl outline-none text-slate-900 font-bold appearance-none cursor-pointer focus:border-slate-400">
                      <option value="">Seleccionar cliente...</option>
                      {clientes.map(c => <option key={c.id} value={c.id}>{c.nombre_completo} ({c.empresa_o_club})</option>)}
                    </select>
                    <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="md:col-span-2 space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider pl-1">Nombre del Evento *</label>
                    <input required placeholder="Ej. 5K Matamoros" value={formCotizacion.nombre_evento} onChange={e => setFormCotizacion({...formCotizacion, nombre_evento: e.target.value})} className="w-full bg-slate-50 border border-slate-200 p-3.5 rounded-xl outline-none text-slate-900 font-medium focus:border-slate-400" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider pl-1">Atletas Proyectados *</label>
                    <input required type="number" min="1" value={formCotizacion.asistentes_esperados || ''} onChange={e => setFormCotizacion({...formCotizacion, asistentes_esperados: parseInt(e.target.value)})} className="w-full bg-slate-50 border border-slate-200 p-3.5 rounded-xl outline-none font-black text-slate-900 focus:border-slate-400" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider pl-1">Fecha del Evento</label>
                    <input type="date" value={formCotizacion.fecha_evento} onChange={e => setFormCotizacion({...formCotizacion, fecha_evento: e.target.value})} className="w-full bg-slate-50 border border-slate-200 p-3.5 rounded-xl outline-none text-slate-900 font-medium focus:border-slate-400" />
                  </div>
                </div>

                <div className="pt-5 border-t border-slate-100 mt-6">
                  <label className="block text-xs font-black text-slate-900 uppercase tracking-wider mb-3 pl-1">Servicios y Conceptos a Cotizar</label>
                  <div className="space-y-2.5 max-h-60 overflow-y-auto pr-2 pb-4 custom-scrollbar">
                    {servicios.map(s => {
                      const isSelected = serviciosSeleccionados.includes(s.id);
                      const precioActual = preciosCustom[s.id] !== undefined ? preciosCustom[s.id] : s.precio_unitario;

                      return (
                        <div key={s.id} className={`p-4 rounded-xl border flex flex-col sm:flex-row justify-between sm:items-center gap-3 transition-colors ${isSelected ? 'bg-slate-50 border-slate-900' : 'bg-white border-slate-200 hover:border-slate-300'}`}>
                          <div onClick={() => toggleServicio(s.id)} className="flex-grow cursor-pointer">
                            <p className="font-bold text-slate-900 text-sm leading-tight">{s.nombre}</p>
                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider mt-1">{s.tipo_cobro}</p>
                          </div>

                          <div className="flex items-center gap-3 justify-between sm:justify-end">
                            <div className={`flex items-center border rounded-xl px-3 py-1.5 transition-all ${isSelected ? 'bg-white border-slate-400 shadow-sm' : 'bg-slate-50 border-slate-200'}`}>
                              <span className="text-slate-400 text-xs font-black mr-1.5">$</span>
                              <input
                                type="number"
                                step="0.01"
                                value={precioActual}
                                onClick={(e) => e.stopPropagation()}
                                onChange={(e) => setPreciosCustom({...preciosCustom, [s.id]: e.target.value})}
                                className="w-20 text-right text-sm font-black text-slate-900 outline-none bg-transparent"
                              />
                            </div>
                            <div onClick={() => toggleServicio(s.id)} className={`w-5 h-5 shrink-0 rounded-full border-2 flex items-center justify-center cursor-pointer transition-all ${isSelected ? 'border-slate-900 bg-slate-900' : 'border-slate-300'}`}>
                              {isSelected && <CheckCircle className="w-3 h-3 text-white" />}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </form>
            </div>

            {/* LADO DERECHO: RESUMEN */}
            <div className="lg:col-span-2 bg-slate-900 rounded-[24px] p-6 md:p-8 flex flex-col text-white shadow-inner relative overflow-hidden order-1 lg:order-2 h-fit lg:h-full justify-between">
              <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500 opacity-10 rounded-full blur-3xl -mr-20 -mt-20"></div>
              <div>
                <h3 className="text-xs font-black uppercase tracking-widest text-slate-400 mb-6 border-b border-slate-800 pb-3">Resumen Comercial</h3>
                <div className="space-y-4 relative z-10">
                  <div className="flex justify-between text-slate-400 text-sm"><span>Subtotal</span><span className="font-bold text-white">${subtotal.toLocaleString('es-MX')}</span></div>

                  <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-3">
                    <div className="flex justify-between items-center">
                      <span className="text-xs font-bold text-slate-400 flex items-center"><Percent className="w-3 h-3 mr-1"/> Tipo Descuento</span>
                      <div className="relative">
                        <select
                          className="bg-transparent text-[10px] uppercase font-black outline-none text-slate-300 tracking-wider text-right cursor-pointer pr-4 appearance-none"
                          value={formCotizacion.tipo_descuento}
                          onChange={e => setFormCotizacion({...formCotizacion, tipo_descuento: e.target.value})}
                        >
                          <option value="Fijo">Total ($)</option>
                          <option value="Porcentaje">Porcentaje (%)</option>
                          <option value="Por Atleta">Por Atleta ($)</option>
                        </select>
                        <ChevronDown className="absolute right-0 top-1/2 -translate-y-1/2 h-3 w-3 text-slate-500 pointer-events-none" />
                      </div>
                    </div>
                    <div className="flex justify-between items-center text-slate-400">
                      <span className="text-xs font-medium">Monto / Valor:</span>
                      <input type="number" step="0.01" className="w-24 bg-slate-900 border border-slate-700 rounded-lg p-1.5 text-right text-sm font-black outline-none text-white focus:border-slate-500" value={formCotizacion.descuento || ''} onChange={e => setFormCotizacion({...formCotizacion, descuento: parseFloat(String(e.target.value)) || 0})} placeholder="0.00" />
                    </div>
                    {montoDescuentoCalculado > 0 && (
                      <div className="text-right text-[10px] text-red-400 font-bold pt-1 border-t border-slate-900">- ${montoDescuentoCalculado.toLocaleString('es-MX')} Aplicados</div>
                    )}
                  </div>

                  <div className="flex justify-between text-slate-400 text-sm"><span>I.V.A. (16%)</span><span className="font-bold text-white">${iva.toLocaleString('es-MX')}</span></div>
                </div>
              </div>
              <div className="border-t border-slate-800 pt-6 mt-8 relative z-10">
                <div className="flex justify-between items-end mb-6"><span className="text-xs font-black text-slate-400 uppercase tracking-wider">Total Neto</span><span className="text-3xl font-black text-green-400 tracking-tighter">${total.toLocaleString('es-MX')}</span></div>
                <button type="submit" form="formCot" disabled={guardando || !formCotizacion.cliente_id || serviciosSeleccionados.length === 0} className="w-full bg-white text-slate-900 hover:bg-slate-100 py-4 rounded-xl font-black uppercase tracking-widest text-sm transition-all active:scale-[0.98] disabled:opacity-40 shadow-md">
                  {guardando ? 'Guardando...' : 'Confirmar Presupuesto'}
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* MODAL: NUEVO CLIENTE */}
      {isMounted && showModalCliente && createPortal(
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-[9999] p-4 no-print">
          <div className="bg-white rounded-[32px] p-6 md:p-8 w-full max-w-sm relative border border-slate-100 shadow-2xl animate-in zoom-in-95 duration-200">
            <button onClick={() => setShowModalCliente(false)} className="absolute top-5 right-5 text-slate-400 hover:text-slate-900 bg-slate-100 p-1.5 rounded-full transition-all"><X size={16}/></button>
            <div className="mb-6 pb-3 border-b border-slate-100"><h3 className="text-lg font-black text-slate-900 flex items-center"><Users className="w-5 h-5 mr-2 text-blue-500"/> Alta de Cliente</h3></div>
            <form onSubmit={handleGuardarCliente} className="space-y-4">
              <input required placeholder="Nombre Completo *" className="w-full bg-slate-50 border border-slate-200 p-3.5 rounded-xl text-sm text-slate-900 outline-none font-medium focus:border-slate-400" value={formCliente.nombre_completo} onChange={e => setFormCliente({...formCliente, nombre_completo: e.target.value})} />
              <input placeholder="Empresa o Club" className="w-full bg-slate-50 border border-slate-200 p-3.5 rounded-xl text-sm text-slate-900 outline-none font-medium focus:border-slate-400" value={formCliente.empresa_o_club} onChange={e => setFormCliente({...formCliente, empresa_o_club: e.target.value})} />
              <input required type="tel" placeholder="Teléfono *" className="w-full bg-slate-50 border border-slate-200 p-3.5 rounded-xl text-sm text-slate-900 outline-none font-black focus:border-slate-400" value={formCliente.telefono} onChange={e => setFormCliente({...formCliente, telefono: e.target.value})} />
              <input type="email" placeholder="Correo Electrónico" className="w-full bg-slate-50 border border-slate-200 p-3.5 rounded-xl text-sm text-slate-900 outline-none font-medium focus:border-slate-400" value={formCliente.email} onChange={e => setFormCliente({...formCliente, email: e.target.value})} />
              <button type="submit" disabled={guardando} className="w-full bg-slate-900 hover:bg-black text-white py-3.5 rounded-xl font-bold mt-2 transition-all active:scale-[0.98] text-sm">Guardar Cliente</button>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* MODAL: NUEVO SERVICIO */}
      {isMounted && showModalServicio && createPortal(
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-[9999] p-4 no-print">
          <div className="bg-white rounded-[32px] p-6 md:p-8 w-full max-w-sm relative border border-slate-100 shadow-2xl animate-in zoom-in-95 duration-200">
            <button onClick={() => setShowModalServicio(false)} className="absolute top-5 right-5 text-slate-400 hover:text-slate-900 bg-slate-100 p-1.5 rounded-full transition-all"><X size={16}/></button>
            <div className="mb-6 pb-3 border-b border-slate-100"><h3 className="text-lg font-black text-slate-900 flex items-center"><Briefcase className="w-5 h-5 mr-2 text-emerald-500"/> Alta de Servicio</h3></div>
            <form onSubmit={handleGuardarServicio} className="space-y-4">
              <input required placeholder="Nombre Servicio *" className="w-full bg-slate-50 border border-slate-200 p-3.5 rounded-xl text-sm text-slate-900 outline-none font-medium focus:border-slate-400" value={formServicio.nombre} onChange={e => setFormServicio({...formServicio, nombre: e.target.value})} />
              <input required type="number" step="0.01" placeholder="Precio Unitario *" className="w-full bg-slate-50 border border-slate-200 p-3.5 rounded-xl text-sm text-slate-900 outline-none font-black focus:border-slate-400" value={formServicio.precio_unitario} onChange={e => setFormServicio({...formServicio, precio_unitario: e.target.value})} />
              <div className="relative">
                <select className="w-full bg-slate-50 border border-slate-200 p-3.5 rounded-xl text-sm text-slate-900 font-bold outline-none appearance-none cursor-pointer focus:border-slate-400" value={formServicio.tipo_cobro} onChange={e => setFormServicio({...formServicio, tipo_cobro: e.target.value})}>
                  <option value="Fijo">Precio Fijo</option>
                  <option value="Por Atleta">Por Atleta</option>
                </select>
                <ChevronDown className="absolute right-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
              </div>
              <button type="submit" disabled={guardando} className="w-full bg-slate-900 hover:bg-black text-white py-3.5 rounded-xl font-bold mt-2 transition-all active:scale-[0.98] text-sm">Guardar Servicio</button>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* ========================================================================= */}
      {/* VISTAS DE IMPRESIÓN (INALTERADAS)                                         */}
      {/* ========================================================================= */}
      {isMounted && cotizacionParaImprimir && createPortal(
        <div className="print-only">
          {tipoImpresion === 'carta' && (
            <div id="print-carta" className="bg-white text-slate-900 p-10 font-sans z-[9999]">
              <div className="flex justify-between items-start border-b-4 border-slate-900 pb-6 mb-10">
                <div>
                  <img src="https://actv.mx/wp-content/uploads/2026/02/Logo-ACTV-2026-min.png" alt="ACTV Logo" className="h-16 mb-4" />
                  <p className="text-xs font-bold uppercase text-slate-500">Tu Carrera Comienza Aquí</p>
                </div>
                <div className="text-right">
                  <h1 className="text-4xl font-black text-slate-900 uppercase">Cotización</h1>
                  <p className="text-indigo-600 font-black text-xl">COT-{String(cotizacionParaImprimir.folio).padStart(4, '0')}</p>
                  <p className="text-sm font-bold text-slate-500 mt-1">Fecha: {new Date(cotizacionParaImprimir.created_at).toLocaleDateString('es-MX')}</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-10 mb-10">
                <div>
                  <h4 className="text-[10px] font-black uppercase text-indigo-600 mb-2 border-b border-indigo-100 pb-1">Datos del Cliente</h4>
                  <p className="text-xl font-black uppercase">{cotizacionParaImprimir.clientes?.nombre_completo}</p>
                  <p className="font-bold text-slate-600 uppercase text-sm">{cotizacionParaImprimir.clientes?.empresa_o_club}</p>
                  <div className="mt-2 text-sm text-slate-500 space-y-1">
                    <p className="flex items-center"><Phone size={12} className="mr-2"/> {cotizacionParaImprimir.clientes?.telefono}</p>
                    <p className="flex items-center"><Mail size={12} className="mr-2"/> {cotizacionParaImprimir.clientes?.email}</p>
                  </div>
                </div>
                <div className="bg-slate-50 p-6 rounded-2xl border border-slate-100">
                  <h4 className="text-[10px] font-black uppercase text-indigo-600 mb-2">Detalles del Evento</h4>
                  <p className="text-lg font-black uppercase text-slate-800">{cotizacionParaImprimir.nombre_evento}</p>
                  <p className="flex items-center text-sm font-bold text-slate-600 mt-2"><Calendar size={14} className="mr-2"/> {cotizacionParaImprimir.fecha_evento || 'Por definir'}</p>
                  <p className="flex items-center text-sm font-bold text-slate-600 mt-1"><Users size={14} className="mr-2"/> {cotizacionParaImprimir.asistentes_esperados} Atletas Proyectados</p>
                </div>
              </div>
              <table className="w-full text-left mb-10">
                <thead>
                  <tr className="bg-slate-900 text-white text-[10px] uppercase font-black tracking-widest">
                    <th className="p-4 rounded-l-xl">Servicio / Concepto</th>
                    <th className="p-4">Tipo</th>
                    <th className="p-4 text-center">P. Unitario</th>
                    <th className="p-4 text-right rounded-r-xl">Total Línea</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {cotizacionParaImprimir.desglose_servicios?.map((srv, idx: number) => {
                    const pUnitario = parseFloat(String(srv.precio_unitario || srv.precio_aplicado || 0));
                    const tLinea = parseFloat(String(srv.total_linea || (srv.tipo === 'Por Atleta' ? pUnitario * (cotizacionParaImprimir.asistentes_esperados || 0) : pUnitario)));
                    return (
                      <tr key={idx} className="text-sm">
                        <td className="p-4 font-bold text-slate-800">{srv.nombre}</td>
                        <td className="p-4 text-xs text-slate-500 uppercase font-medium">{srv.tipo}</td>
                        <td className="p-4 text-center font-bold">${pUnitario.toLocaleString('es-MX')}</td>
                        <td className="p-4 text-right font-black">${tLinea.toLocaleString('es-MX')}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="flex justify-end mt-10">
                <div className="w-72 space-y-3">
                  <div className="flex justify-between text-slate-500 font-bold text-sm"><span>Subtotal:</span><span className="text-slate-900">${parseFloat(String(cotizacionParaImprimir.subtotal || 0)).toLocaleString('es-MX')}</span></div>
                  {parseFloat(String(cotizacionParaImprimir.descuento || 0)) > 0 && (
                    <div className="flex justify-between text-red-500 font-bold text-sm">
                      <span>Desc. {cotizacionParaImprimir.tipo_descuento === 'Porcentaje' ? '(%)' : cotizacionParaImprimir.tipo_descuento === 'Por Atleta' ? '(X Atleta)' : '($)'}:</span>
                      <span>-${parseFloat(String(cotizacionParaImprimir.descuento)).toLocaleString('es-MX')}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-slate-500 font-bold text-sm border-b pb-3"><span>I.V.A. (16%):</span><span className="text-slate-900">${parseFloat(String(cotizacionParaImprimir.iva || 0)).toLocaleString('es-MX')}</span></div>
                  <div className="flex justify-between items-end pt-3 text-slate-900"><span className="text-xs font-black uppercase">Total Neto</span><span className="text-3xl font-black text-indigo-600">${parseFloat(String(cotizacionParaImprimir.total || 0)).toLocaleString('es-MX')} MXN</span></div>
                </div>
              </div>
              <div className="mt-20 pt-10 border-t border-slate-100 grid grid-cols-2 gap-10">
                <div className="text-[10px] text-slate-400 space-y-2">
                  <p className="font-black text-slate-600 uppercase">Términos y Condiciones</p>
                  <ul className="list-disc pl-4 space-y-1">
                    <li>Vigencia de cotización: 15 días naturales.</li>
                    <li>Para confirmar fecha se requiere el 50% de anticipo.</li>
                    <li>Precios sujetos a cambios según número final de asistentes.</li>
                  </ul>
                </div>
                <div className="text-right text-[10px] font-black uppercase text-slate-500 flex flex-col justify-end">
                  <p>ACTV - Tu carrera comienza aquí</p>
                  <p>actv.mx</p>
                </div>
              </div>
            </div>
          )}
          {/* FORMATO 2: TICKET TERMICO (58MM) - Solo se dibuja si tipoImpresion es 'ticket' */}
          {tipoImpresion === 'ticket' && (
            <div id="print-ticket">
              <div style={{ textAlign: 'center', marginBottom: '5px' }}>
                <img src="https://actv.mx/wp-content/uploads/2026/02/Logo-ACTV-2026-min.png" alt="logo actv" style={{ width: '30mm', height: 'auto', margin: '0 auto 5px auto', display: 'block', filter: 'grayscale(100%) contrast(1.5)' }} />
                <h2 style={{ fontSize: '13pt', margin: 0, fontWeight: '900' }}>COTIZACION</h2>
                <p style={{ fontSize: '10pt', margin: 0 }}>COT-{String(cotizacionParaImprimir.folio).padStart(4, '0')}</p>
                <p style={{ fontSize: '8pt', margin: 0 }}>{new Date(cotizacionParaImprimir.created_at).toLocaleDateString('es-MX')}</p>
                <p style={{ marginTop: '5px' }}>==========================</p>
              </div>
              <p style={{ fontSize: '9pt' }}><strong>Cliente:</strong> {cotizacionParaImprimir.clientes?.nombre_completo}</p>
              <p style={{ fontSize: '9pt' }}><strong>Evento:</strong> {cotizacionParaImprimir.nombre_evento}</p>
              <p style={{ fontSize: '9pt' }}><strong>Atletas Proy:</strong> {cotizacionParaImprimir.asistentes_esperados}</p>
              <p>==========================</p>
              {cotizacionParaImprimir.desglose_servicios?.map((srv, idx: number) => {
                const pUnitario = parseFloat(String(srv.precio_unitario || srv.precio_aplicado || 0));
                const tLinea = parseFloat(String(srv.total_linea || (srv.tipo === 'Por Atleta' ? pUnitario * (cotizacionParaImprimir.asistentes_esperados || 0) : pUnitario)));
                return (
                  <div key={idx} style={{ marginBottom: '5px', fontSize: '8pt' }}>
                    <p style={{ fontWeight: '900', margin: 0 }}>{srv.nombre}</p>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>{srv.tipo === 'Por Atleta' ? `$${pUnitario} x Atl` : 'Fijo'}</span>
                      <span style={{ fontWeight: '900' }}>${tLinea.toLocaleString('es-MX')}</span>
                    </div>
                  </div>
                );
              })}
              <p style={{ marginTop: '5px' }}>==========================</p>
              <div style={{ fontSize: '9pt', textAlign: 'right' }}>
                <p>Sub: ${parseFloat(String(cotizacionParaImprimir.subtotal || 0)).toLocaleString('es-MX')}</p>
                {parseFloat(String(cotizacionParaImprimir.descuento || 0)) > 0 && (
                  <p>Desc: -${parseFloat(String(cotizacionParaImprimir.descuento)).toLocaleString('es-MX')}</p>
                )}
                <p>IVA: ${parseFloat(String(cotizacionParaImprimir.iva || 0)).toLocaleString('es-MX')}</p>
              </div>
              <p style={{ fontSize: '12pt', fontWeight: '900', textAlign: 'right', marginTop: '5px' }}>NETO: ${parseFloat(String(cotizacionParaImprimir.total || 0)).toLocaleString('es-MX')}</p>
              <p style={{ marginTop: '10px' }}>==========================</p>
              <div style={{ fontSize: '7.5pt', textAlign: 'center', marginTop: '5px' }}>
                <p>Vigencia 15 dias.</p>
                <p>Sujeto a cambios.</p>
                <p style={{ marginTop: '5px', fontWeight: '900' }}>actv.mx</p>
              </div>
            </div>
          )}
        </div>,
        document.body
      )}

    </section>
  );
}
