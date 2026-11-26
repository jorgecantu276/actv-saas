'use client';
import React, { useEffect, useState, useRef, useCallback } from 'react';
import Link from 'next/link';
import type { Session } from '@supabase/supabase-js';
import type { Athlete, RaceEvent, Club } from '../lib/legacy-types';
import { supabase } from '../lib/supabase';
import { Users, UserPlus, Calendar, Store, LogOut, BarChart3, Shield, UserCog, FileText, Eye, EyeOff, Package, Command, Menu, X } from 'lucide-react';

import TabCaja from '../components/TabCaja';
import TabAtletas from '../components/TabAtletas';
import TabListaAtletas from '../components/TabListaAtletas';
import TabEventos from '../components/TabEventos';
import TabReportes from '../components/TabReportes';
import TabClubes from '../components/TabClubes';
import TabUsuarios from '../components/TabUsuarios';
import TabCotizaciones from '../components/TabCotizaciones';
import TabEntregaKits from '../components/TabEntregaKits';

// =========================================================
// EFECTO SILICON VALLEY: RED NEURONAL INTERACTIVA (CANVAS)
// =========================================================
const ParticleNetwork = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const particles: Particle[] = [];
    let animationFrameId: number;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    window.addEventListener('resize', resize);
    resize();

    const mouse = { x: -1000, y: -1000 };
    const handleMouseMove = (e: MouseEvent) => {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
    };
    window.addEventListener('mousemove', handleMouseMove);

    class Particle {
      x: number; y: number; vx: number; vy: number; radius: number;
      constructor() {
        this.x = Math.random() * canvas!.width;
        this.y = Math.random() * canvas!.height;
        this.vx = (Math.random() - 0.5) * 1.5;
        this.vy = (Math.random() - 0.5) * 1.5;
        this.radius = Math.random() * 1.5 + 1;
      }
      draw() {
        if(!ctx) return;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(59, 130, 246, 0.4)'; // Azul ACTV sutil
        ctx.fill();
      }
      update() {
        this.x += this.vx;
        this.y += this.vy;

        if (this.x < 0 || this.x > canvas!.width) this.vx = -this.vx;
        if (this.y < 0 || this.y > canvas!.height) this.vy = -this.vy;

        const dx = mouse.x - this.x;
        const dy = mouse.y - this.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance < 120) {
          this.x -= dx / 15;
          this.y -= dy / 15;
        }
        this.draw();
      }
    }

    for (let i = 0; i < 70; i++) particles.push(new Particle());

    const animate = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (let i = 0; i < particles.length; i++) {
        particles[i].update();
        for (let j = i; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x;
          const dy = particles[i].y - particles[j].y;
          const distance = Math.sqrt(dx * dx + dy * dy);

          if (distance < 140) {
            ctx.beginPath();
            ctx.strokeStyle = `rgba(148, 163, 184, ${0.2 - distance / 700})`;
            ctx.lineWidth = 0.8;
            ctx.moveTo(particles[i].x, particles[i].y);
            ctx.lineTo(particles[j].x, particles[j].y);
            ctx.stroke();
          }
        }
      }
      animationFrameId = requestAnimationFrame(animate);
    };
    animate();

    return () => {
      window.removeEventListener('resize', resize);
      window.removeEventListener('mousemove', handleMouseMove);
      cancelAnimationFrame(animationFrameId);
    };
  }, []);

  return <canvas ref={canvasRef} className="absolute inset-0 z-0 pointer-events-none" />;
};
// =========================================================

