'use client';


import { useClientReady } from '../lib/use-client-ready';
import type { StaffProfile, StaffScreenProps } from '../lib/legacy-types';
import { crearAccesoUsuario, actualizarContrasenaUsuario } from '../app/actions/usuarios';
import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../lib/supabase';
import { UserCog, UserPlus, Trash2, Edit, Mail, Briefcase, Lock, Search, Phone, X, Shield, PlusCircle, Store, ChevronDown } from 'lucide-react';

export default function TabUsuarios({ eventos = [] }: Pick<StaffScreenProps, 'eventos'>) {
  // Para evitar errores de hidratación con createPortal en Next.js
  const isMounted = useClientReady();

  const [usuarios, setUsuarios] = useState<StaffProfile[]>([]);
  const [busqueda, setBusqueda] = useState('');
  const [enviando, setEnviando] = useState(false);

  // ESTADO NUEVO USUARIO
  const [form, setForm] = useState({
    nombre_completo: '',
    telefono: '',
    email: '',
    password: '',
    confirmPassword: '',
    rol: 'Cajero',
    eventos_asignados: [] as string[]
  });

  // ESTADOS EDICIÓN
  const [editando, setEditando] = useState<StaffProfile | null>(null);
  const [formEdit, setFormEdit] = useState({
    nombre_completo: '',
    telefono: '',
    rol: '',
    eventos_asignados: [] as string[],
    nueva_contrasena: ''
  });

  const consultarUsuarios = useCallback(() => supabase.from('perfiles').select('*'), []);
  const cargarUsuarios = async () => {
    const { data } = await consultarUsuarios();
    if (data) setUsuarios(data);
  };

  useEffect(() => {
    let active = true;
    void consultarUsuarios().then(({ data }) => {
      if (active && data) setUsuarios(data);
    });
    return () => { active = false; };
  }, [consultarUsuarios]);


  const handleCrearUsuario = async (e: React.FormEvent) => {
    e.preventDefault();

    if (form.password !== form.confirmPassword) {
      alert("⚠️ Las contraseñas no coinciden. Por favor, verifícalas.");
      return;
    }

    setEnviando(true);

    const { data: { session } } = await supabase.auth.getSession();
    const resultado = await crearAccesoUsuario(form, session?.access_token ?? '');

    if (resultado.success) {
      alert("¡Usuario y acceso creados con éxito!");
      setForm({ nombre_completo: '', telefono: '', email: '', password: '', confirmPassword: '', rol: 'Cajero', eventos_asignados: [] });
      cargarUsuarios();
    } else {
      alert("Error: " + resultado.error);
    }
    setEnviando(false);
  };

  // ✅ FUNCIONES DE ASIGNACIÓN (Auto-Select)
  const addEvento = (eventoId: string) => {
    if (eventoId && !form.eventos_asignados.includes(eventoId)) {
      setForm({ ...form, eventos_asignados: [...form.eventos_asignados, eventoId] });
    }
  };

  const removeEvento = (eventoId: string) => {
    setForm({ ...form, eventos_asignados: form.eventos_asignados.filter(id => id !== eventoId) });
  };

  const addEventoEdit = (eventoId: string) => {
    if (eventoId && !formEdit.eventos_asignados.includes(eventoId)) {
      setFormEdit({ ...formEdit, eventos_asignados: [...formEdit.eventos_asignados, eventoId] });
    }
  };

  const removeEventoEdit = (eventoId: string) => {
    setFormEdit({ ...formEdit, eventos_asignados: formEdit.eventos_asignados.filter(id => id !== eventoId) });
  };

  const abrirEdicion = (u: StaffProfile) => {
    setEditando(u);

    let rolFormat = 'Cajero';
    const rolDB = u.rol?.toLowerCase() || '';
    if (rolDB === 'admin' || rolDB === 'administrador') rolFormat = 'Administrador';
    else if (rolDB === 'moderador') rolFormat = 'Moderador';
    else if (rolDB === 'pdv actv' || rolDB === 'pdv') rolFormat = 'PDV ACTV';

    setFormEdit({
      nombre_completo: u.nombre_completo || '',
      telefono: u.telefono || '',
      rol: rolFormat,
      eventos_asignados: u.eventos_asignados || [],
      nueva_contrasena: ''
    });
  };

  const guardarEdicion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editando) return;
    setEnviando(true);
    const rolLower = formEdit.rol?.toLowerCase();

    const { error } = await supabase.from('perfiles').update({
      nombre_completo: formEdit.nombre_completo,
      telefono: formEdit.telefono,
      rol: formEdit.rol,
      eventos_asignados: (rolLower === 'moderador' || rolLower === 'cajero') ? formEdit.eventos_asignados : []
    }).eq('id', editando.id);

    if (error) {
      alert("Error al actualizar perfil: " + error.message);
      setEnviando(false);
      return;
    }

    if (formEdit.nueva_contrasena && formEdit.nueva_contrasena.trim() !== '') {
      if (formEdit.nueva_contrasena.length < 6) {
        alert("La nueva contraseña debe tener al menos 6 caracteres.");
        setEnviando(false);
        return;
      }

      const { data: { session } } = await supabase.auth.getSession();
      const resPwd = await actualizarContrasenaUsuario(editando.id, formEdit.nueva_contrasena, session?.access_token ?? '');
      if (!resPwd.success) {
        alert("Perfil actualizado, pero hubo un error al cambiar la contraseña: " + resPwd.error);
      } else {
        alert("Perfil y contraseña actualizados correctamente.");
      }
    } else {
      alert("Perfil actualizado correctamente.");
    }

    setEditando(null);
    cargarUsuarios();
    setEnviando(false);
  };

  const eliminarUsuario = async (id: string, nombre: string) => {
    if (window.confirm(`¿Eliminar definitivamente el acceso de ${nombre}?`)) {
      const { error } = await supabase.from('perfiles').delete().eq('id', id);
      if (!error) cargarUsuarios();
    }
  };

  return (
    <section className="animate-in fade-in slide-in-from-bottom-2 duration-500 space-y-8 relative">
      <div className="bg-white p-6 md:p-8 rounded-3xl shadow-sm ring-1 ring-slate-200 mb-8">
        <div className="flex justify-between items-center border-b border-slate-100 pb-5">
          <div>
            <h2 className="text-xl font-black text-slate-900 tracking-tight flex items-center">
              <UserCog className="mr-2.5 text-blue-600 w-6 h-6" /> Gestión de Personal
            </h2>
            <p className="text-xs font-medium text-slate-500 mt-1">Crea accesos y administra los roles de tu equipo.</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">

        {/* ========================================================= */}
        {/* COLUMNA IZQ: NUEVO ACCESO                                 */}
        {/* ========================================================= */}
        <div className="xl:col-span-1 bg-white p-6 md:p-8 rounded-3xl shadow-sm ring-1 ring-slate-200 h-fit">
          <h3 className="text-sm font-black text-slate-900 uppercase mb-6 flex items-center border-b border-slate-100 pb-4 tracking-wider">
            <UserPlus className="w-5 h-5 mr-2 text-slate-900" /> Nuevo Acceso
          </h3>
          <form onSubmit={handleCrearUsuario} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider pl-1">Nombre Completo *</label>
              <input type="text" required value={form.nombre_completo} onChange={(e) => setForm({...form, nombre_completo: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3.5 outline-none focus:ring-4 focus:ring-slate-900/5 focus:border-slate-400 transition-all text-sm font-bold text-slate-900 placeholder:text-slate-400" />
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider pl-1 flex items-center"><Phone className="w-3 h-3 mr-1.5"/> Teléfono *</label>
              <input type="tel" required value={form.telefono} onChange={(e) => setForm({...form, telefono: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3.5 outline-none focus:ring-4 focus:ring-slate-900/5 focus:border-slate-400 transition-all text-sm font-medium text-slate-900 placeholder:text-slate-400" />
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider pl-1 flex items-center"><Mail className="w-3 h-3 mr-1.5"/> Correo Electrónico *</label>
              <input type="email" required value={form.email} onChange={(e) => setForm({...form, email: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3.5 outline-none focus:ring-4 focus:ring-slate-900/5 focus:border-slate-400 transition-all text-sm font-medium text-slate-900 placeholder:text-slate-400" />
            </div>

            <div className="grid grid-cols-1 gap-4 pt-2">
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider pl-1 flex items-center"><Lock className="w-3 h-3 mr-1.5"/> Contraseña *</label>
                <input type="password" required value={form.password} onChange={(e) => setForm({...form, password: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3.5 outline-none focus:ring-4 focus:ring-slate-900/5 focus:border-slate-400 transition-all text-sm font-mono tracking-widest text-slate-900 placeholder:text-slate-400" placeholder="••••••••" />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider pl-1 flex items-center"><Lock className="w-3 h-3 mr-1.5"/> Repetir Contraseña *</label>
                <input type="password" required value={form.confirmPassword} onChange={(e) => setForm({...form, confirmPassword: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3.5 outline-none focus:ring-4 focus:ring-slate-900/5 focus:border-slate-400 transition-all text-sm font-mono tracking-widest text-slate-900 placeholder:text-slate-400" placeholder="••••••••" />
              </div>
            </div>

            <div className="pt-4 border-t border-slate-100 mt-2 space-y-1.5">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider pl-1">Rol de Usuario *</label>
              <div className="relative group">
                <select value={form.rol} onChange={(e) => setForm({...form, rol: e.target.value, eventos_asignados: []})} className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3.5 outline-none focus:ring-4 focus:ring-slate-900/5 focus:border-slate-400 transition-all text-sm font-black text-slate-900 appearance-none cursor-pointer">
                  <option value="Cajero">Cajero (Venta Restringida)</option>
                  <option value="PDV ACTV">PDV ACTV (Acceso Total Ventas)</option>
                  <option value="Moderador">Moderador de Carrera</option>
                  <option value="Administrador">Administrador</option>
                </select>
                <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
              </div>
            </div>

            {/* SECCIÓN REACTIVA DE ASIGNACIÓN DE EVENTOS (AUTO-ADD) */}
            {(form.rol === 'Moderador' || form.rol === 'Cajero') && (
              <div className="animate-in slide-in-from-top-2 bg-slate-50 p-5 rounded-2xl border border-slate-200 space-y-3 mt-4">
                <label className="block text-[10px] font-black text-slate-700 uppercase tracking-wider">Asignar Eventos Permitidos</label>

                <div className="relative">
                  <select
                    value=""
                    onChange={(e) => addEvento(e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded-xl p-3 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-900/5 text-xs font-bold text-slate-600 appearance-none cursor-pointer transition-all"
                  >
                    <option value="" disabled>Añadir carrera a la lista...</option>
                    {eventos?.map((ev) => (
                      <option key={ev.id} value={ev.id}>{ev.nombre_carrera}</option>
                    ))}
                  </select>
                  <PlusCircle className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
                </div>

                <div className="flex flex-wrap gap-2 pt-1">
                  {form.eventos_asignados.length === 0 && <span className="text-[10px] text-slate-400 font-bold italic">No hay carreras asignadas aún.</span>}
                  {form.eventos_asignados.map(id => {
                    const evt = eventos?.find((e) => e.id === id);
                    return evt ? (
                      <span key={id} className="bg-slate-900 text-white text-[10px] font-bold px-2.5 py-1.5 rounded-lg flex items-center shadow-sm animate-in zoom-in duration-200">
                        {evt.nombre_carrera} <X className="w-3.5 h-3.5 ml-1.5 cursor-pointer hover:text-red-400 transition-colors" onClick={() => removeEvento(id)} />
                      </span>
                    ) : null;
                  })}
                </div>
              </div>
            )}

            <button type="submit" disabled={enviando} className="w-full bg-slate-900 hover:bg-black disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-black py-4 rounded-xl text-sm uppercase tracking-widest transition-all shadow-md active:scale-[0.98] mt-6">
              {enviando ? 'Procesando...' : 'Crear Acceso'}
            </button>
          </form>
        </div>

        {/* ========================================================= */}
        {/* COLUMNA DER: LISTADO Y CONTROL                            */}
        {/* ========================================================= */}
        <div className="xl:col-span-2 space-y-6">
          <div className="relative group">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400 group-focus-within:text-slate-900 transition-colors" />
            <input
              type="text"
              placeholder="Buscar personal por nombre o rol..."
              className="w-full bg-white border border-slate-200 p-4 pl-12 rounded-3xl outline-none text-sm shadow-sm focus:ring-4 focus:ring-slate-900/5 focus:border-slate-400 transition-all text-slate-900 placeholder:text-slate-400 font-medium"
              onChange={(e) => setBusqueda(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-1 gap-5">
            {usuarios.filter(u => u.rol?.toLowerCase().includes(busqueda.toLowerCase()) || u.nombre_completo?.toLowerCase().includes(busqueda.toLowerCase())).map((u) => {
              const rL = u.rol?.toLowerCase();
              const rolUI = rL.includes('admin') ? 'Administrador' : rL.includes('pdv') ? 'PDV ACTV' : rL.includes('moderad') ? 'Moderador' : 'Cajero';

              return (
              <div key={u.id} className="bg-white p-5 rounded-3xl ring-1 ring-slate-200 shadow-sm hover:shadow-md transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-5 group">

                <div className="flex items-start sm:items-center gap-4">
                  <div className={`p-4 rounded-2xl shrink-0 ${rolUI === 'Administrador' ? 'bg-purple-50 text-purple-600 ring-1 ring-purple-100' : rolUI === 'PDV ACTV' ? 'bg-emerald-50 text-emerald-600 ring-1 ring-emerald-100' : rolUI === 'Moderador' ? 'bg-blue-50 text-blue-600 ring-1 ring-blue-100' : 'bg-slate-50 text-slate-600 ring-1 ring-slate-200'}`}>
                    {rolUI === 'Administrador' ? <Shield className="w-6 h-6" /> : rolUI === 'PDV ACTV' ? <Store className="w-6 h-6" /> : <Briefcase className="w-6 h-6" />}
                  </div>
                  <div>
                    <h4 className="font-black text-slate-900 uppercase text-lg tracking-tight leading-none">{u.nombre_completo || 'Usuario ACTV'}</h4>
                    <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4 mt-2">
                      <p className="text-xs font-medium text-slate-500 flex items-center"><Mail className="w-3.5 h-3.5 mr-1.5 text-slate-400"/> {u.email}</p>
                    </div>

                    <div className="flex flex-wrap gap-2 mt-3">
                      <span className={`text-[9px] font-black px-3 py-1 rounded-full uppercase tracking-widest shadow-sm ${rolUI === 'Administrador' ? 'bg-purple-600 text-white' : rolUI === 'PDV ACTV' ? 'bg-emerald-600 text-white' : 'bg-slate-900 text-white'}`}>
                        {rolUI}
                      </span>
                      {/* Mostrar eventos para Moderadores y Cajeros */}
                      {(rolUI === 'Moderador' || rolUI === 'Cajero') && u.eventos_asignados?.map((id: string) => (
                        <span key={id} className="text-[9px] font-bold bg-slate-100 text-slate-600 border border-slate-200 px-2 py-1 rounded-md uppercase line-clamp-1 max-w-[150px]">
                          {eventos?.find((e) => e.id === id)?.nombre_carrera || 'Carrera'}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="flex justify-end gap-2 border-t sm:border-t-0 border-slate-100 pt-4 sm:pt-0 shrink-0 opacity-100 sm:opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => abrirEdicion(u)} className="p-3 bg-white border border-slate-200 text-slate-600 hover:bg-slate-900 hover:text-white hover:border-slate-900 rounded-xl transition-all shadow-sm">
                    <Edit className="w-4 h-4" />
                  </button>
                  <button onClick={() => eliminarUsuario(u.id, u.nombre_completo || u.email)} className="p-3 bg-white border border-slate-200 text-red-500 hover:bg-red-50 hover:border-red-200 rounded-xl transition-all shadow-sm">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

              </div>
            )})}
            {usuarios.length === 0 && (
              <div className="p-10 text-center bg-white rounded-3xl ring-1 ring-slate-200">
                <UserCog className="w-10 h-10 text-slate-200 mx-auto mb-3" />
                <p className="text-slate-400 font-bold tracking-tight">No hay usuarios registrados aún.</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ========================================================= */}
      {/* MODAL DE EDICIÓN RESPONSIVO CON PORTAL                      */}
      {/* ========================================================= */}
      {isMounted && editando && createPortal(
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-[9999] p-4 no-print overflow-y-auto">
          {/* max-h-[90vh], overflow-y-auto y my-auto aseguran el comportamiento perfecto en móviles */}
          <div className="bg-white rounded-[32px] p-8 md:p-10 max-w-md w-full shadow-2xl relative animate-in zoom-in-95 duration-200 my-auto max-h-[90vh] overflow-y-auto custom-scrollbar">
            <button type="button" onClick={() => setEditando(null)} className="absolute top-6 right-6 text-slate-400 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 p-2 rounded-full transition-all"><X size={20}/></button>

            <div className="mb-8 border-b pb-5 border-slate-100">
              <div className="bg-slate-100 w-12 h-12 rounded-2xl flex items-center justify-center mb-4">
                <UserCog className="w-6 h-6 text-slate-900"/>
              </div>
              <h3 className="text-2xl font-black text-slate-900 tracking-tight flex items-center leading-none">Editar Perfil</h3>
              <p className="text-[10px] text-slate-500 mt-2 uppercase font-black tracking-widest">{editando.email}</p>
            </div>

            <form onSubmit={guardarEdicion} className="space-y-5">
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider pl-1">Nombre Completo</label>
                <input required value={formEdit.nombre_completo} onChange={(e) => setFormEdit({...formEdit, nombre_completo: e.target.value})} className="w-full bg-slate-50 border border-slate-200 p-3.5 rounded-xl outline-none text-slate-900 font-bold focus:border-slate-400 focus:ring-4 focus:ring-slate-900/5 transition-all text-sm" />
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider pl-1">Teléfono</label>
                <input type="tel" required value={formEdit.telefono} onChange={(e) => setFormEdit({...formEdit, telefono: e.target.value})} className="w-full bg-slate-50 border border-slate-200 p-3.5 rounded-xl outline-none text-slate-900 focus:border-slate-400 focus:ring-4 focus:ring-slate-900/5 transition-all text-sm font-medium" />
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider pl-1">Rol Operativo</label>
                <div className="relative">
                  <select value={formEdit.rol} onChange={(e) => setFormEdit({...formEdit, rol: e.target.value, eventos_asignados: []})} className="w-full bg-slate-50 border border-slate-200 p-3.5 rounded-xl outline-none font-bold text-slate-900 appearance-none cursor-pointer focus:border-slate-400 focus:ring-4 focus:ring-slate-900/5 transition-all text-sm">
                    <option value="Cajero">Cajero (Venta Restringida)</option>
                    <option value="PDV ACTV">PDV ACTV (Acceso Total Ventas)</option>
                    <option value="Moderador">Moderador de Carrera</option>
                    <option value="Administrador">Administrador</option>
                  </select>
                  <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
                </div>
              </div>

              {/* ASIGNACIÓN AUTO-ADD (EDICIÓN) */}
              {(formEdit.rol === 'Moderador' || formEdit.rol === 'Cajero') && (
                <div className="bg-slate-50 p-5 rounded-2xl border border-slate-200 space-y-3 mt-4">
                  <label className="block text-[10px] font-black text-slate-700 uppercase tracking-widest">Eventos Asignados</label>

                  <div className="relative">
                    <select
                      value=""
                      onChange={(e) => addEventoEdit(e.target.value)}
                      className="w-full bg-white border border-slate-200 rounded-xl p-3 outline-none text-xs text-slate-600 appearance-none cursor-pointer focus:border-slate-400 transition-all font-bold"
                    >
                      <option value="" disabled>Añadir carrera a la lista...</option>
                      {eventos?.map((ev) => <option key={ev.id} value={ev.id}>{ev.nombre_carrera}</option>)}
                    </select>
                    <PlusCircle className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
                  </div>

                  <div className="flex flex-wrap gap-2 pt-1">
                    {formEdit.eventos_asignados.length === 0 && <span className="text-[10px] text-slate-400 font-bold italic">No hay carreras asignadas.</span>}
                    {formEdit.eventos_asignados.map(id => (
                      <span key={id} className="bg-slate-900 text-white text-[10px] font-bold px-2.5 py-1.5 rounded-lg flex items-center shadow-sm animate-in zoom-in duration-200">
                        {eventos?.find((e) => e.id === id)?.nombre_carrera || 'Carrera'}
                        <X className="w-3.5 h-3.5 ml-1.5 cursor-pointer hover:text-red-400 transition-colors" onClick={() => removeEventoEdit(id)} />
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* RECUPERACIÓN DE CONTRASEÑA */}
              <div className="pt-5 mt-6 border-t border-slate-100">
                <label className="text-[10px] font-bold text-slate-400 uppercase mb-1.5 flex items-center tracking-wider pl-1"><Lock className="w-3 h-3 mr-1.5"/> Forzar Nueva Contraseña</label>
                <input
                  type="text"
                  value={formEdit.nueva_contrasena}
                  onChange={(e) => setFormEdit({...formEdit, nueva_contrasena: e.target.value})}
                  placeholder="Escribe para cambiarla..."
                  className="w-full bg-slate-50 border border-slate-200 p-3.5 rounded-xl outline-none font-mono tracking-widest text-slate-900 placeholder:text-slate-400 text-sm focus:border-slate-400 focus:ring-4 focus:ring-slate-900/5 transition-all"
                />
                <p className="text-[9px] text-slate-400 mt-2 font-bold px-1">Si la dejas en blanco, conservará la contraseña actual intacta.</p>
              </div>

              <button type="submit" disabled={enviando} className="w-full bg-slate-900 hover:bg-black disabled:bg-slate-300 disabled:cursor-not-allowed text-white py-4 rounded-xl font-black uppercase tracking-widest shadow-lg shadow-slate-900/10 text-sm mt-6 transition-all active:scale-[0.98]">
                {enviando ? 'Guardando...' : 'Guardar Cambios'}
              </button>
            </form>
          </div>
        </div>,
        document.body
      )}
    </section>
  );
}
