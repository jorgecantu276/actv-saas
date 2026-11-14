'use client';

import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../lib/supabase';
import { Search, Package, CheckCircle, X, Camera, ShieldAlert, Upload, PackageCheck, Eye, ChevronLeft, ChevronRight, Download, FileCode2, ChevronDown, Calendar } from 'lucide-react';

// ==========================================
// COMPRESOR NATIVO DE IMÁGENES
// ==========================================
const comprimirImagen = (file: File): Promise<File> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target?.result as string;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 800; // Resolución ideal y ligera
        let newWidth = img.width;
        let newHeight = img.height;

        if (img.width > MAX_WIDTH) {
          const scaleSize = MAX_WIDTH / img.width;
          newWidth = MAX_WIDTH;
          newHeight = img.height * scaleSize;
        }

        canvas.width = newWidth;
        canvas.height = newHeight;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, canvas.width, canvas.height);
        
        canvas.toBlob((blob) => {
          if (blob) {
            // Lo convertimos a un JPG ligero al 70% de calidad
            const newFile = new File([blob], file.name.replace(/\.[^/.]+$/, "") + ".jpg", { type: 'image/jpeg' });
            resolve(newFile);
          } else {
            reject(new Error("Error al comprimir la imagen"));
          }
        }, 'image/jpeg', 0.7); 
      };
    };
  });
};

