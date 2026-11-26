'use client';


import type { Club, StaffScreenProps } from '../lib/legacy-types';
import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { User, Calendar, MapPin, Phone, Mail, ShieldCheck, Timer, Award } from 'lucide-react';

export default function TabAtletas({ recargarDatos, clubes = [], userId }: Pick<StaffScreenProps, 'recargarDatos' | 'clubes' | 'userId'>) {
  const [enviando, setEnviando] = useState(false);
  const [codigoPaisTel, setCodigoPaisTel] = useState('+52');
  const [codigoPaisEme, setCodigoPaisEme] = useState('+52');
  const [aceptoTerminos, setAceptoTerminos] = useState(false);

  // Nuevo estado para la lista completa de clubes directos de Supabase
  const [clubesDB, setClubesDB] = useState<Pick<Club, 'id' | 'nombre'>[]>([]);

  const [form, setForm] = useState({
    nombre: '',
    apellido: '',
    fecha_nacimiento: '',
    club: 'Libre',
    genero: 'Hombre',
    talla_playera: '',
    telefono: '',
    telefono_emergencia: '',
    ciudad: '',
    email: '',
    pr_5k: '',
    pr_10k: '',
    pr_21k: '',
    pr_42k: ''
  });

  // Efecto para asegurar que SIEMPRE tengamos todos los clubes (los 73+)
  useEffect(() => {
    const fetchClubes = async () => {
      const { data } = await supabase.from('clubes').select('id, nombre').order('nombre', { ascending: true });
      if (data) {
        setClubesDB(data);
      } else {
        setClubesDB(clubes); // Fallback por si acaso
      }
    };
    fetchClubes();
  }, [clubes]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!aceptoTerminos) {
      alert("Por favor, acepta los términos y condiciones para continuar.");
      return;
    }

    setEnviando(true);

    // =========================================================================
    // ✅ ALGORITMO INTELIGENTE: PREVENCIÓN DE ATLETAS DUPLICADOS
    // =========================================================================
    const normalizarTexto = (txt: string) =>
      String(txt || '').normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

    const obtenerUltimos4 = (tel: string) =>
      String(tel || '').replace(/\D/g, '').slice(-4);

    const telCompleto = `${codigoPaisTel}${form.telefono}`;
    const inputNombre = normalizarTexto(form.nombre);
    const inputApellido = normalizarTexto(form.apellido);
    const inputUltimos4 = obtenerUltimos4(telCompleto);

    // Consultamos la base de datos para asegurar que validamos con la info más reciente
    const { data: atletasDB } = await supabase.from('atletas').select('nombre, apellido, telefono');

    if (atletasDB) {
      const atletaDuplicado = atletasDB.find((atl) => {
        return normalizarTexto(atl.nombre) === inputNombre &&
               normalizarTexto(atl.apellido) === inputApellido &&
               obtenerUltimos4(atl.telefono) === inputUltimos4;
      });

      if (atletaDuplicado) {
        alert(`⚠️ ¡Atleta ya registrado en el Padrón General!\n\nSe detectó una coincidencia exacta:\n• Nombre: ${atletaDuplicado.nombre} ${atletaDuplicado.apellido}\n• Teléfono registrado: ${atletaDuplicado.telefono}\n\nNo es necesario crearlo de nuevo, ya puedes buscarlo para inscribirlo.`);
        setEnviando(false);
        return; // Aborta el guardado
      }
    }
    // =========================================================================

    const datosParaEnviar: Record<keyof typeof form, string | null> & { usuario_id: string | null } = {
      ...form,
      telefono: telCompleto,
      telefono_emergencia: `${codigoPaisEme}${form.telefono_emergencia}`,
      usuario_id: userId
    };

    // Limpiamos campos opcionales vacíos para evitar errores de tipo en Supabase
    if (!datosParaEnviar.email || datosParaEnviar.email.trim() === '') datosParaEnviar.email = null;
    if (!datosParaEnviar.pr_5k || datosParaEnviar.pr_5k.trim() === '') datosParaEnviar.pr_5k = null;
    if (!datosParaEnviar.pr_10k || datosParaEnviar.pr_10k.trim() === '') datosParaEnviar.pr_10k = null;
    if (!datosParaEnviar.pr_21k || datosParaEnviar.pr_21k.trim() === '') datosParaEnviar.pr_21k = null;
    if (!datosParaEnviar.pr_42k || datosParaEnviar.pr_42k.trim() === '') datosParaEnviar.pr_42k = null;

    const { error } = await supabase.from('atletas').insert([datosParaEnviar]);

    if (error) {
      alert("Error al registrar: " + error.message);
    } else {
      alert("¡Atleta registrado con éxito!");
      setForm({
        nombre: '',
        apellido: '',
        fecha_nacimiento: '',
        club: 'Libre',
        genero: 'Hombre',
        talla_playera: '',
        telefono: '',
        telefono_emergencia: '',
        ciudad: '',
        email: '',
        pr_5k: '',
        pr_10k: '',
        pr_21k: '',
        pr_42k: ''
      });
      setAceptoTerminos(false);
      if (recargarDatos) recargarDatos();
    }
    setEnviando(false);
  };

  // =========================================================================
  // FIX BLINDADO: Ordenamiento inteligente de la A a la Z incluyendo números
  // =========================================================================
  const listaClubesFinal = [...(clubesDB.length > 0 ? clubesDB : clubes)].sort((a, b) => {
    const nombreA = String(a?.nombre || '').trim();
    const nombreB = String(b?.nombre || '').trim();
    return nombreA.localeCompare(nombreB, 'es', { numeric: true, sensitivity: 'base' });
  });

  return (
    <section className="animate-in fade-in slide-in-from-bottom-2 duration-500 space-y-10">

      <div className="bg-white p-6 md:p-8 rounded-3xl shadow-sm ring-1 ring-slate-200">

        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 border-b border-slate-100 pb-5 gap-4">
          <h2 className="text-xl font-black text-slate-900 tracking-tight flex items-center">
            <User className="mr-2.5 text-slate-900 w-6 h-6" /> Registro de Atleta
          </h2>
        </div>

        <form onSubmit={handleSubmit} className="space-y-8">
          {/* ==========================================
              DATOS PRINCIPALES
          ========================================== */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            <div className="space-y-1.5">
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider pl-1">Nombre(s) *</label>
              <input type="text" name="nombre" required value={form.nombre} onChange={handleChange} placeholder="Ej. Juan Carlos" className="w-full bg-slate-50 border border-slate-200 p-3.5 rounded-xl outline-none text-slate-900 focus:border-slate-400 focus:ring-4 focus:ring-slate-900/5 transition-all text-sm font-medium placeholder:text-slate-400" />
            </div>

            <div className="space-y-1.5">
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider pl-1">Apellido(s) *</label>
              <input type="text" name="apellido" required value={form.apellido} onChange={handleChange} placeholder="Ej. Pérez Gómez" className="w-full bg-slate-50 border border-slate-200 p-3.5 rounded-xl outline-none text-slate-900 focus:border-slate-400 focus:ring-4 focus:ring-slate-900/5 transition-all text-sm font-medium placeholder:text-slate-400" />
            </div>

            <div className="space-y-1.5">
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider pl-1 flex items-center"><Calendar className="w-3.5 h-3.5 mr-1.5"/> Fecha Nacimiento *</label>
              <input type="date" name="fecha_nacimiento" required value={form.fecha_nacimiento} onChange={handleChange} className="w-full bg-slate-50 border border-slate-200 p-3.5 rounded-xl outline-none text-slate-900 focus:border-slate-400 focus:ring-4 focus:ring-slate-900/5 transition-all text-sm font-medium" />
            </div>

            {/* MENÚ DE CLUBES DINÁMICO */}
            <div className="space-y-1.5">
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider pl-1 flex items-center"><Award className="w-3.5 h-3.5 mr-1.5"/> Club / Equipo *</label>
              <select name="club" required value={form.club} onChange={handleChange} className="w-full bg-slate-50 border border-slate-200 p-3.5 rounded-xl outline-none text-slate-900 focus:border-slate-400 transition-all text-sm font-semibold appearance-none bg-[url('data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2224%22%20height%3D%2224%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%2394a3b8%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpolyline%20points%3D%226%209%2012%2015%2018%209%22%3E%3C%2Fpolyline%3E%3C%2Fsvg%3E')] bg-no-repeat bg-[right_16px_center] bg-[length:16px_16px] pr-10 cursor-pointer">
                <option value="Libre">Libre</option>
                {listaClubesFinal.map((c) => (
                  <option key={c.id} value={c.nombre}>{c.nombre}</option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider pl-1">Género *</label>
              <select name="genero" required value={form.genero} onChange={handleChange} className="w-full bg-slate-50 border border-slate-200 p-3.5 rounded-xl outline-none text-slate-900 focus:border-slate-400 transition-all text-sm font-semibold appearance-none bg-[url('data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2224%22%20height%3D%2224%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%2394a3b8%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpolyline%20points%3D%226%209%2012%2015%2018%209%22%3E%3C%2Fpolyline%3E%3C%2Fsvg%3E')] bg-no-repeat bg-[right_16px_center] bg-[length:16px_16px] pr-10 cursor-pointer">
                <option value="Hombre">Hombre</option>
                <option value="Mujer">Mujer</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider pl-1">Talla Playera *</label>
              <select name="talla_playera" required value={form.talla_playera} onChange={handleChange} className="w-full bg-slate-50 border border-slate-200 p-3.5 rounded-xl outline-none text-slate-900 focus:border-slate-400 transition-all text-sm font-semibold appearance-none bg-[url('data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2224%22%20height%3D%2224%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%2394a3b8%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpolyline%20points%3D%226%209%2012%2015%2018%209%22%3E%3C%2Fpolyline%3E%3C%2Fsvg%3E')] bg-no-repeat bg-[right_16px_center] bg-[length:16px_16px] pr-10 cursor-pointer">
                <option value="" disabled>Seleccionar talla...</option>
                <option value="XS">XS</option>
                <option value="S">S</option>
                <option value="M">M</option>
                <option value="L">L</option>
                <option value="XL">XL</option>
                <option value="XXL">XXL</option>
              </select>
            </div>

            {/* CASILLA DE TELÉFONO CON LADA */}
            <div className="space-y-1.5">
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider pl-1 flex items-center"><Phone className="w-3.5 h-3.5 mr-1.5"/> Celular *</label>
              <div className="flex bg-slate-50 border border-slate-200 rounded-xl overflow-hidden focus-within:border-slate-400 focus-within:ring-4 focus-within:ring-slate-900/5 transition-all">
                <select value={codigoPaisTel} onChange={(e) => setCodigoPaisTel(e.target.value)} className="bg-slate-100 border-r border-slate-200 text-xs font-bold px-3 py-3.5 outline-none text-slate-700 cursor-pointer appearance-none">
                  <option value="+52">🇲🇽 +52</option>
                  <option value="+1">🇺🇸 +1</option>
                </select>
                <input type="tel" name="telefono" required value={form.telefono} onChange={handleChange} placeholder="10 dígitos" className="w-full bg-transparent p-3.5 outline-none text-slate-900 text-sm font-medium placeholder:text-slate-400" />
              </div>
            </div>

            {/* CASILLA DE EMERGENCIA CON LADA */}
            <div className="space-y-1.5">
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider pl-1 flex items-center text-red-500"><Phone className="w-3.5 h-3.5 mr-1.5"/> Emergencia *</label>
              <div className="flex bg-red-50/30 border border-red-200 rounded-xl overflow-hidden focus-within:border-red-400 focus-within:ring-4 focus-within:ring-red-900/5 transition-all">
                <select value={codigoPaisEme} onChange={(e) => setCodigoPaisEme(e.target.value)} className="bg-red-100/40 border-r border-red-200 text-xs font-bold px-3 py-3.5 outline-none text-slate-700 cursor-pointer appearance-none">
                  <option value="+52">🇲🇽 +52</option>
                  <option value="+1">🇺🇸 +1</option>
                </select>
                <input type="tel" name="telefono_emergencia" required value={form.telefono_emergencia} onChange={handleChange} placeholder="Contacto" className="w-full bg-transparent p-3.5 outline-none text-slate-900 text-sm font-medium placeholder:text-red-400" />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider pl-1 flex items-center"><MapPin className="w-3.5 h-3.5 mr-1.5"/> Ciudad Residencia *</label>
              <input type="text" name="ciudad" required value={form.ciudad} onChange={handleChange} placeholder="Ej. Matamoros, Tamaulipas" className="w-full bg-slate-50 border border-slate-200 p-3.5 rounded-xl outline-none text-slate-900 focus:border-slate-400 focus:ring-4 focus:ring-slate-900/5 transition-all text-sm font-medium placeholder:text-slate-400" />
            </div>

            <div className="md:col-span-2 lg:col-span-3 space-y-1.5">
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider pl-1 flex items-center"><Mail className="w-3.5 h-3.5 mr-1.5"/> Correo Electrónico</label>
              <input type="email" name="email" value={form.email} onChange={handleChange} placeholder="correo@ejemplo.com (Opcional)" className="w-full bg-slate-50 border border-slate-200 p-3.5 rounded-xl outline-none text-slate-900 focus:border-slate-400 focus:ring-4 focus:ring-slate-900/5 transition-all text-sm font-medium placeholder:text-slate-400" />
            </div>
          </div>

          {/* ==========================================
              OTROS DATOS: RÉCORDS PERSONALES
          ========================================== */}
          <div className="bg-slate-50 rounded-2xl p-6 border border-slate-200 mt-4">
            <h3 className="text-[11px] font-bold text-slate-500 mb-5 flex items-center uppercase tracking-wider">
              <Timer className="w-4 h-4 mr-2 text-slate-400"/> Otros Datos: Récords Personales (Opcional)
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
              <div className="space-y-1.5">
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider pl-1">5K (Tiempo)</label>
                <input type="text" name="pr_5k" value={form.pr_5k} onChange={handleChange} placeholder="Ej. 00:25:30" className="w-full bg-white border border-slate-200 rounded-lg p-3 outline-none focus:border-slate-400 transition-colors text-sm font-mono text-slate-900 placeholder:text-slate-400 shadow-sm" />
              </div>
              <div className="space-y-1.5">
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider pl-1">10K (Tiempo)</label>
                <input type="text" name="pr_10k" value={form.pr_10k} onChange={handleChange} placeholder="Ej. 00:52:15" className="w-full bg-white border border-slate-200 rounded-lg p-3 outline-none focus:border-slate-400 transition-colors text-sm font-mono text-slate-900 placeholder:text-slate-400 shadow-sm" />
              </div>
              <div className="space-y-1.5">
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider pl-1">21K (Tiempo)</label>
                <input type="text" name="pr_21k" value={form.pr_21k} onChange={handleChange} placeholder="Ej. 01:55:00" className="w-full bg-white border border-slate-200 rounded-lg p-3 outline-none focus:border-slate-400 transition-colors text-sm font-mono text-slate-900 placeholder:text-slate-400 shadow-sm" />
              </div>
              <div className="space-y-1.5">
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider pl-1">42K (Tiempo)</label>
                <input type="text" name="pr_42k" value={form.pr_42k} onChange={handleChange} placeholder="Ej. 03:45:10" className="w-full bg-white border border-slate-200 rounded-lg p-3 outline-none focus:border-slate-400 transition-colors text-sm font-mono text-slate-900 placeholder:text-slate-400 shadow-sm" />
              </div>
            </div>
          </div>

          {/* ==========================================
              TÉRMINOS Y BOTÓN DE ENVÍO
          ========================================== */}
          <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm mt-8">
            <div className="flex items-start">
              <div className="flex items-center h-6">
                <input
                  id="terminos"
                  name="terminos"
                  type="checkbox"
                  required
                  checked={aceptoTerminos}
                  onChange={(e) => setAceptoTerminos(e.target.checked)}
                  className="h-5 w-5 rounded border-slate-300 text-slate-900 focus:ring-slate-900 cursor-pointer transition-all"
                />
              </div>
              <div className="ml-4 text-sm">
                <label htmlFor="terminos" className="font-bold text-slate-800 flex items-center cursor-pointer select-none">
                  <ShieldCheck className="w-4 h-4 mr-1.5 text-slate-700"/> Acepto los Términos y Condiciones *
                </label>
                <p className="text-[10px] text-slate-500 mt-1 leading-relaxed font-medium">
                  Declaro que el corredor se encuentra en condiciones físicas óptimas y libero a ACTV y organizadores de cualquier responsabilidad por accidentes durante el evento. Autorizo el uso de imagen para fines publicitarios. Mis datos están protegidos por ley.
                </p>
              </div>
            </div>
          </div>

          <button
            type="submit"
            disabled={enviando || !aceptoTerminos}
            className={`w-full text-white font-bold py-4 rounded-xl shadow-md transition-all text-sm flex justify-center items-center mt-6 active:scale-[0.99] ${aceptoTerminos ? 'bg-slate-900 hover:bg-black' : 'bg-slate-300 cursor-not-allowed shadow-none'}`}
          >
            {aceptoTerminos ? (enviando ? 'Guardando...' : 'Confirmar y Registrar Atleta') : 'Acepta los términos para registrar'}
          </button>

        </form>
      </div>
    </section>
  );
}