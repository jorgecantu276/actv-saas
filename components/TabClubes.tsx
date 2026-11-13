'use client';

import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
// ✅ IMPORTANTE: Se agregó MessageCircle para el botón de WhatsApp
import { Shield, PlusCircle, Trash2, Edit, Users, Phone, ImageIcon, Share2, Camera, Globe, Save, Search, Download, FileSpreadsheet, ArrowUpDown, X, UserSearch, ChevronRight, ChevronLeft, UserCircle, ChevronDown, MessageCircle } from 'lucide-react'; 

export default function TabClubes({ recargarDatos, clubes = [], atletas = [] }: any) {
  const [enviando, setEnviando] = useState(false);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  
  const [busquedaClub, setBusquedaClub] = useState('');
  const [orden, setOrden] = useState('az');

  // ✅ ESTADOS PARA EL PANEL DE ATLETAS DEL CLUB SELECCIONADO
  const [selectedClubAthletes, setSelectedClubAthletes] = useState<any[]>([]);  
  const [selectedClubName, setSelectedClubName] = useState<string | null>(null);
  const [busquedaAtletaLocal, setBusquedaAtletaLocal] = useState('');
  const [atletaCurrentPage, setAtletaCurrentPage] = useState(1);
  const ATLETAS_PER_PAGE = 25;

  const [form, setForm] = useState({
    nombre: '',
    responsable1: '',
    telefono1: '',
    responsable2: '',
    telefono2: '',
    logo_url: '',
    facebook_url: '',
    instagram_url: '',
    web_url: ''
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setEnviando(true);

    const datosParaEnviar: any = { ...form };
    if (!datosParaEnviar.logo_url || datosParaEnviar.logo_url.trim() === '') datosParaEnviar.logo_url = null;
    if (!datosParaEnviar.facebook_url || datosParaEnviar.facebook_url.trim() === '') datosParaEnviar.facebook_url = null;
    if (!datosParaEnviar.instagram_url || datosParaEnviar.instagram_url.trim() === '') datosParaEnviar.instagram_url = null;
    if (!datosParaEnviar.web_url || datosParaEnviar.web_url.trim() === '') datosParaEnviar.web_url = null;

    if (editandoId) {
      const { error } = await supabase.from('clubes').update(datosParaEnviar).eq('id', editandoId);
      if (error) {
        alert("Error al actualizar club: " + error.message);
      } else {
        alert("¡Club actualizado con éxito!");
        resetForm();
        if (recargarDatos) recargarDatos();
      }
    } else {
      const { error } = await supabase.from('clubes').insert([datosParaEnviar]);
      if (error) {
        alert("Error al registrar club: " + error.message);
      } else {
        alert("¡Club registrado con éxito!");
        resetForm();
        if (recargarDatos) recargarDatos();
      }
    }
    setEnviando(false);
  };

  const handleEdit = (club: any) => {
    // Cerramos el panel de atletas si está abierto antes de editar
    closeClubAthletesPanel();
    setEditandoId(club.id);
    setForm({
      nombre: club.nombre || '',
      responsable1: club.responsable1 || '',
      telefono1: club.telefono1 || '',
      responsable2: club.responsable2 || '',
      telefono2: club.telefono2 || '',
      logo_url: club.logo_url || '',
      facebook_url: club.facebook_url || '',
      instagram_url: club.instagram_url || '',
      web_url: club.web_url || ''
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDelete = async (id: string, nombre: string) => {
    if (window.confirm(`¿Estás seguro de eliminar el club "${nombre}"? Esta acción no se puede deshacer.`)) {
      const { error } = await supabase.from('clubes').delete().eq('id', id);
      if (error) {
        alert("Error al eliminar: " + error.message);
      } else {
        if (recargarDatos) recargarDatos();
      }
    }
  };

  const resetForm = () => {
    setEditandoId(null);
    setForm({ nombre: '', responsable1: '', telefono1: '', responsable2: '', telefono2: '', logo_url: '', facebook_url: '', instagram_url: '', web_url: '' });
  };

  // ✅ FUNCIONES PARA EL PANEL LATERAL DE ATLETAS
  const handleSelectClubForAthletes = (clubName: string) => {
    const clubAthletes = atletas.filter((atleta: any) => atleta.club === clubName);
    setSelectedClubAthletes(clubAthletes);
    setSelectedClubName(clubName);
    setBusquedaAtletaLocal(''); // Reset buscador local
    setAtletaCurrentPage(1); // Reset paginación
  };

  const closeClubAthletesPanel = () => {
    setSelectedClubName(null);
  };

  // ==========================================
  // LÓGICA DE FILTRADO, CONTEO Y ORDENAMIENTO (BLINDADO)
  // ==========================================
  
  // 1. Primero mapeamos los clubes para agregarles el conteo exacto de atletas
  let clubesConConteo = clubes.map((c: any) => {
    const totalAtletas = atletas.filter((a: any) => a.club === c.nombre).length;
    return { ...c, totalAtletas };
  });

  // 2. Filtramos por la barra de búsqueda (Clubes)
  let clubesVisibles = clubesConConteo.filter((club: any) => 
    club.nombre?.toLowerCase().includes(busquedaClub.toLowerCase()) ||
    club.responsable1?.toLowerCase().includes(busquedaClub.toLowerCase())
  );

  // 3. Ordenamos según el selector CON BLINDAJE DE ESPACIOS (.trim())
  clubesVisibles.sort((a: any, b: any) => {
    const nombreA = String(a.nombre || '').trim();
    const nombreB = String(b.nombre || '').trim();

    if (orden === 'az') return nombreA.localeCompare(nombreB, 'es', { numeric: true, sensitivity: 'base' });
    if (orden === 'za') return nombreB.localeCompare(nombreA, 'es', { numeric: true, sensitivity: 'base' });
    if (orden === 'mayor') return (b.totalAtletas || 0) - (a.totalAtletas || 0);
    if (orden === 'menor') return (a.totalAtletas || 0) - (b.totalAtletas || 0);
    return 0;
  });

  // ✅ LÓGICA DEL PANEL DE ATLETAS (BUSQUEDA Y PAGINACIÓN LOCAL)
  let atletasFiltradosLocal = selectedClubAthletes.filter((atleta: any) => {
    const nombreCompleto = `${atleta.nombre} ${atleta.apellido}`.toLowerCase();
    return nombreCompleto.includes(busquedaAtletaLocal.toLowerCase());
  });

  const totalAtletasPages = Math.ceil(atletasFiltradosLocal.length / ATLETAS_PER_PAGE);
  const indexUltimaAtleta = atletaCurrentPage * ATLETAS_PER_PAGE;
  const indexPrimeraAtleta = indexUltimaAtleta - ATLETAS_PER_PAGE;
  const atletasPaginadosLocal = atletasFiltradosLocal.slice(indexPrimeraAtleta, indexUltimaAtleta);

  // ==========================================
  // FUNCIONES DE EXPORTACIÓN (CSV Y XLSX)
  // ==========================================
  const exportarCSV = () => {
    const cabeceras = ['Nombre del Club', 'Total Atletas', 'Responsable 1', 'Teléfono 1', 'Responsable 2', 'Teléfono 2', 'Redes Sociales', 'Sitio Web'];
    const filas = clubesVisibles.map((c: any) => [
      c.nombre || '', c.totalAtletas || 0, c.responsable1 || '', c.telefono1 || '', c.responsable2 || '', c.telefono2 || '',
      `FB: ${c.facebook_url || 'N/A'}, IG: ${c.instagram_url || 'N/A'}`, c.web_url || 'N/A'
    ]);
    const csvContent = [cabeceras.join(','), ...filas.map((r: any[]) => r.map((f: any) => `"${String(f ?? '')}"`).join(','))].join('\n');
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.setAttribute('download', `Directorio_Clubes_ACTV_${new Date().getTime()}.csv`);
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
  };

  // ✅ NUEVA FUNCIÓN: EXPORTAR A XLSX (.xls)
  const exportarXLSX = () => {
    let tablaHTML = '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8" /></head><body><table>';
    
    tablaHTML += '<tr><th>Folio</th><th>Nombre del Club</th><th>Total Atletas</th><th>Responsable 1</th><th>Teléfono 1</th><th>Responsable 2</th><th>Teléfono 2</th><th>Facebook</th><th>Instagram</th><th>Sitio Web</th></tr>';
    
    clubesVisibles.forEach((c: any, index: number) => {
      tablaHTML += `<tr>
        <td>${index + 1}</td>
        <td>${c.nombre || ''}</td>
        <td>${c.totalAtletas || 0}</td>
        <td>${c.responsable1 || 'N/A'}</td>
        <td>${c.telefono1 || 'N/A'}</td>
        <td>${c.responsable2 || 'N/A'}</td>
        <td>${c.telefono2 || 'N/A'}</td>
        <td>${c.facebook_url || 'N/A'}</td>
        <td>${c.instagram_url || 'N/A'}</td>
        <td>${c.web_url || 'N/A'}</td>
      </tr>`;
    });
    
    tablaHTML += '</table></body></html>';
    
    const blob = new Blob([tablaHTML], { type: 'application/vnd.ms-excel;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.setAttribute('download', `Directorio_Clubes_ACTV_${new Date().getTime()}.xls`);
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
  };

  return (
    <section className="animate-in fade-in slide-in-from-bottom-2 duration-500 space-y-8 relative">
      
      {/* ========================================================= */}
      {/* FORMULARIO DE REGISTRO / EDICIÓN ENTERPRISE                 */}
      {/* ========================================================= */}
      <div className="bg-white p-6 md:p-8 rounded-3xl shadow-sm ring-1 ring-slate-200">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 border-b border-slate-100 pb-5 gap-4">
          <h2 className="text-xl font-black text-slate-900 tracking-tight flex items-center">
            <Shield className="mr-2.5 text-blue-600 w-6 h-6" /> 
            {editandoId ? `Editando: ${form.nombre}` : 'Registrar Club Deportivo'}
          </h2>
          {editandoId && (
            <button type="button" onClick={resetForm} className="text-xs font-bold text-slate-500 hover:text-red-500 hover:bg-slate-100 px-3 py-1.5 rounded-lg transition-colors flex items-center">
              <X className="w-3.5 h-3.5 mr-1" /> Cancelar Edición
            </button>
          )}
        </div>
        
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
            <div className="md:col-span-2 xl:col-span-3 space-y-1.5">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider pl-1">Nombre del Club o Equipo *</label>
              <input type="text" name="nombre" required value={form.nombre} onChange={handleChange} placeholder="Ej. ACTV Runners" className="w-full bg-slate-50 border border-slate-200 focus:border-slate-400 focus:ring-4 focus:ring-blue-100 rounded-xl p-3.5 outline-none transition-all shadow-sm text-slate-900 placeholder:text-slate-400 font-bold text-lg" />
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider pl-1 flex items-center"><UserCircle className="w-3 h-3 mr-1"/> Responsable Principal *</label>
              <input type="text" name="responsable1" required value={form.responsable1} onChange={handleChange} placeholder="Nombre completo" className="w-full bg-slate-50 border border-slate-200 focus:border-slate-400 rounded-xl p-3 outline-none transition-all shadow-sm text-sm font-bold text-slate-900 placeholder:text-slate-400" />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider pl-1 flex items-center"><Phone className="w-3 h-3 mr-1"/> Teléfono (Resp. 1) *</label>
              <input type="tel" name="telefono1" required value={form.telefono1} onChange={handleChange} placeholder="Ej. 868 123 4567" className="w-full bg-slate-50 border border-slate-200 focus:border-slate-400 rounded-xl p-3 outline-none transition-all shadow-sm text-sm font-black text-slate-900 placeholder:text-slate-400" />
            </div>

            <div className="space-y-1.5 xl:col-start-1">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider pl-1 flex items-center"><UserCircle className="w-3 h-3 mr-1"/> Responsable Secundario *</label>
              <input type="text" name="responsable2" required value={form.responsable2} onChange={handleChange} placeholder="Nombre completo" className="w-full bg-slate-50 border border-slate-200 focus:border-slate-400 rounded-xl p-3 outline-none transition-all shadow-sm text-sm text-slate-900 placeholder:text-slate-400" />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider pl-1 flex items-center"><Phone className="w-3 h-3 mr-1"/> Teléfono (Resp. 2) *</label>
              <input type="tel" name="telefono2" required value={form.telefono2} onChange={handleChange} placeholder="Ej. 868 765 4321" className="w-full bg-slate-50 border border-slate-200 focus:border-slate-400 rounded-xl p-3 outline-none transition-all shadow-sm text-sm text-slate-900 placeholder:text-slate-400" />
            </div>

            <div className="md:col-span-2 xl:col-span-1 space-y-1.5">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider pl-1 flex items-center"><ImageIcon className="w-3 h-3 mr-1"/> URL Imagen del Logo (Póster)</label>
              <input type="url" name="logo_url" value={form.logo_url} onChange={handleChange} placeholder="https://ejemplo.com/logo.png" className="w-full bg-slate-50 border border-slate-200 focus:border-slate-400 rounded-xl p-3 outline-none transition-all shadow-sm text-xs text-slate-600 placeholder:text-slate-400 font-mono" />
            </div>
          </div>

          <div className="bg-slate-50/50 rounded-2xl p-6 border border-slate-100 mt-6">
            <h3 className="text-[11px] font-bold text-slate-500 mb-4 flex items-center uppercase tracking-widest">
              <Globe className="w-4 h-4 mr-2 text-slate-400"/> Presencia Digital (URL)
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              <div className="space-y-1">
                <label className="block text-[10px] font-bold text-blue-600 uppercase flex items-center tracking-wider"><Share2 className="w-3 h-3 mr-1"/> Perfil Social FB</label>
                <input type="url" name="facebook_url" value={form.facebook_url} onChange={handleChange} placeholder="https://facebook.com/..." className="w-full bg-white border border-slate-200 rounded-lg p-3 outline-none text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-300" />
              </div>
              <div className="space-y-1">
                <label className="block text-[10px] font-bold text-pink-600 uppercase flex items-center tracking-wider"><Camera className="w-3 h-3 mr-1"/> Galería IG</label>
                <input type="url" name="instagram_url" value={form.instagram_url} onChange={handleChange} placeholder="https://instagram.com/..." className="w-full bg-white border border-slate-200 rounded-lg p-3 outline-none text-sm text-slate-900 placeholder:text-slate-400 focus:border-pink-300" />
              </div>
              <div className="space-y-1">
                <label className="block text-[10px] font-bold text-slate-600 uppercase flex items-center tracking-wider"><Globe className="w-3 h-3 mr-1"/> Página Web</label>
                <input type="url" name="web_url" value={form.web_url} onChange={handleChange} placeholder="https://www..." className="w-full bg-white border border-slate-200 rounded-lg p-3 outline-none text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-300" />
              </div>
            </div>
          </div>

          <button type="submit" disabled={enviando || !form.nombre || !form.responsable1 || !form.telefono1} className="w-full bg-slate-900 hover:bg-black text-white py-4 rounded-xl font-black uppercase shadow-lg shadow-slate-900/10 text-sm flex justify-center items-center mt-6 transition-all active:scale-[0.98] disabled:opacity-50">
            {enviando ? 'Guardando...' : (editandoId ? <><Save className="w-5 h-5 mr-2" /> Actualizar Club</> : <><PlusCircle className="w-5 h-5 mr-2" /> Registrar Nuevo Club Deportivo</>)}
          </button>
        </form>
      </div>

      {/* ========================================================= */}
      {/* BARRA DE BÚSQUEDA Y LISTADO COMPACTO DE CLUBES              */}
      {/* ========================================================= */}
      <div className="pt-8 border-t border-slate-100">
        
        <div className="bg-white p-6 rounded-3xl ring-1 ring-slate-200 shadow-sm mb-6 no-print">
          <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-5">
            <h3 className="text-xl font-black text-slate-900 tracking-tight shrink-0">Directorio de Clubes ({clubesVisibles.length})</h3>
            
            <div className="flex flex-col md:flex-row gap-3 w-full lg:w-auto">
              
              <div className="relative w-full md:w-64 group">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 group-focus-within:text-slate-900 transition-colors" />
                <input type="text" placeholder="Buscar club por nombre o responsable..." value={busquedaClub} onChange={(e) => setBusquedaClub(e.target.value)} className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 focus:border-slate-400 rounded-xl outline-none focus:ring-4 focus:ring-slate-900/5 transition-all text-sm text-slate-900 placeholder:text-slate-400 font-medium" />
              </div>

              <div className="relative w-full md:w-auto shrink-0">
                <ArrowUpDown className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
                <select value={orden} onChange={(e) => setOrden(e.target.value)} className="w-full md:w-auto pl-9 pr-8 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold appearance-none cursor-pointer outline-none focus:border-slate-400 focus:ring-4 focus:ring-slate-900/5 transition-all text-slate-700">
                  <option value="az">A - Z</option>
                  <option value="za">Z - A</option>
                  <option value="mayor">Mayor Atletas</option>
                  <option value="menor">Menor Atletas</option>
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-3 w-3 text-slate-400 pointer-events-none" />
              </div>

              <div className="flex gap-2 w-full md:w-auto">
                <button onClick={exportarCSV} className="flex-1 md:flex-none text-xs font-bold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 px-4 py-2.5 rounded-xl transition-all shadow-sm flex items-center justify-center active:scale-95">
                  <Download className="w-4 h-4 md:mr-1" /> <span className="hidden md:inline">CSV</span>
                </button>
                <button onClick={exportarXLSX} className="flex-1 md:flex-none text-xs font-bold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 px-4 py-2.5 rounded-xl transition-all shadow-sm flex items-center justify-center active:scale-95">
                  <FileSpreadsheet className="w-4 h-4 mr-2 text-indigo-600" /> Excel
                </button>
              </div>
            </div>
          </div>
        </div>
        
        {/* LISTA COMPACTA DE CLUBES */}
        <div className="bg-white rounded-3xl shadow-sm ring-1 ring-slate-200 divide-y divide-slate-100 overflow-hidden no-print">
          {clubesVisibles.map((club: any) => (
            <div key={club.id} className="p-5 flex flex-col md:flex-row items-center md:items-start gap-5 hover:bg-blue-50/50 transition-colors group relative">
              
              <div className="w-16 h-16 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-center overflow-hidden shrink-0">
                {club.logo_url ? (
                  <img src={club.logo_url} alt={club.nombre} className="w-full h-full object-cover" />
                ) : (
                  <Shield className="w-8 h-8 text-slate-200" />
                )}
              </div>
              
              <div className="flex-grow text-center md:text-left space-y-2">
                <div className="flex items-center gap-3">
                  <h4 className="font-black text-slate-900 text-lg leading-none tracking-tight">{club.nombre}</h4>
                  <span className="bg-slate-900 text-white text-[9px] font-black uppercase px-2 py-0.5 mt-0.5 rounded tracking-widest">{club.responsable1}</span>
                </div>
                
                <div className="flex flex-col md:flex-row md:items-center text-slate-600 text-xs gap-x-6 gap-y-1.5 pt-1">
                  <p className="flex items-center"><UserCircle className="w-3 h-3 mr-1.5 text-slate-400"/> {club.responsable1} ({club.telefono1})</p>
                  <p className="flex items-center"><UserCircle className="w-3 h-3 mr-1.5 text-slate-400"/> {club.responsable2 || 'N/A'} ({club.telefono2 || 'N/A'})</p>
                  <div className="flex gap-2.5 text-slate-400 pt-1 md:pt-0">
                    {club.facebook_url && <a href={club.facebook_url} target="_blank" rel="noreferrer" title="Ver Facebook" className="hover:text-blue-600 transition-colors"><Share2 className="w-3.5 h-3.5"/></a>}
                    {club.instagram_url && <a href={club.instagram_url} target="_blank" rel="noreferrer" title="Ver Instagram" className="hover:text-pink-600 transition-colors"><Camera className="w-3.5 h-3.5"/></a>}
                    {club.web_url && <a href={club.web_url} target="_blank" rel="noreferrer" title="Ver Sitio Web" className="hover:text-black transition-colors"><Globe className="w-3.5 h-3.5"/></a>}
                  </div>
                </div>
              </div>

              {/* Conteo de Atletas (Clickable) */}
              <button 
                onClick={() => handleSelectClubForAthletes(club.nombre)} 
                title={`Ver ${club.totalAtletas} atletas de ${club.nombre}`} 
                className="flex items-center gap-2.5 text-slate-700 hover:text-blue-600 bg-slate-100 hover:bg-white p-4 rounded-2xl group-hover:shadow-inner transition-all active:scale-95 shrink-0"
              >
                <Users className="w-6 h-6 text-blue-500"/>
                <div className="text-right">
                    <p className="text-3xl font-black leading-none">{club.totalAtletas}</p>
                    <p className="text-[10px] uppercase font-black tracking-widest mt-1">Atletas</p>
                </div>
                <ChevronRight className="w-5 h-5 ml-1 text-slate-300"/>
              </button>
              
              {/* ACCIONES (HOVER) */}
              <div className="absolute right-5 top-5 opacity-0 group-hover:opacity-100 transition-opacity flex gap-2">
                <button onClick={() => handleEdit(club)} className="p-2 bg-white/80 backdrop-blur-sm border border-slate-200 text-slate-600 rounded-xl hover:bg-black hover:text-white hover:border-black transition-all shadow-sm" title="Editar Club">
                  <Edit className="w-4 h-4" />
                </button>
                <button onClick={() => handleDelete(club.id, club.nombre)} className="p-2 bg-white/80 backdrop-blur-sm border border-slate-200 text-red-500 rounded-xl hover:bg-red-50 hover:border-red-200 transition-all shadow-sm" title="Eliminar Club">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>

            </div>
          ))}

          {clubesVisibles.length === 0 && (
             <div className="col-span-full text-center py-20 bg-white/40">
               <Shield className="w-12 h-12 text-slate-200 mx-auto mb-4" />
               <p className="text-slate-400 font-bold tracking-tight">No se encontraron clubes o coincidan con tu búsqueda.</p>
             </div>
          )}
        </div>
      </div>

      {/* ========================================================= */}
      {/* PANEL DETALLADO DE ATLETAS DEL CLUB SELECCIONADO           */}
      {/* ========================================================= */}
      {selectedClubName && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex justify-end z-[9999] no-print transition-all duration-500 animate-in fade-in" onClick={closeClubAthletesPanel}>
          <div className="bg-white w-full max-w-lg md:max-w-xl xl:max-w-2xl h-full shadow-2xl relative flex flex-col p-8 overflow-hidden animate-in slide-in-from-right duration-300" onClick={(e) => e.stopPropagation()}>
            <button type="button" onClick={closeClubAthletesPanel} className="absolute top-6 right-6 text-slate-400 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-full p-2 transition-all"><X size={20}/></button>
            
            <div className="mb-6">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 flex items-center"><Users className="w-3 h-3 mr-1.5 text-blue-500"/> Integrantes del Club Deportivo</p>
              <h3 className="text-3xl font-black text-slate-900 leading-tight tracking-tight">{selectedClubName}</h3>
            </div>
            
            {/* BUSCADOR LOCAL DE ATLETAS DEL CLUB */}
            <div className="relative group mb-6">
              <UserSearch className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 group-focus-within:text-slate-900 transition-colors" />
              <input type="text" placeholder={`Buscar corredores de ${selectedClubName}...`} value={busquedaAtletaLocal} onChange={(e) => {setBusquedaAtletaLocal(e.target.value); setAtletaCurrentPage(1);}} className="w-full bg-slate-50 border border-slate-200 focus:border-slate-400 rounded-xl p-3.5 pl-11 outline-none transition-all text-sm font-medium text-slate-900 placeholder:text-slate-400" />
            </div>

            {atletasPaginadosLocal.length === 0 ? (
                <div className="text-center py-16 bg-slate-50 rounded-2xl border border-slate-100 flex flex-col items-center flex-grow justify-center">
                    <Users className="w-12 h-12 text-slate-200 mx-auto mb-4" />
                    <p className="text-slate-400 font-bold tracking-tight">No se encontraron atletas o que coincidan con tu búsqueda en este club.</p>
                </div>
            ) : (
                <>
                {/* LISTADO DE ATLETAS (compacto) */}
                <div className="space-y-4 overflow-y-auto pr-2 flex-grow scrollbar-actv">
                    {atletasPaginadosLocal.map((atleta: any) => {
                      // Formatear el teléfono para el link de WhatsApp (quitamos espacios y caracteres raros)
                      const telWhatsapp = atleta.telefono ? atleta.telefono.replace(/\D/g, '') : '';

                      return (
                        <div key={atleta.id} className="bg-slate-50 rounded-xl p-4 flex items-center gap-4 border border-slate-100 transition-colors hover:border-slate-200">
                             <div className="w-11 h-11 rounded-lg bg-white border border-slate-100 flex items-center justify-center shrink-0">
                                <UserCircle className="w-7 h-7 text-slate-200" />
                             </div>
                             <div className="flex-grow">
                                <p className="font-bold text-slate-900">{atleta.nombre} {atleta.apellido}</p>
                                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest pt-0.5 line-clamp-1">{atleta.club} • Talla: {atleta.talla_playera || 'N/A'} • Gen: {atleta.genero || 'N/A'}</p>
                             </div>
                             
                             {/* ACCIONES DE CONTACTO (LLAMADA Y WHATSAPP) */}
                             {atleta.telefono && (
                                <div className="flex gap-1.5 shrink-0">
                                  <a href={`https://wa.me/${telWhatsapp}`} target="_blank" rel="noreferrer" title={`WhatsApp a ${atleta.nombre}`} className="text-green-500 hover:text-white p-2.5 bg-white border border-green-100 hover:bg-green-500 rounded-xl active:scale-95 transition-all">
                                    <MessageCircle className="w-4 h-4"/>
                                  </a>
                                  <a href={`tel:${atleta.telefono}`} title={`Llamar a ${atleta.nombre}`} className="text-slate-400 hover:text-white p-2.5 bg-white border border-slate-100 hover:bg-slate-800 hover:border-slate-800 rounded-xl active:scale-95 transition-all">
                                    <Phone className="w-4 h-4"/>
                                  </a>
                                </div>
                             )}
                        </div>
                      )
                    })}
                </div>

                {/* PAGINACIÓN LOCAL ATLETAS */}
                {totalAtletasPages > 1 && (
                    <div className="flex flex-col sm:flex-row justify-between items-center bg-slate-50 p-4 rounded-xl shadow-inner gap-4 mt-6 border border-slate-100 shrink-0">
                        <p className="text-[11px] font-bold text-slate-500">
                            Mostrando <span className="font-black text-slate-900">{indexPrimeraAtleta + 1}</span> a <span className="font-black text-slate-900">{Math.min(indexUltimaAtleta, atletasFiltradosLocal.length)}</span> de <span className="font-black text-blue-600">{atletasFiltradosLocal.length}</span> corredores
                        </p>
                        <div className="flex gap-1.5">
                            <button onClick={() => setAtletaCurrentPage(prev => Math.max(prev - 1, 1))} disabled={atletaCurrentPage === 1} className="p-2 bg-white border border-slate-200 rounded-lg text-slate-600 disabled:opacity-40"><ChevronLeft size={16}/></button>
                            <div className="flex items-center px-4 bg-white border border-slate-200 rounded-lg text-[10px] font-black text-slate-700 tracking-widest uppercase">
                                {atletaCurrentPage} / {totalAtletasPages}
                            </div>
                            <button onClick={() => setAtletaCurrentPage(prev => Math.min(prev + 1, totalAtletasPages))} disabled={atletaCurrentPage === totalAtletasPages} className="p-2 bg-white border border-slate-200 rounded-lg text-slate-600 disabled:opacity-40"><ChevronRight size={16}/></button>
                        </div>
                    </div>
                )}
                </>
            )}

            <div className="pt-6 mt-auto border-t border-slate-100">
                <button type="button" onClick={closeClubAthletesPanel} className="w-full bg-slate-900 hover:bg-black text-white py-3.5 rounded-xl font-bold uppercase tracking-widest active:scale-95 text-sm transition-colors flex justify-center items-center">
                    <X className="w-4 h-4 mr-2"/> Cerrar Panel de Integrantes
                </button>
            </div>
          </div>
        </div>
      )}

    </section>
  );
}