export default function TabEntregaKits({ eventos, userRole, userId }: any) {
  const [isMounted, setIsMounted] = useState(false);
  useEffect(() => { setIsMounted(true); }, []);

  const [inscripciones, setInscripciones] = useState<any[]>([]);
  const [busqueda, setBusqueda] = useState('');
  const [filtroEvento, setFiltroEvento] = useState('');
  const [cargando, setCargando] = useState(true);
  const [misEventosPermitidos, setMisEventosPermitidos] = useState<string[]>([]);
  
  const [vistaActual, setVistaActual] = useState<'pendientes' | 'entregados'>('pendientes');

  const [paginaActual, setPaginaActual] = useState(1);
  const itemsPorPagina = 25;

  useEffect(() => {
    setPaginaActual(1);
  }, [busqueda, filtroEvento, vistaActual]);

  const [modalEntrega, setModalEntrega] = useState<any | null>(null);
  const [fotoArchivo, setFotoArchivo] = useState<File | null>(null);
  const [fotoPreview, setFotoPreview] = useState<string | null>(null);
  const [procesando, setProcesando] = useState(false);

  const [modalEvidencia, setModalEvidencia] = useState<string | null>(null);

  useEffect(() => {
    cargarDatos();
  }, [userId, userRole]);

  const cargarDatos = async () => {
    setCargando(true);
    let eventosPermitidos: string[] = [];

    if (userRole === 'Moderador' && userId) {
      const { data: perfil } = await supabase.from('perfiles').select('eventos_asignados').eq('id', userId).single();
      if (perfil && perfil.eventos_asignados) eventosPermitidos = perfil.eventos_asignados;
      setMisEventosPermitidos(eventosPermitidos);

      if (eventosPermitidos.length === 0) {
        setInscripciones([]);
        setCargando(false);
        return;
      }
    }

    // Calculamos la fecha límite (hace 30 días) para filtrar automáticamente eventos viejos
    const hace30Dias = new Date();
    hace30Dias.setDate(hace30Dias.getDate() - 30);
    const fechaLimite = hace30Dias.toISOString().split('T')[0];

    let query = supabase.from('inscripciones').select(`
      id, folio_asignado, kit_entregado, foto_evidencia, paquete_comprado, created_at, actv_eligible, monto_pagado,
      atletas (nombre, apellido, talla_playera, telefono),
      eventos!inner (nombre_carrera, fecha)
    `)
    .gte('eventos.fecha', fechaLimite); // <-- FILTRO DE 30 DÍAS APLICADO

    if (userRole === 'Moderador') query = query.in('evento_id', eventosPermitidos);

    const { data } = await query;
    if (data) setInscripciones(data);
    setCargando(false);
  };

  const handleCapturaFoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setFotoArchivo(file);
      setFotoPreview(URL.createObjectURL(file));
    }
  };

  const confirmarEntrega = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!modalEntrega || modalEntrega.actv_eligible === false || modalEntrega.monto_pagado === 'WP / Online') {
      alert('Consulta conciliación antes de entregar este kit.');
      return;
    }
    if (!fotoArchivo) return alert("Por favor toma una foto como evidencia.");
    setProcesando(true);

    try {
      const fotoOptimizada = await comprimirImagen(fotoArchivo);
      const fileName = `kit_${modalEntrega.folio_asignado}_${Date.now()}.jpg`;
      const filePath = `${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('evidencias_kits')
        .upload(filePath, fotoOptimizada);

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('evidencias_kits')
        .getPublicUrl(filePath);

      const { data: updated, error: updateError } = await supabase.from('inscripciones')
        .update({ 
          kit_entregado: true, 
          foto_evidencia: publicUrl 
        })
        .eq('id', modalEntrega.id)
        .or('actv_eligible.is.null,actv_eligible.eq.true')
        .or('kit_entregado.is.null,kit_entregado.eq.false')
        .select('id')
        .maybeSingle();

      if (updateError) throw updateError;
      if (!updated) {
        await supabase.storage.from('evidencias_kits').remove([filePath]);
        throw new Error('El folio cambió de estado. Consulta la inscripción antes de entregar el kit.');
      }

      cerrarModal();
      cargarDatos(); 
    } catch (error: any) {
      alert("Error al procesar la entrega: " + error.message);
    } finally {
      setProcesando(false);
    }
  };

  const cerrarModal = () => {
    setModalEntrega(null);
    setFotoArchivo(null);
    setFotoPreview(null);
  };

  const filtradosGlobales = inscripciones.filter(i => {
    const matchEvento = filtroEvento === '' || i.eventos?.nombre_carrera === filtroEvento;
    const busquedaLower = busqueda.toLowerCase();
    const matchBusqueda = 
      i.folio_asignado.toLowerCase().includes(busquedaLower) ||
      `${i.atletas?.nombre} ${i.atletas?.apellido}`.toLowerCase().includes(busquedaLower);
    
    const matchEstado = vistaActual === 'pendientes' ? !i.kit_entregado : i.kit_entregado;

    return matchEvento && matchBusqueda && matchEstado;
  }).sort((a, b) => {
    if (vistaActual === 'pendientes') return a.folio_asignado.localeCompare(b.folio_asignado);
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  const totalPaginas = Math.ceil(filtradosGlobales.length / itemsPorPagina);
  const indexUltimoItem = paginaActual * itemsPorPagina;
  const indexPrimerItem = indexUltimoItem - itemsPorPagina;
  const filtradosPaginados = filtradosGlobales.slice(indexPrimerItem, indexUltimoItem);

  const eventosDropdown = userRole === 'Moderador' 
    ? eventos.filter((ev: any) => misEventosPermitidos.includes(ev.id))
    : eventos;

  const exportarCSV = () => {
    const cabeceras = ['Folio', 'Corredor', 'Evento', 'Talla', 'Paquete', 'Estado', 'Evidencia URL'];
    const filas = filtradosGlobales.map(i => [
      i.folio_asignado,
      `${i.atletas?.nombre || ''} ${i.atletas?.apellido || ''}`,
      i.eventos?.nombre_carrera || '',
      i.atletas?.talla_playera || '',
      i.paquete_comprado || '',
      i.kit_entregado ? 'Entregado' : 'Pendiente',
      i.foto_evidencia || 'Sin Evidencia'
    ]);
    const csvContent = [cabeceras.join(','), ...filas.map(r => r.map(f => `"${String(f ?? '')}"`).join(','))].join('\n');
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.setAttribute('download', `Reporte_Entregas_ACTV.csv`);
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
  };

  const exportarXML = () => {
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<reporte_entregas>\n';
    filtradosGlobales.forEach(i => {
      xml += `  <registro>\n`;
      xml += `    <folio>${i.folio_asignado}</folio>\n`;
      xml += `    <corredor>${i.atletas?.nombre || ''} ${i.atletas?.apellido || ''}</corredor>\n`;
      xml += `    <evento>${i.eventos?.nombre_carrera || ''}</evento>\n`;
      xml += `    <talla>${i.atletas?.talla_playera || ''}</talla>\n`;
      xml += `    <paquete>${i.paquete_comprado || ''}</paquete>\n`;
      xml += `    <estado>${i.kit_entregado ? 'Entregado' : 'Pendiente'}</estado>\n`;
      xml += `    <evidencia>${i.foto_evidencia || 'Sin Evidencia'}</evidencia>\n`;
      xml += `  </registro>\n`;
    });
    xml += '</reporte_entregas>';
    const blob = new Blob([xml], { type: 'text/xml;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.setAttribute('download', `Reporte_Entregas_ACTV.xml`);
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
  };

  return (
    <section className="animate-in fade-in slide-in-from-bottom-2 duration-500 space-y-8">
      
      {/* CABECERA */}
      <div className="bg-white p-6 md:p-8 rounded-3xl shadow-sm ring-1 ring-slate-200">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-slate-100 pb-6">
          <div>
            <h2 className="text-xl font-black text-slate-900 flex items-center tracking-tight">
              <PackageCheck className="mr-2.5 text-orange-500 w-6 h-6" /> Logística de Kits
            </h2>
            <p className="text-xs text-slate-500 font-medium mt-1">Escanea, verifica y audita la entrega de paquetes.</p>
          </div>
          <button onClick={cargarDatos} className="text-xs font-bold text-slate-700 bg-slate-50 border border-slate-200 hover:bg-slate-100 px-4 py-2.5 rounded-xl transition-all shadow-sm active:scale-95">
            Actualizar Lista
          </button>
        </div>

        {/* ALERTA MODERADOR SIN EVENTOS */}
        {userRole === 'Moderador' && misEventosPermitidos.length === 0 && (
          <div className="bg-amber-50 border border-amber-200 text-amber-800 p-5 rounded-2xl flex items-center mt-6 shadow-sm">
            <ShieldAlert className="w-5 h-5 mr-3 text-amber-500 flex-shrink-0"/>
            <p className="text-sm font-bold">No tienes carreras asignadas para entregar kits en este momento.</p>
          </div>
        )}

        {/* BOTONES DE VISTA (PENDIENTES VS ENTREGADOS) */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-5 mt-6">
          <div className="flex bg-slate-100 p-1.5 rounded-xl w-full md:w-auto shadow-inner">
            <button 
              onClick={() => setVistaActual('pendientes')} 
              className={`flex-1 md:flex-none px-6 py-2.5 rounded-lg text-sm font-bold transition-all duration-300 ${vistaActual === 'pendientes' ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200/50' : 'text-slate-500 hover:text-slate-700'}`}
            >
              Kits Pendientes
            </button>
            <button 
              onClick={() => setVistaActual('entregados')} 
              className={`flex-1 md:flex-none px-6 py-2.5 rounded-lg text-sm font-bold transition-all duration-300 ${vistaActual === 'entregados' ? 'bg-white text-green-600 shadow-sm ring-1 ring-slate-200/50' : 'text-slate-500 hover:text-slate-700'}`}
            >
              Historial de Entregas
            </button>
          </div>

          {vistaActual === 'entregados' && (userRole === 'Administrador' || userRole === 'Moderador') && (
            <div className="flex gap-2 w-full md:w-auto">
              <button onClick={exportarCSV} className="flex-1 md:flex-none text-xs font-bold text-white bg-green-600 hover:bg-green-700 px-4 py-2.5 rounded-xl transition-all shadow-sm active:scale-95 flex items-center justify-center">
                <Download className="w-4 h-4 md:mr-1.5" /> <span className="hidden md:inline">CSV</span>
              </button>
              <button onClick={exportarXML} className="flex-1 md:flex-none text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 px-4 py-2.5 rounded-xl transition-all shadow-sm active:scale-95 flex items-center justify-center">
                <FileCode2 className="w-4 h-4 md:mr-1.5" /> <span className="hidden md:inline">XML</span>
              </button>
            </div>
          )}
        </div>

        {/* FILTROS DE BÚSQUEDA Y CARRERA */}
        <div className="flex flex-col md:flex-row gap-4 bg-slate-50 p-4 rounded-2xl border border-slate-100 mt-6">
          <div className="relative w-full md:w-2/3 group">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 group-focus-within:text-slate-900 transition-colors" />
            <input 
              type="text" 
              placeholder="Buscar por Folio (Ej. 080) o Nombre..." 
              className="w-full bg-white border border-slate-200 p-3.5 pl-11 rounded-xl outline-none text-sm focus:ring-4 focus:ring-slate-900/5 focus:border-slate-400 text-slate-900 font-medium placeholder:font-normal placeholder:text-slate-400 shadow-sm transition-all"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
            />
          </div>
          <div className="w-full md:w-1/3 relative">
            <Package className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
            <select 
              className="w-full bg-white border border-slate-200 p-3.5 pl-11 rounded-xl outline-none text-sm text-slate-900 font-bold shadow-sm appearance-none cursor-pointer focus:ring-4 focus:ring-slate-900/5 focus:border-slate-400 transition-all"
              value={filtroEvento}
              onChange={(e) => setFiltroEvento(e.target.value)}
            >
              <option value="">Todas las carreras</option>
              {eventosDropdown.map((ev: any) => <option key={ev.id} value={ev.nombre_carrera}>{ev.nombre_carrera}</option>)}
            </select>
            <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
          </div>
        </div>
      </div>

      {cargando ? (
        <div className="py-20 text-center text-slate-400 font-bold tracking-widest uppercase text-xs">Cargando base de datos...</div>
      ) : (
        <>
          {/* GRID DE TARJETAS */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
            {filtradosPaginados.map((i) => (
              <div key={i.id} className={`p-6 rounded-3xl border transition-all duration-300 group hover:-translate-y-1 ${i.kit_entregado ? 'bg-green-50/30 border-green-100 hover:shadow-md' : 'bg-white border-slate-200 shadow-sm hover:shadow-md hover:border-slate-300'}`}>
                
                <div className="flex justify-between items-start mb-4">
                  <span className="text-2xl font-black text-slate-800 tracking-tighter">{i.folio_asignado}</span>
                  {i.kit_entregado ? (
                    <span className="bg-green-100 text-green-700 text-[10px] font-black uppercase px-2.5 py-1 rounded border border-green-200 flex items-center tracking-widest"><CheckCircle className="w-3 h-3 mr-1"/> Entregado</span>
                  ) : i.actv_eligible === false || i.monto_pagado === 'WP / Online' ? (
                    <span className="bg-amber-100 text-amber-800 text-[10px] font-bold uppercase px-2.5 py-1 rounded border border-amber-200">Revisar pago</span>
                  ) : (
                    <span className="bg-amber-100 text-amber-700 text-[10px] font-black uppercase px-2.5 py-1 rounded border border-amber-200 tracking-widest">Pendiente</span>
                  )}
                </div>
                
                <div className="mb-5">
                  <h4 className="font-bold text-slate-900 leading-tight text-lg">{i.atletas?.nombre} {i.atletas?.apellido}</h4>
                  <p className="text-[11px] font-medium text-slate-500 uppercase mt-1.5 line-clamp-1 flex items-center">
                    <Calendar className="w-3 h-3 mr-1"/> {i.eventos?.nombre_carrera}
                  </p>
                  {i.actv_eligible == null && <p className="mt-1 text-xs text-slate-500">Registro histórico · pago sin validar en ACTV</p>}
                </div>

                <div className="flex gap-2 mb-5 text-xs font-bold">
                  <span className="bg-slate-50 text-slate-600 px-2.5 py-1.5 rounded-lg border border-slate-200">Talla: <span className="text-slate-900">{i.atletas?.talla_playera}</span></span>
                  <span className="bg-slate-50 text-slate-600 px-2.5 py-1.5 rounded-lg border border-slate-200 line-clamp-1">{i.paquete_comprado}</span>
                </div>

                <div className="pt-4 border-t border-slate-100">
                  {!i.kit_entregado ? (
                    <button disabled={i.actv_eligible === false || i.monto_pagado === 'WP / Online'} onClick={() => setModalEntrega(i)} className="w-full py-3.5 bg-slate-900 hover:bg-black text-white rounded-xl text-sm font-black uppercase tracking-widest transition-all active:scale-95 shadow-md flex justify-center items-center disabled:opacity-45">
                      <Package className="w-4 h-4 mr-2"/> Entregar Kit
                    </button>
                  ) : (
                    <button onClick={() => setModalEvidencia(i.foto_evidencia)} className="w-full py-3.5 bg-white border border-slate-200 hover:bg-slate-50 hover:border-slate-300 text-slate-700 rounded-xl text-sm font-bold transition-all active:scale-95 shadow-sm flex justify-center items-center">
                      <Eye className="w-4 h-4 mr-2"/> Ver Evidencia
                    </button>
                  )}
                </div>
              </div>
            ))}

            {filtradosGlobales.length === 0 && (
              <div className="col-span-full py-16 text-center bg-white rounded-3xl border border-slate-200 shadow-sm">
                <PackageCheck className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                <p className="text-slate-500 font-bold tracking-tight">No hay kits que mostrar en esta vista.</p>
              </div>
            )}
          </div>

          {/* PAGINACIÓN */}
          {filtradosGlobales.length > itemsPorPagina && (
            <div className="flex flex-col sm:flex-row justify-between items-center mt-8 bg-white p-5 rounded-3xl border border-slate-200 shadow-sm gap-4">
              <p className="text-xs text-slate-500 font-bold">
                Mostrando <span className="text-slate-900">{indexPrimerItem + 1}</span> a <span className="text-slate-900">{Math.min(indexUltimoItem, filtradosGlobales.length)}</span> de <span className="text-orange-600">{filtradosGlobales.length}</span> registros
              </p>
              <div className="flex gap-2">
                <button 
                  onClick={() => setPaginaActual(prev => Math.max(prev - 1, 1))}
                  disabled={paginaActual === 1}
                  className="px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed flex items-center transition-all shadow-sm"
                >
                  <ChevronLeft className="w-4 h-4 md:mr-1" /> <span className="hidden md:inline">Anterior</span>
                </button>
                <div className="flex items-center px-5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-black text-slate-700">
                  {paginaActual} de {totalPaginas}
                </div>
                <button 
                  onClick={() => setPaginaActual(prev => Math.min(prev + 1, totalPaginas))}
                  disabled={paginaActual === totalPaginas}
                  className="px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed flex items-center transition-all shadow-sm"
                >
                  <span className="hidden md:inline">Siguiente</span> <ChevronRight className="w-4 h-4 md:ml-1" />
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* MODAL DE CONFIRMACIÓN DE ENTREGA */}
      {isMounted && modalEntrega && createPortal(
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-[9999] p-4 overflow-y-auto">
          <div className="bg-white rounded-[32px] p-8 md:p-10 max-w-sm w-full shadow-2xl relative animate-in zoom-in-95 duration-200 my-auto">
            <button type="button" onClick={cerrarModal} className="absolute top-6 right-6 text-slate-400 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-full p-2 transition-all"><X size={18}/></button>
            
            <div className="text-center mb-8">
              <div className="mx-auto bg-slate-900 w-14 h-14 rounded-2xl flex items-center justify-center mb-4 shadow-lg shadow-slate-900/20">
                <Package className="w-7 h-7 text-white"/>
              </div>
              <h3 className="text-2xl font-black text-slate-900 tracking-tight leading-none">Entrega de Kit</h3>
              <p className="text-[11px] text-slate-400 uppercase font-black tracking-widest mt-2">Folio Asignado: <span className="text-orange-500">{modalEntrega.folio_asignado}</span></p>
            </div>
            
            <div className="bg-slate-50 p-5 rounded-2xl border border-slate-200 mb-6 text-sm">
              <p className="font-black text-slate-900 text-lg mb-1">{modalEntrega.atletas?.nombre} {modalEntrega.atletas?.apellido}</p>
              <div className="flex justify-between mt-3 border-t border-slate-200 pt-3">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Talla: <span className="text-slate-900">{modalEntrega.atletas?.talla_playera}</span></span>
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Pq: <span className="text-slate-900">{modalEntrega.paquete_comprado}</span></span>
              </div>
            </div>

            <form onSubmit={confirmarEntrega}>
              <div className="mb-8">
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3 text-center">Fotografía de Evidencia *</p>
                
                {!fotoPreview ? (
                  <label className="flex flex-col items-center justify-center w-full h-40 border-2 border-dashed border-slate-300 rounded-2xl cursor-pointer bg-slate-50 hover:bg-slate-100 hover:border-slate-400 transition-all group">
                    <div className="flex flex-col items-center justify-center pt-5 pb-6">
                      <Camera className="w-8 h-8 text-slate-400 group-hover:text-slate-600 mb-2 transition-colors" />
                      <p className="text-sm font-bold text-slate-600">Tomar Foto</p>
                      <p className="text-[10px] text-slate-400 mt-1 font-medium">Identificación o corredor</p>
                    </div>
                    <input type="file" accept="image/*" capture="environment" className="hidden" onChange={handleCapturaFoto} />
                  </label>
                ) : (
                  <div className="relative w-full h-48 rounded-2xl overflow-hidden border border-slate-200 shadow-sm group">
                    <img src={fotoPreview} alt="Preview" className="w-full h-full object-cover" />
                    <label className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm flex flex-col items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer">
                      <Upload className="w-8 h-8 text-white mb-2"/>
                      <span className="text-xs font-bold text-white uppercase tracking-widest">Cambiar Foto</span>
                      <input type="file" accept="image/*" capture="environment" className="hidden" onChange={handleCapturaFoto} />
                    </label>
                  </div>
                )}
              </div>

              <button type="submit" disabled={procesando || !fotoArchivo} className="w-full bg-slate-900 hover:bg-black text-white py-4 rounded-xl font-black uppercase tracking-widest shadow-lg shadow-slate-900/20 text-sm flex justify-center items-center transition-all active:scale-[0.98] disabled:opacity-50">
                {procesando ? 'Guardando...' : <><CheckCircle className="w-4 h-4 mr-2" /> Finalizar Entrega</>}
              </button>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* MODAL PARA VER LA FOTO DE EVIDENCIA */}
      {isMounted && modalEvidencia && createPortal(
        <div className="fixed inset-0 bg-slate-900/95 backdrop-blur-md flex items-center justify-center z-[9999] p-4" onClick={() => setModalEvidencia(null)}>
          <div className="relative max-w-lg w-full animate-in zoom-in-95 duration-200">
            <button className="absolute -top-12 right-0 text-white/50 hover:text-white transition-colors bg-white/10 p-2 rounded-full"><X size={20}/></button>
            <img src={modalEvidencia} alt="Evidencia de entrega" className="w-full h-auto max-h-[85vh] object-contain rounded-2xl shadow-2xl ring-1 ring-white/20" />
            <div className="text-center mt-6">
              <span className="bg-green-500/20 text-green-400 text-xs font-black uppercase tracking-widest px-4 py-2 rounded-full border border-green-500/30">
                <CheckCircle className="w-3.5 h-3.5 inline-block mr-1.5 -mt-0.5"/> Kit Entregado y Verificado
              </span>
            </div>
          </div>
        </div>,
        document.body
      )}

    </section>
  );
}