export default function DashboardPDV() {
  const [session, setSession] = useState<Session | null>(null);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [staffUserId, setStaffUserId] = useState<string | null>(null);
  const [emailLogin, setEmailLogin] = useState('');
  const [passwordLogin, setPasswordLogin] = useState('');
  const [loadingAuth, setLoadingAuth] = useState(true);

  const [showPassword, setShowPassword] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const [activeTab, setActiveTab] = useState('caja');
  const [atletas, setAtletas] = useState<Athlete[]>([]);
  const [eventos, setEventos] = useState<RaceEvent[]>([]);
  const [clubes, setClubes] = useState<Club[]>([]);

  const obtenerRol = useCallback(async (userId: string) => {
    const { data } = await supabase.from('perfiles').select('rol').eq('id', userId).single();
    if (data) {
      const rolDB = data.rol?.toLowerCase() || '';
      if (rolDB === 'admin' || rolDB === 'administrador') {
        setUserRole('Administrador');
      } else if (rolDB === 'moderador') {
        setUserRole('Moderador');
      } else {
        setUserRole('Cajero');
      }
    }
    setLoadingAuth(false);
  }, []);

  const cargarDatos = useCallback(async () => {
    const [{ data: dataAtletas }, { data: dataEventos }, { data: dataClubes }] = await Promise.all([
      supabase.from('atletas').select('*, perfiles(nombre_completo)').order('created_at', { ascending: false }).limit(50000),
      supabase.from('eventos').select('*').order('fecha', { ascending: true }).limit(50000),
      supabase.from('clubes').select('*').order('nombre', { ascending: true }).limit(5000),
    ]);

    setAtletas(dataAtletas || []);
    setEventos(dataEventos || []);
    setClubes(dataClubes || []);
  }, []);

  useEffect(() => {
    let activeUser: string | undefined;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      const userId = session?.user.id;
      if (!userId) {
        activeUser = undefined;
        setUserRole(null);
        setStaffUserId(null);
        setLoadingAuth(false);
      } else if (userId !== activeUser) {
        activeUser = userId;
        setLoadingAuth(true);
        setTimeout(async () => {
          if (activeUser !== userId) return;
          const { data: staff } = await supabase.rpc('actv_is_payment_staff');
          if (activeUser !== userId) return;
          setStaffUserId(staff === true ? userId : null);
          if (staff === true) {
            void obtenerRol(userId);
            void cargarDatos();
          } else { setLoadingAuth(false); }
        }, 0);
      }
    });
    return () => {
      activeUser = undefined;
      subscription.unsubscribe();
    };
  }, [obtenerRol, cargarDatos]);


  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoadingAuth(true);
    const { error } = await supabase.auth.signInWithPassword({ email: emailLogin, password: passwordLogin });
    if (error) { alert("Error de acceso: " + error.message); setLoadingAuth(false); }
  };

  const handleLogout = async () => { await supabase.auth.signOut(); };

  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
    setIsMobileMenuOpen(false); // Cierra el menú móvil al seleccionar
  };

  // =========================================================
  // PANTALLA DE CARGA
  // =========================================================
  if (loadingAuth) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center font-sans selection:bg-blue-500/30">
        <div className="flex flex-col items-center gap-6 animate-in fade-in duration-700">
          <div className="relative w-12 h-12">
            <div className="absolute inset-0 border-[3px] border-slate-200 rounded-full"></div>
            <div className="absolute inset-0 border-[3px] border-blue-600 rounded-full border-t-transparent animate-spin"></div>
          </div>
          <p className="text-slate-500 font-medium text-xs uppercase tracking-[0.2em]">Iniciando Entorno</p>
        </div>
      </div>
    );
  }

  // =========================================================
  // PANTALLA DE LOGIN
  // =========================================================
  if (session && staffUserId !== session.user.id) {
    return (
      <main className="mx-auto w-full max-w-xl px-6 py-14">
        <h1 className="text-3xl font-bold">Selecciona tu espacio en ACTV</h1>
        <nav aria-label="Cuenta ACTV" className="mt-6 flex flex-wrap gap-4 text-blue-800">
          <Link href="/mi-actv" className="underline">Mi ACTV</Link>
          <Link href="/organizadores" className="underline">Organizadores</Link>
          <Link href="/carreras" className="underline">Carreras</Link>
          <button type="button" className="underline" onClick={handleLogout}>Cerrar sesión</button>
        </nav>
      </main>
    );
  }

  if (!session) {
    return (
      <main className="min-h-screen bg-slate-50 flex items-center justify-center p-4 font-sans relative overflow-hidden selection:bg-blue-500/30">

        <style>{`
          @keyframes smoothEnter {
            0% { opacity: 0; transform: translateY(20px) scale(0.97); }
            100% { opacity: 1; transform: translateY(0) scale(1); }
          }
          .animate-smooth-enter {
            animation: smoothEnter 0.6s cubic-bezier(0.2, 0.8, 0.2, 1) forwards;
          }
        `}</style>

        <ParticleNetwork />

        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-blue-500/5 blur-[100px] rounded-full pointer-events-none z-0"></div>

        <div className="animate-smooth-enter bg-white/95 backdrop-blur-md p-10 md:p-12 max-w-sm w-full rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-slate-200/60 relative z-10">
          <div className="text-center mb-10">
            <div className="bg-slate-900 w-12 h-12 rounded-xl flex items-center justify-center mx-auto mb-5 shadow-lg shadow-slate-900/20">
              <Command className="text-white w-6 h-6" />
            </div>
            <h1 className="text-2xl font-black text-slate-900 tracking-tight">ACTV SaaS</h1>
            <p className="text-slate-500 text-sm font-medium mt-2">Ingresa tus credenciales de acceso</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-5">
            <div className="space-y-1.5">
              <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider">Email de Trabajo</label>
              <input type="email" required value={emailLogin} onChange={(e) => setEmailLogin(e.target.value)} className="w-full bg-slate-50/50 border border-slate-200 text-slate-900 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 rounded-xl p-3.5 outline-none text-sm transition-all" placeholder="usuario@actv.mx" />
            </div>
            <div className="space-y-1.5">
              <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider">Contraseña</label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  required
                  value={passwordLogin}
                  onChange={(e) => setPasswordLogin(e.target.value)}
                  className="w-full bg-slate-50/50 border border-slate-200 text-slate-900 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 rounded-xl p-3.5 pr-12 outline-none text-sm transition-all"
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-4 top-3.5 text-slate-400 hover:text-slate-700 transition-colors"
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>
            <button type="submit" className="w-full bg-slate-900 hover:bg-slate-800 text-white font-bold text-sm py-4 rounded-xl shadow-md mt-2 transition-all active:scale-[0.98]">
              Iniciar Sesión
            </button>
          </form>

          <div className="mt-10 text-center text-xs text-slate-400 font-medium space-y-1.5">
            <p>Versión 4.3</p>
            <p>Creado con ❤️ y mucho ☕️ por Pedro Walls.</p>
            <p><a href="https://actv.mx" target="_blank" rel="noopener noreferrer" className="hover:text-slate-700 transition-colors">ACTV SaaS | https://actv.mx</a></p>
          </div>
        </div>
      </main>
    );
  }

  // =========================================================
  // DASHBOARD PRINCIPAL RESPONSIVO
  // =========================================================
  return (
    <main className="min-h-screen bg-slate-50 font-sans flex flex-col selection:bg-blue-500/30">

      <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-xl border-b border-slate-200/80 supports-[backdrop-filter]:bg-white/60 no-print">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-3">

            {/* LOGO COMO BOTÓN A CAJA PRINCIPAL */}
            <button onClick={() => handleTabChange('caja')} className="flex items-center gap-4 text-left cursor-pointer hover:opacity-80 transition-opacity focus:outline-none">
              <div className="bg-gradient-to-tr from-slate-900 to-slate-800 text-white p-2.5 rounded-xl shadow-sm">
                <Command className="w-4 h-4"/>
              </div>
              <div className="leading-none">
                <p className="text-slate-900 font-bold text-sm tracking-tight">ACTV | Tu carrera comienza aquí</p>
                <div className="flex items-center gap-2 mt-1">
                  <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                  <p className="text-[10px] text-slate-500 font-medium uppercase tracking-widest">{userRole}</p>
                </div>
              </div>
            </button>

            <div className="md:hidden">
              <button
                onClick={() => setIsMobileMenuOpen(true)}
                className="p-2 text-slate-600 hover:bg-slate-100 rounded-lg transition-colors focus:outline-none"
              >
                <Menu size={24} />
              </button>
            </div>

            {/* NAVEGACIÓN DESKTOP */}
            <nav className="hidden md:flex items-center gap-1">
              <button onClick={() => handleTabChange('caja')} className={`flex items-center px-4 py-2 text-[13px] font-medium transition-all rounded-full ${activeTab === 'caja' ? 'bg-slate-900 text-white shadow-md' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'}`}><Store className="w-4 h-4 mr-2" /> Caja</button>
              <button onClick={() => handleTabChange('atletas')} className={`flex items-center px-4 py-2 text-[13px] font-medium transition-all rounded-full ${activeTab === 'atletas' ? 'bg-slate-900 text-white shadow-md' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'}`}><UserPlus className="w-4 h-4 mr-2" /> Atletas</button>

              {userRole === 'Administrador' && (
                <button onClick={() => handleTabChange('lista_atletas')} className={`flex items-center px-4 py-2 text-[13px] font-medium transition-all rounded-full ${activeTab === 'lista_atletas' ? 'bg-slate-900 text-white shadow-md' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'}`}><Users className="w-4 h-4 mr-2" /> Padrón</button>
              )}

              {(userRole === 'Administrador' || userRole === 'Moderador') && (
                <>
                  <button onClick={() => handleTabChange('entrega_kits')} className={`flex items-center px-4 py-2 text-[13px] font-medium transition-all rounded-full ${activeTab === 'entrega_kits' ? 'bg-slate-900 text-white shadow-md' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'}`}><Package className="w-4 h-4 mr-2" /> Kits</button>
                  <button onClick={() => handleTabChange('reportes')} className={`flex items-center px-4 py-2 text-[13px] font-medium transition-all rounded-full ${activeTab === 'reportes' ? 'bg-slate-900 text-white shadow-md' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'}`}><BarChart3 className="w-4 h-4 mr-2" /> Reportes</button>
                  <button onClick={() => handleTabChange('eventos')} className={`flex items-center px-4 py-2 text-[13px] font-medium transition-all rounded-full ${activeTab === 'eventos' ? 'bg-slate-900 text-white shadow-md' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'}`}><Calendar className="w-4 h-4 mr-2" /> Eventos</button>
                </>
              )}

              {userRole === 'Administrador' && (
                <>
                  <button onClick={() => handleTabChange('clubes')} className={`flex items-center px-4 py-2 text-[13px] font-medium transition-all rounded-full ${activeTab === 'clubes' ? 'bg-slate-900 text-white shadow-md' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'}`}><Shield className="w-4 h-4 mr-2" /> Clubes</button>
                  <button onClick={() => handleTabChange('usuarios')} className={`flex items-center px-4 py-2 text-[13px] font-medium transition-all rounded-full ${activeTab === 'usuarios' ? 'bg-slate-900 text-white shadow-md' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'}`}><UserCog className="w-4 h-4 mr-2" /> Auth</button>
                  <button onClick={() => handleTabChange('cotizaciones')} className={`flex items-center px-4 py-2 text-[13px] font-medium transition-all rounded-full ${activeTab === 'cotizaciones' ? 'bg-slate-900 text-white shadow-md' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'}`}><FileText className="w-4 h-4 mr-2" /> Cotizaciones</button>
                </>
              )}

              <div className="h-5 w-px bg-slate-200 mx-2"></div>
              <button onClick={handleLogout} className="flex items-center text-slate-500 hover:text-red-600 text-[13px] font-medium px-4 py-2 rounded-full transition-colors"><LogOut className="w-4 h-4 mr-2"/> Salir</button>
            </nav>
          </div>
        </div>
      </header>

      {/* ÁREA DE TRABAJO */}
      <div className="flex-grow w-full max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-8 relative z-0">
        <div className="animate-in fade-in slide-in-from-bottom-2 duration-500">
          {activeTab === 'caja' && <TabCaja atletas={atletas} eventos={eventos.filter((e) => e.fecha >= new Date().toISOString().split('T')[0])} recargarDatos={cargarDatos} userRole={userRole} userId={session?.user?.id} />}
          {activeTab === 'atletas' && <TabAtletas recargarDatos={cargarDatos} clubes={clubes} userId={session?.user?.id} />}
          {activeTab === 'lista_atletas' && userRole === 'Administrador' && <TabListaAtletas atletas={atletas} clubes={clubes} recargarDatos={cargarDatos} />}
          {activeTab === 'clubes' && userRole === 'Administrador' && <TabClubes recargarDatos={cargarDatos} clubes={clubes} atletas={atletas} />}
          {activeTab === 'entrega_kits' && (userRole === 'Administrador' || userRole === 'Moderador') && <TabEntregaKits eventos={eventos} userRole={userRole} userId={session?.user?.id} />}
          {activeTab === 'eventos' && (userRole === 'Administrador' || userRole === 'Moderador') && <TabEventos recargarDatos={cargarDatos} eventos={eventos} userRole={userRole} userId={session?.user?.id} />}
          {activeTab === 'reportes' && (userRole === 'Administrador' || userRole === 'Moderador') && <TabReportes eventos={eventos} userRole={userRole} userId={session?.user?.id} />}
          {activeTab === 'usuarios' && userRole === 'Administrador' && <TabUsuarios eventos={eventos} />}
          {activeTab === 'cotizaciones' && userRole === 'Administrador' && <TabCotizaciones userRole={userRole} />}
        </div>
      </div>

      {/* =========================================================
          MENÚ MÓVIL SÓLIDO (100% SEGURO PARA ANDROID)
          Separado del <header> para evitar superposición de capas
          ========================================================= */}
      {isMobileMenuOpen && (
        <div className="md:hidden fixed top-0 left-0 w-full h-full bg-white z-[99999] flex flex-col overflow-y-auto">

          {/* Encabezado del Menú */}
          <div className="flex justify-between items-center p-5 border-b border-slate-200 sticky top-0 bg-white z-10">
            <div className="flex items-center gap-3">
              <div className="bg-slate-900 text-white p-2.5 rounded-lg shadow-sm">
                <Command className="w-5 h-5"/>
              </div>
              <div className="leading-none">
                <p className="text-slate-900 font-bold text-[16px]">Menú Principal</p>
                <p className="text-[10px] text-slate-500 uppercase tracking-widest mt-1">ACTV SaaS</p>
              </div>
            </div>
            <button
              onClick={() => setIsMobileMenuOpen(false)}
              className="p-2.5 bg-slate-100 text-slate-600 hover:bg-slate-200 rounded-full transition-colors focus:outline-none"
            >
              <X size={24} />
            </button>
          </div>

          {/* Botones del Menú */}
          <div className="flex-1 p-5 space-y-2 pb-12">

            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest px-2 py-1">Panel de Trabajo</p>

            <button onClick={() => handleTabChange('caja')} className={`flex w-full items-center px-4 py-4 rounded-xl text-[15px] font-bold ${activeTab === 'caja' ? 'bg-slate-900 text-white' : 'bg-slate-50 text-slate-700'}`}>
              <Store className="w-5 h-5 mr-3" /> Caja
            </button>

            <button onClick={() => handleTabChange('atletas')} className={`flex w-full items-center px-4 py-4 rounded-xl text-[15px] font-bold ${activeTab === 'atletas' ? 'bg-slate-900 text-white' : 'bg-slate-50 text-slate-700'}`}>
              <UserPlus className="w-5 h-5 mr-3" /> Nuevo Atleta
            </button>

            {userRole === 'Administrador' && (
              <button onClick={() => handleTabChange('lista_atletas')} className={`flex w-full items-center px-4 py-4 rounded-xl text-[15px] font-bold ${activeTab === 'lista_atletas' ? 'bg-slate-900 text-white' : 'bg-slate-50 text-slate-700'}`}>
                <Users className="w-5 h-5 mr-3" /> Padrón
              </button>
            )}

            {(userRole === 'Administrador' || userRole === 'Moderador') && (
              <>
                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest px-2 py-1 mt-6">Logística y Reportes</p>

                <button onClick={() => handleTabChange('entrega_kits')} className={`flex w-full items-center px-4 py-4 rounded-xl text-[15px] font-bold ${activeTab === 'entrega_kits' ? 'bg-slate-900 text-white' : 'bg-slate-50 text-slate-700'}`}>
                  <Package className="w-5 h-5 mr-3" /> Kits
                </button>

                <button onClick={() => handleTabChange('reportes')} className={`flex w-full items-center px-4 py-4 rounded-xl text-[15px] font-bold ${activeTab === 'reportes' ? 'bg-slate-900 text-white' : 'bg-slate-50 text-slate-700'}`}>
                  <BarChart3 className="w-5 h-5 mr-3" /> Reportes
                </button>

                <button onClick={() => handleTabChange('eventos')} className={`flex w-full items-center px-4 py-4 rounded-xl text-[15px] font-bold ${activeTab === 'eventos' ? 'bg-slate-900 text-white' : 'bg-slate-50 text-slate-700'}`}>
                  <Calendar className="w-5 h-5 mr-3" /> Eventos
                </button>
              </>
            )}

            {userRole === 'Administrador' && (
              <>
                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest px-2 py-1 mt-6">Administración</p>

                <button onClick={() => handleTabChange('clubes')} className={`flex w-full items-center px-4 py-4 rounded-xl text-[15px] font-bold ${activeTab === 'clubes' ? 'bg-slate-900 text-white' : 'bg-slate-50 text-slate-700'}`}>
                  <Shield className="w-5 h-5 mr-3" /> Clubes
                </button>

                <button onClick={() => handleTabChange('usuarios')} className={`flex w-full items-center px-4 py-4 rounded-xl text-[15px] font-bold ${activeTab === 'usuarios' ? 'bg-slate-900 text-white' : 'bg-slate-50 text-slate-700'}`}>
                  <UserCog className="w-5 h-5 mr-3" /> Usuarios
                </button>

                <button onClick={() => handleTabChange('cotizaciones')} className={`flex w-full items-center px-4 py-4 rounded-xl text-[15px] font-bold ${activeTab === 'cotizaciones' ? 'bg-slate-900 text-white' : 'bg-slate-50 text-slate-700'}`}>
                  <FileText className="w-5 h-5 mr-3" /> Cotizaciones
                </button>
              </>
            )}

            <div className="h-px bg-slate-200 my-6 mx-2"></div>

            <button onClick={handleLogout} className="flex w-full items-center justify-center px-4 py-4 rounded-xl text-[15px] font-bold text-red-600 bg-red-50 mt-4">
              <LogOut className="w-5 h-5 mr-3" /> Cerrar Sesión
            </button>

          </div>
        </div>
      )}
    </main>
  );
}
