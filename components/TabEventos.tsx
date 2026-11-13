'use client';

import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { PlusCircle, ImageIcon, Calendar, Users, MapPin, Edit, Trash2, Save, X, Info, ShieldAlert, Search, Hash, ArrowUpDown, ChevronLeft, ChevronRight } from 'lucide-react';

export default function TabEventos({ recargarDatos, eventos = [], userRole, userId }: any) {
  console.log("Eventos recibidos del servidor:", eventos);
  const [enviando, setEnviando] = useState(false);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [misEventosPermitidos, setMisEventosPermitidos] = useState<string[]>([]);
  
  // ESTADOS DE FILTRADO Y PAGINACIÓN
  const [busquedaEvento, setBusquedaEvento] = useState(''); 
  const [viewMode, setViewMode] = useState<'activos' | 'pasados'>('activos');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [currentPage, setCurrentPage] = useState(1);
  const ITEMS_PER_PAGE = 25;

  const [form, setForm] = useState({
    nombre_carrera: '',
    fecha: '',
    organizador: '',
    distancia: '',
    cupo_maximo: '500',
    folio_inicial: '1', 
    imagen_evento: '',
    descripcion: '',
    nombre_precio_1: 'Individual',
    precio_1: '',
    nombre_precio_2: '',
    precio_2: ''
  });

  // Resetear paginación si el usuario busca, cambia de pestaña o cambia el orden
  useEffect(() => {
    setCurrentPage(1);
  }, [busquedaEvento, viewMode, sortOrder]);

  // CARGAR PERMISOS DEL MODERADOR
  useEffect(() => {
    const cargarPermisos = async () => {
      if (userRole === 'Moderador' && userId) {
        const { data: perfil } = await supabase.from('perfiles').select('eventos_asignados').eq('id', userId).single();
        if (perfil && perfil.eventos_asignados) {
          setMisEventosPermitidos(perfil.eventos_asignados);
        }
      }
    };
    cargarPermisos();
  }, [userId, userRole]);

  // ==========================================
  // LÓGICA MAESTRA: FILTRADO, ORDEN Y PAGINACIÓN
  // ==========================================
  const hoy = new Date().toISOString().split('T')[0];

  // 1. Filtrar por rol y por texto de búsqueda
  const eventosBase = (userRole === 'Moderador' 
    ? eventos.filter((ev: any) => misEventosPermitidos.includes(ev.id))
    : eventos)
    .filter((ev: any) => ev.nombre_carrera.toLowerCase().includes(busquedaEvento.toLowerCase()));

  // 2. Dividir en Activos (Próximos) y Pasados
  const eventosActivos = eventosBase.filter((ev: any) => ev.fecha >= hoy);
  const eventosPasados = eventosBase.filter((ev: any) => ev.fecha < hoy);

  // 3. Seleccionar la lista según la pestaña activa
  let listaActual = viewMode === 'activos' ? eventosActivos : eventosPasados;

  // 4. Aplicar el orden cronológico
  listaActual.sort((a: any, b: any) => {
    const timeA = new Date(a.fecha).getTime();
    const timeB = new Date(b.fecha).getTime();
    return sortOrder === 'asc' ? timeA - timeB : timeB - timeA;
  });

  // 5. Aplicar paginación (25 elementos)
  const totalPages = Math.ceil(listaActual.length / ITEMS_PER_PAGE);
  const paginatedList = listaActual.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);

  // ==========================================
  // MANEJO DE FORMULARIO
  // ==========================================
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const resetForm = () => {
    setEditandoId(null);
    setForm({ nombre_carrera: '', fecha: '', organizador: '', distancia: '', cupo_maximo: '500', folio_inicial: '1', imagen_evento: '', descripcion: '', nombre_precio_1: 'Individual', precio_1: '', nombre_precio_2: '', precio_2: '' });
  };

  const handleEdit = (ev: any) => {
    setEditandoId(ev.id);
    setForm({
      nombre_carrera: ev.nombre_carrera || '',
      fecha: ev.fecha || '',
      organizador: ev.organizador || '',
      distancia: ev.distancia || '',
      cupo_maximo: ev.cupo_maximo?.toString() || '500',
      folio_inicial: ev.folio_inicial?.toString() || '1',
      imagen_evento: ev.imagen_evento || '',
      descripcion: ev.descripcion || '',
      nombre_precio_1: ev.nombre_precio_1 || 'Individual',
      precio_1: ev.precio_1?.toString() || '',
      nombre_precio_2: ev.nombre_precio_2 || '',
      precio_2: ev.precio_2?.toString() || ''
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDelete = async (id: string, nombre: string) => {
    if (userRole !== 'Administrador') {
      alert("No tienes permisos para eliminar eventos.");
      return;
    }
    if (window.confirm(`¿Estás seguro de eliminar la carrera "${nombre}"? Esta acción borrará la configuración.`)) {
      const { error } = await supabase.from('eventos').delete().eq('id', id);
      if (error) alert("Error al eliminar: " + error.message);
      else if (recargarDatos) recargarDatos();
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (userRole === 'Moderador' && !editandoId) {
      alert("Los moderadores no pueden crear nuevas carreras.");
      return;
    }

    setEnviando(true);
    const datosEvento: any = { ...form };
    if (!datosEvento.nombre_precio_2) datosEvento.nombre_precio_2 = null;
    if (!datosEvento.precio_2 || datosEvento.precio_2 === '') datosEvento.precio_2 = null;

    let resultado;
    if (editandoId) {
      resultado = await supabase.from('eventos').update(datosEvento).eq('id', editandoId);
    } else {
      resultado = await supabase.from('eventos').insert([datosEvento]);
    }

    if (resultado.error) {
      alert("Error: " + resultado.error.message);
    } else {
      alert(editandoId ? "¡Carrera actualizada!" : "¡Carrera publicada!");
      resetForm();
      if (recargarDatos) recargarDatos();
    }
    setEnviando(false);
  };

  return (
    <section className="animate-in fade-in slide-in-from-bottom-2 duration-500 space-y-10">
      
      {/* ========================================================= */}
      {/* FORMULARIO (SILICON VALLEY VIBE)                          */}
      {/* ========================================================= */}
      {(userRole === 'Administrador' || (userRole === 'Moderador' && editandoId)) && (
        <div className="bg-white p-6 md:p-8 rounded-3xl shadow-sm ring-1 ring-slate-200">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 border-b border-slate-100 pb-5 gap-4">
            <h2 className="text-xl font-black text-slate-900 tracking-tight flex items-center">
              {editandoId ? <Edit className="mr-2.5 text-slate-900 w-6 h-6" /> : <PlusCircle className="mr-2.5 text-slate-900 w-6 h-6" />}
              {editandoId ? `Editando: ${form.nombre_carrera}` : 'Configurar Nueva Carrera'}
            </h2>
            {editandoId && (
              <button onClick={resetForm} className="text-xs font-bold text-slate-500 hover:text-slate-900 hover:bg-slate-100 px-3 py-1.5 rounded-lg transition-colors flex items-center">
                <X className="w-3.5 h-3.5 mr-1" /> Cancelar Edición
              </button>
            )}
          </div>

          <form onSubmit={handleSubmit} className="space-y-8">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              <div className="md:col-span-2 lg:col-span-3">
                <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1.5 tracking-wider">Nombre de la Carrera *</label>
                <input type="text" name="nombre_carrera" required value={form.nombre_carrera} onChange={handleChange} placeholder="Ej. Maratón Internacional" className="w-full bg-slate-50 border border-slate-200 focus:border-slate-900 focus:ring-4 focus:ring-slate-900/5 rounded-xl p-3.5 outline-none transition-all text-sm font-bold text-slate-900 placeholder:text-slate-400" />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1.5 tracking-wider flex items-center"><Calendar className="w-3.5 h-3.5 mr-1"/> Fecha del Evento *</label>
                <input type="date" name="fecha" required value={form.fecha} onChange={handleChange} className="w-full bg-slate-50 border border-slate-200 focus:border-slate-900 focus:ring-4 focus:ring-slate-900/5 rounded-xl p-3.5 outline-none transition-all text-sm font-medium text-slate-900" />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1.5 tracking-wider flex items-center"><Users className="w-3.5 h-3.5 mr-1"/> Cupo Máximo *</label>
                <input type="number" name="cupo_maximo" required value={form.cupo_maximo} onChange={handleChange} className="w-full bg-slate-50 border border-slate-200 focus:border-slate-900 focus:ring-4 focus:ring-slate-900/5 rounded-xl p-3.5 outline-none transition-all text-sm font-black text-slate-900" />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1.5 tracking-wider flex items-center"><Hash className="w-3.5 h-3.5 mr-1"/> Folio Inicial *</label>
                <input type="number" name="folio_inicial" required value={form.folio_inicial} onChange={handleChange} placeholder="Ej. 1 o 501" className="w-full bg-slate-50 border border-slate-200 focus:border-slate-900 focus:ring-4 focus:ring-slate-900/5 rounded-xl p-3.5 outline-none transition-all text-sm font-black text-slate-900" />
              </div>

              <div className="lg:col-span-2">
                <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1.5 tracking-wider">Organizador / Empresa *</label>
                <input type="text" name="organizador" required value={form.organizador} onChange={handleChange} placeholder="Ej. ACTV Eventos" className="w-full bg-slate-50 border border-slate-200 focus:border-slate-900 focus:ring-4 focus:ring-slate-900/5 rounded-xl p-3.5 outline-none transition-all text-sm text-slate-900 placeholder:text-slate-400" />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1.5 tracking-wider flex items-center"><MapPin className="w-3.5 h-3.5 mr-1"/> Distancia(s) *</label>
                <input type="text" name="distancia" required value={form.distancia} onChange={handleChange} placeholder="Ej. 5K, 10K, 21K" className="w-full bg-slate-50 border border-slate-200 focus:border-slate-900 focus:ring-4 focus:ring-slate-900/5 rounded-xl p-3.5 outline-none transition-all text-sm font-bold text-slate-900 placeholder:text-slate-400" />
              </div>

              <div className="md:col-span-2 lg:col-span-3">
                <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1.5 tracking-wider flex items-center"><ImageIcon className="w-4 h-4 mr-1"/> URL Imagen del Evento (Póster)</label>
                <input type="url" name="imagen_evento" value={form.imagen_evento} onChange={handleChange} placeholder="https://tu-web.com/poster.jpg" className="w-full bg-slate-50 border border-slate-200 focus:border-slate-900 focus:ring-4 focus:ring-slate-900/5 rounded-xl p-3.5 outline-none transition-all text-sm text-slate-600 placeholder:text-slate-400 font-mono" />
              </div>
            </div>

            <div className="bg-slate-50 rounded-2xl p-6 border border-slate-200">
              <h3 className="text-[11px] font-bold text-slate-500 mb-4 uppercase tracking-wider">Configuración de Paquetes</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm ring-1 ring-transparent focus-within:ring-slate-900 transition-all">
                  <p className="text-[10px] font-black text-slate-900 mb-3 uppercase tracking-widest">Paquete Principal *</p>
                  <div className="space-y-3">
                    <input type="text" name="nombre_precio_1" required placeholder="Nombre (Ej. Individual)" value={form.nombre_precio_1} onChange={handleChange} className="w-full bg-slate-50 border border-slate-200 rounded-lg p-3 text-sm outline-none focus:border-slate-400 transition-colors text-slate-900 placeholder:text-slate-400" />
                    <div className="relative">
                      <span className="absolute left-3 top-3 text-slate-400 font-bold">$</span>
                      <input type="number" name="precio_1" required placeholder="0.00" value={form.precio_1} onChange={handleChange} className="w-full bg-slate-50 border border-slate-200 rounded-lg p-3 pl-7 text-sm outline-none focus:border-slate-400 font-black text-slate-900 placeholder:text-slate-400" />
                    </div>
                  </div>
                </div>
                
                <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm ring-1 ring-transparent focus-within:ring-slate-900 opacity-80 hover:opacity-100 focus-within:opacity-100 transition-all">
                  <p className="text-[10px] font-black text-slate-500 mb-3 uppercase tracking-widest">Paquete Secundario (Opcional)</p>
                  <div className="space-y-3">
                    <input type="text" name="nombre_precio_2" placeholder="Nombre (Ej. Relevos / VIP)" value={form.nombre_precio_2} onChange={handleChange} className="w-full bg-slate-50 border border-slate-200 rounded-lg p-3 text-sm outline-none focus:border-slate-400 transition-colors text-slate-900 placeholder:text-slate-400" />
                    <div className="relative">
                      <span className="absolute left-3 top-3 text-slate-400 font-bold">$</span>
                      <input type="number" name="precio_2" placeholder="0.00" value={form.precio_2} onChange={handleChange} className="w-full bg-slate-50 border border-slate-200 rounded-lg p-3 pl-7 text-sm outline-none focus:border-slate-400 font-black text-slate-900 placeholder:text-slate-400" />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="w-full">
              <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1.5 tracking-wider">Descripción Breve / Notas</label>
              <textarea name="descripcion" rows={2} value={form.descripcion} onChange={handleChange} placeholder="Información adicional sobre la ruta, kits o premiación..." className="w-full bg-slate-50 border border-slate-200 focus:border-slate-900 focus:ring-4 focus:ring-slate-900/5 rounded-xl p-3.5 outline-none transition-all resize-none text-sm text-slate-900 placeholder:text-slate-400" />
            </div>

            <button type="submit" disabled={enviando} className={`w-full text-white font-bold py-4 rounded-xl shadow-md transition-all active:scale-[0.98] text-sm flex justify-center items-center ${editandoId ? 'bg-slate-800 hover:bg-slate-900' : 'bg-slate-900 hover:bg-black'}`}>
              {enviando ? 'Procesando...' : (editandoId ? <><Save className="w-4 h-4 mr-2"/> Actualizar Evento</> : <><PlusCircle className="w-4 h-4 mr-2"/> Publicar Carrera</>)}
            </button>
          </form>
        </div>
      )}

      {userRole === 'Moderador' && misEventosPermitidos.length === 0 && (
        <div className="bg-slate-100 border border-slate-200 text-slate-500 p-8 rounded-3xl flex flex-col items-center justify-center text-center">
          <ShieldAlert className="w-12 h-12 mb-3 text-slate-400"/>
          <h3 className="text-lg font-bold text-slate-700">Sin Asignaciones</h3>
          <p className="text-sm font-medium mt-1">Actualmente no tienes ninguna carrera asignada para moderar.</p>
        </div>
      )}

      {/* ========================================================= */}
      {/* SECCIÓN DE LISTADO Y NAVEGACIÓN                             */}
      {/* ========================================================= */}
      <div className={`pt-6`}>
        
        {/* CABECERA: TÍTULO, TABS Y FILTROS */}
        <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-4 mb-6">
          <h3 className="text-xl font-black text-slate-900 tracking-tight shrink-0">
            {userRole === 'Administrador' ? 'Directorio de Carreras' : 'Mis Carreras Asignadas'}
          </h3>
          
          <div className="flex flex-col md:flex-row items-center gap-3 w-full xl:w-auto bg-white p-2 rounded-2xl ring-1 ring-slate-200 shadow-sm overflow-hidden">
            
            {/* Pestañas Flotantes */}
            <div className="flex bg-slate-100 p-1 rounded-xl w-full md:w-auto shrink-0">
              <button onClick={() => setViewMode('activos')} className={`flex-1 md:flex-none px-5 py-2 rounded-lg text-xs font-bold transition-all ${viewMode === 'activos' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                Próximas ({eventosActivos.length})
              </button>
              <button onClick={() => setViewMode('pasados')} className={`flex-1 md:flex-none px-5 py-2 rounded-lg text-xs font-bold transition-all ${viewMode === 'pasados' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                Finalizadas ({eventosPasados.length})
              </button>
            </div>

            <div className="w-full md:w-px h-px md:h-6 bg-slate-200 mx-1"></div>

            {/* Buscador */}
            <div className="relative w-full md:w-56 shrink-0">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <input 
                type="text" 
                placeholder="Buscar..." 
                value={busquedaEvento} 
                onChange={(e) => setBusquedaEvento(e.target.value)} 
                className="w-full pl-9 pr-3 py-2 bg-transparent text-sm outline-none text-slate-900 placeholder:text-slate-400 font-medium"
              />
            </div>

            <div className="w-full md:w-px h-px md:h-6 bg-slate-200 mx-1"></div>

            {/* Ordenamiento */}
            <div className="relative w-full md:w-auto shrink-0">
              <ArrowUpDown className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500" />
              <select value={sortOrder} onChange={e => setSortOrder(e.target.value as 'asc' | 'desc')} className="w-full pl-9 pr-8 py-2 bg-transparent text-xs font-bold text-slate-700 outline-none appearance-none cursor-pointer">
                <option value="asc">Más próximas primero</option>
                <option value="desc">Más lejanas primero</option>
              </select>
            </div>

          </div>
        </div>

        {/* GRID DE EVENTOS */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-5">
          {paginatedList.map((ev: any) => {
            const esPasado = viewMode === 'pasados'; 
            
            return (
              <div key={ev.id} className={`bg-white rounded-2xl overflow-hidden ring-1 transition-all flex flex-col group ${esPasado ? 'ring-slate-200 opacity-80 hover:opacity-100' : 'ring-slate-200 shadow-sm hover:shadow-xl hover:-translate-y-1 hover:ring-slate-300'}`}>
                
                {/* Imagen del evento (Aspect Ratio Fijo) */}
                <div className="relative w-full aspect-video bg-slate-100 overflow-hidden shrink-0">
                  {ev.imagen_evento ? (
                    <img src={ev.imagen_evento} alt="póster" className={`w-full h-full object-cover transition-transform duration-700 ${esPasado ? 'grayscale group-hover:grayscale-0' : 'group-hover:scale-105'}`} />
                  ) : (
                    <div className="w-full h-full bg-slate-800 flex items-center justify-center">
                      <ImageIcon className="text-white/20 w-10 h-10" />
                    </div>
                  )}
                  <div className="absolute top-3 right-3 bg-white/95 backdrop-blur-md px-2.5 py-1 rounded-md shadow-sm">
                    {esPasado ? (
                      <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Finalizado</p>
                    ) : (
                      <p className="text-[9px] font-black text-slate-900 uppercase tracking-widest"><Users className="w-3 h-3 inline-block mr-1" /> {ev.cupo_maximo} cupos</p>
                    )}
                  </div>
                </div>

                {/* Contenido Flexible */}
                <div className="p-5 flex flex-col flex-grow justify-between space-y-4">
                  <div>
                    <h4 className="text-sm font-bold text-slate-900 leading-snug line-clamp-2" title={ev.nombre_carrera}>{ev.nombre_carrera}</h4>
                    <p className={`text-[11px] font-bold mt-1.5 flex items-center tracking-wide ${esPasado ? 'text-slate-400' : 'text-slate-500'}`}>
                      <Calendar className="w-3.5 h-3.5 mr-1.5" /> {ev.fecha}
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-2 mt-auto">
                    <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-100">
                      <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">Distancia</p>
                      <p className="text-xs font-black text-slate-700">{ev.distancia}</p>
                    </div>
                    <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-100">
                      <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">Desde</p>
                      <p className="text-xs font-black text-slate-900">${ev.precio_1}</p>
                    </div>
                  </div>

                  <div className="flex gap-2 pt-1 border-t border-slate-100">
                    <button onClick={() => handleEdit(ev)} className="flex-grow bg-slate-50 text-slate-700 hover:bg-slate-100 hover:text-slate-900 py-2.5 rounded-xl text-[11px] font-bold uppercase tracking-wider transition-colors flex items-center justify-center border border-slate-200">
                      <Edit className="w-3.5 h-3.5 mr-1.5" /> Editar
                    </button>
                    
                    {userRole === 'Administrador' && (
                      <button onClick={() => handleDelete(ev.id, ev.nombre_carrera)} className="bg-white border border-slate-200 text-slate-400 hover:bg-red-50 hover:border-red-200 hover:text-red-600 px-3.5 rounded-xl transition-colors shrink-0" title="Eliminar Carrera">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* ESTADOS VACÍOS Y PAGINACIÓN */}
        {listaActual.length === 0 ? (
          <div className="py-16 text-center bg-white ring-1 ring-slate-200 rounded-3xl">
            <Calendar className="w-10 h-10 text-slate-300 mx-auto mb-3" />
            <p className="text-sm font-medium text-slate-500">No se encontraron carreras en esta categoría.</p>
          </div>
        ) : totalPages > 1 ? (
          <div className="flex flex-col sm:flex-row justify-between items-center mt-8 bg-white p-4 rounded-2xl ring-1 ring-slate-200 shadow-sm gap-4">
            <p className="text-xs text-slate-500 font-medium">
              Mostrando <span className="font-bold text-slate-900">{(currentPage - 1) * ITEMS_PER_PAGE + 1}</span> a <span className="font-bold text-slate-900">{Math.min(currentPage * ITEMS_PER_PAGE, listaActual.length)}</span> de <span className="font-bold text-slate-900">{listaActual.length}</span> eventos
            </p>
            <div className="flex gap-2">
              <button onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))} disabled={currentPage === 1} className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm font-bold text-slate-600 hover:bg-slate-50 hover:text-slate-900 disabled:opacity-40 disabled:cursor-not-allowed flex items-center transition-colors shadow-sm">
                <ChevronLeft className="w-4 h-4" />
              </button>
              <div className="flex items-center px-4 bg-slate-50 border border-slate-200 rounded-lg text-[11px] font-bold text-slate-700 uppercase tracking-widest">
                {currentPage} / {totalPages}
              </div>
              <button onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))} disabled={currentPage === totalPages} className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm font-bold text-slate-600 hover:bg-slate-50 hover:text-slate-900 disabled:opacity-40 disabled:cursor-not-allowed flex items-center transition-colors shadow-sm">
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        ) : null}

      </div>
    </section>
  );
}