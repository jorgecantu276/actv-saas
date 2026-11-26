'use client';
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { supabase } from '@/lib/supabase';
import type { Athlete, Club, RaceEvent } from '@/lib/legacy-types';
import EventOperationsRoster from './EventOperationsRoster';
import EventOperationsSettings from './EventOperationsSettings';
import styles from './EventOperations.module.css';

const TabCaja=dynamic(()=>import('./TabCaja'));
const TabEntregaKits=dynamic(()=>import('./TabEntregaKits'));
const TabReportes=dynamic(()=>import('./TabReportes'));
const TabAtletas=dynamic(()=>import('./TabAtletas'));
const TabListaAtletas=dynamic(()=>import('./TabListaAtletas'));
const EventOperationsClubs=dynamic(()=>import('./EventOperationsClubs'));
const TabUsuarios=dynamic(()=>import('./TabUsuarios'));
const TabCotizaciones=dynamic(()=>import('./TabCotizaciones'));
const AdminPayments=dynamic(()=>import('./AdminPayments'));
export type OperationsEvent=RaceEvent&{can_sell:boolean;can_manage:boolean;live_mode:boolean;online_enabled:boolean;slug:string|null;reader_id?:string|null;ready:boolean};
type Context={user_id:string;staff:boolean;manager:boolean;organizer:boolean;can_create_event:boolean;staff_label:string|null};
type Page<T>={rows:T[];total:number};

function Login(){const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  async function login(e:FormEvent){e.preventDefault();setBusy(true);setError('');const result=await supabase.auth.signInWithPassword({email:email.trim(),password});if(result.error)setError('Revisa tu correo y contraseña o pide un enlace de acceso.');setBusy(false);}
  async function link(){setBusy(true);setError('');const result=await supabase.auth.signInWithOtp({email:email.trim(),options:{shouldCreateUser:false,emailRedirectTo:new URL('/operaciones',window.location.origin).href}});if(result.error)setError('No fue posible pedir el enlace. Intenta más tarde.');else setNotice('Si esta cuenta existe, recibirás un enlace de acceso en tu correo.');setBusy(false);}
  return <section className={`${styles.panel} ${styles.login}`}><h1 className={styles.heading}>Operaciones ACTV</h1><p className={styles.muted}>Entra con tu cuenta de personal u organizador. Los permisos se consultan en el servidor.</p><form onSubmit={login}><label className={styles.field}>Correo<input type="email" autoComplete="username" required value={email} onChange={e=>setEmail(e.target.value)}/></label><label className={styles.field}>Contraseña<input type="password" autoComplete="current-password" required value={password} onChange={e=>setPassword(e.target.value)}/></label><button className={`${styles.button} ${styles.primary}`} disabled={busy}>Entrar</button></form><button className={styles.button} disabled={busy||!email.includes('@')} onClick={()=>void link()}>Recuperar acceso por correo</button>{error&&<p className={styles.error} role="alert">{error}</p>}{notice&&<p className={styles.notice} role="status">{notice}</p>}<p className={styles.muted}><Link href="/organizadores">Crear perfil de organizador</Link></p></section>;
}

function AthleteData({children}:{children:(data:Athlete[],clubs:Club[],reload:()=>void)=>ReactNode}){
  const [query,setQuery]=useState(''),[offset,setOffset]=useState(0),[revision,setRevision]=useState(0),[result,setResult]=useState<Page<Athlete>|null>(null),[clubs,setClubs]=useState<Club[]>([]),[error,setError]=useState(''),[loading,setLoading]=useState(true);
  const reload=useCallback(()=>setRevision(v=>v+1),[]);
  useEffect(()=>{const controller=new AbortController();
    async function load(){setLoading(true);setError('');try{const {data,error}=await supabase.rpc('actv_operations_athletes',{p_query:query,p_offset:offset,p_limit:50}).abortSignal(controller.signal);if(error)throw error;if(controller.signal.aborted)return;setResult(data as Page<Athlete>);
      const clubRows:Club[]=[];for(let start=0;;start+=500){const {data,error}=await supabase.from('clubes').select('*').order('id').range(start,start+499).abortSignal(controller.signal);if(error)throw error;if(controller.signal.aborted)return;clubRows.push(...data as Club[]);if(data.length<500)break;}setClubs(clubRows);
    }catch(e){if(!controller.signal.aborted){setResult(null);setError(String((e as {message?:string}).message??'No fue posible cargar.'));}}finally{if(!controller.signal.aborted)setLoading(false);}}
    const timer=setTimeout(()=>void load(),180);return()=>{clearTimeout(timer);controller.abort();};},[query,offset,revision]);
  return <><div className={styles.panel}><label className={styles.field}>Buscar atleta en el servidor<input type="search" maxLength={120} value={query} onChange={e=>{setQuery(e.target.value);setOffset(0);}} placeholder="Nombre, teléfono o club"/></label>{result&&<div className={styles.pager}><button className={styles.button} disabled={loading||offset===0} onClick={()=>setOffset(Math.max(0,offset-50))}>Anterior</button><span>Atletas {result.total===0?0:offset+1}–{Math.min(offset+50,result.total)} de {result.total}. La lista inferior corresponde a esta página.</span><button className={styles.button} disabled={loading||offset+50>=result.total} onClick={()=>setOffset(offset+50)}>Siguiente</button></div>}</div>{error&&<p className={styles.error} role="alert">{error}</p>}{loading&&<p className={styles.notice} role="status">Consultando atletas…</p>}{result&&!loading&&children(result.rows,clubs,reload)}</>;
}

export default function EventOperations({initialEventId=''}:{initialEventId?:string}){
  const [session,setSession]=useState<Session|null|undefined>(undefined),[context,setContext]=useState<Context|null>(null),[error,setError]=useState('');
  const [eventId,setEventId]=useState(initialEventId),[event,setEvent]=useState<OperationsEvent|null>(null),[events,setEvents]=useState<Page<OperationsEvent>>({rows:[],total:0});
  const [query,setQuery]=useState(''),[offset,setOffset]=useState(0),[revision,setRevision]=useState(0),[tab,setTab]=useState('roster'),[loading,setLoading]=useState(true),[creating,setCreating]=useState(false);
  const reload=useCallback(()=>setRevision(v=>v+1),[]);
  useEffect(()=>{let active=true;void supabase.auth.getSession().then(({data})=>{if(active)setSession(data.session);});const {data}=supabase.auth.onAuthStateChange((_event,current)=>{if(active){setSession(current);setContext(null);setEvent(null);}});return()=>{active=false;data.subscription.unsubscribe();};},[]);
  useEffect(()=>{if(!session)return;const controller=new AbortController();void supabase.rpc('actv_operations_context').abortSignal(controller.signal).then(({data,error})=>{if(controller.signal.aborted)return;setContext(error?null:data as Context);setError(error?.message??'');});return()=>controller.abort();},[session,revision,tab]);
  useEffect(()=>{if(!session)return;const controller=new AbortController();const timer=setTimeout(()=>{setLoading(true);void supabase.rpc('actv_operations_events',{p_query:query,p_offset:offset,p_limit:20}).abortSignal(controller.signal).then(({data,error})=>{if(controller.signal.aborted)return;setEvents(error?{rows:[],total:0}:data as Page<OperationsEvent>);setError(error?.message??'');setLoading(false);});},180);return()=>{clearTimeout(timer);controller.abort();};},[session,query,offset,revision]);
  useEffect(()=>{if(!session||!eventId){return;}const controller=new AbortController();void supabase.rpc('actv_operations_event',{p_event_id:eventId}).abortSignal(controller.signal).then(({data,error})=>{if(controller.signal.aborted)return;setEvent(error?null:data as OperationsEvent);setError(error?.message??'');});return()=>controller.abort();},[session,eventId,revision]);
  function selectEvent(id:string){setEvent(null);setEventId(id);setTab('roster');setCreating(false);const url=new URL('/operaciones',window.location.origin);if(id)url.searchParams.set('evento',id);window.history.replaceState(null,'',url.pathname+url.search);}
  async function signOut(){const {error}=await supabase.auth.signOut({scope:'local'});if(error)setError('No fue posible cerrar la sesión.');else{setContext(null);setEvent(null);setSession(null);}}
  const role=context?.manager?'Administrador':context?.staff_label??null;
  const globalTabs=context?.staff?[['athletes','Atletas'],['intake','Alta de atleta'],['clubs','Clubes'],['quotes','Clientes, servicios y cotizaciones'],...(context.manager?[['users','Usuarios y asignaciones'],['finance','Conciliación financiera']]:[])]:[];
  const eventTabs=event?[['roster','Inscripciones y asistencia'],...(event.can_sell?[['sales','Caja y recuperación'],['kits','Entrega de kits'],['reports','Reportes']]:[]),...(event.can_manage?[['settings','Configuración']]:[])]:[];
  return <main className={styles.surface}><header className={styles.header}><Link className={styles.brand} href="/operaciones">ACTV · Operaciones</Link><nav><Link href="/inicio">Inicio</Link><Link href="/mi-actv">Mi ACTV</Link><Link href="/organizadores">Organizador y cobros</Link>{session&&<button className={styles.button} onClick={()=>void signOut()}>Cerrar sesión</button>}</nav></header><div className={styles.body}>
    {session===undefined&&<p role="status">Cargando sesión…</p>}{session===null&&<Login/>}
    {session&&context&&<><div className={styles.row}><div><h1 className={styles.heading}>{event?.nombre_carrera??'Tus operaciones'}</h1><p className={styles.muted}>{session.user.email}{event&&` · ${event.fecha} · ${event.distancia} · ${event.live_mode?'Entorno real':'Entorno de pruebas'}`}</p></div><div className={styles.actions}>{eventId&&<button className={styles.button} onClick={()=>selectEvent('')}>Elegir otra carrera</button>}{context.can_create_event&&!eventId&&<button className={styles.button} onClick={()=>{setCreating(!creating);setTab('roster');}}>Nueva carrera</button>}</div></div>
      <nav className={styles.tabs} aria-label="Operaciones">{[['roster',event?'Carrera':'Carreras'],...globalTabs].map(([key,label])=><button key={key} type="button" aria-pressed={tab===key||eventTabs.some(([id])=>id===tab)&&key==='roster'} onClick={()=>{setTab(key);setCreating(false);}}>{label}</button>)}</nav>
      {error&&<p className={styles.error} role="alert">{error}</p>}
      {tab==='roster'&&!eventId&&!creating&&<section className={styles.panel}><label className={styles.field}>Buscar carrera<input type="search" maxLength={120} value={query} onChange={e=>{setQuery(e.target.value);setOffset(0);}}/></label>{loading&&<p role="status">Consultando carreras…</p>}<ul className={styles.list}>{events.rows.map(item=><li key={item.id}><div><strong>{item.nombre_carrera}</strong><span className={styles.muted}>{item.fecha} · {item.distancia} · {item.live_mode?'Real':'Pruebas'} · {item.can_sell?'Personal asignado':'Organizador'}</span></div><button className={styles.button} onClick={()=>selectEvent(item.id)}>Operar carrera</button></li>)}</ul>{!loading&&events.total===0&&<p className={styles.muted}>No hay carreras asignadas. Un administrador puede revisar tu acceso; los organizadores pueden crear su perfil.</p>}<div className={styles.pager}><button className={styles.button} disabled={loading||offset===0} onClick={()=>setOffset(Math.max(0,offset-20))}>Anterior</button><span>{events.total===0?0:offset+1}–{Math.min(offset+20,events.total)} de {events.total}</span><button className={styles.button} disabled={loading||offset+20>=events.total} onClick={()=>setOffset(offset+20)}>Siguiente</button></div></section>}
      {creating&&context.can_create_event&&<EventOperationsSettings event={null} manager={context.manager} onSaved={id=>{selectEvent(id);reload();}}/>}
      {!!eventId&&!event&&tab==='roster'&&<p className={styles.notice}>Consulta o actualiza los permisos de la carrera. <button className={styles.button} onClick={reload}>Volver a consultar</button></p>}
      {event&&eventTabs.some(([key])=>key===tab)&&<><nav className={styles.tabs} aria-label="Secciones de esta carrera">{eventTabs.map(([key,label])=><button key={key} aria-pressed={tab===key} onClick={()=>setTab(key)}>{label}</button>)}</nav>{tab==='roster'&&<EventOperationsRoster key={event.id} eventId={event.id}/>} {tab==='sales'&&event.can_sell&&<AthleteData>{(athletes)=> <TabCaja atletas={athletes} eventos={[event]} recargarDatos={reload} userRole={role} userId={context.user_id}/>}</AthleteData>}{tab==='kits'&&event.can_sell&&<TabEntregaKits key={event.id} eventos={[event]} eventId={event.id} userRole={role} userId={context.user_id}/>} {tab==='reports'&&event.can_sell&&<TabReportes key={event.id} eventos={[event]} userRole={role} userId={context.user_id}/>} {tab==='settings'&&event.can_manage&&<EventOperationsSettings key={event.id} event={event} manager={context.manager} onSaved={()=>reload()}/>}</>}
      {tab==='athletes'&&context.staff&&<AthleteData>{(athletes,clubs,refresh)=><TabListaAtletas atletas={athletes} clubes={clubs} recargarDatos={refresh}/>}</AthleteData>}
      {tab==='intake'&&context.staff&&<AthleteData>{(_athletes,clubs,refresh)=><TabAtletas clubes={clubs} userId={context.user_id} recargarDatos={refresh}/>}</AthleteData>}
      {tab==='clubs'&&context.staff&&<EventOperationsClubs/>}
      {tab==='quotes'&&context.staff&&<TabCotizaciones userRole={role}/>}
      {tab==='users'&&context.manager&&<AllEventsForUsers/>}
      {tab==='finance'&&context.manager&&<AdminPayments/>}
    </>}
    {session&&!context&&!error&&<p role="status">Consultando permisos…</p>}
    {session&&!context&&error&&<p className={styles.error} role="alert">{error}</p>}
  </div></main>;
}

function AllEventsForUsers(){const [events,setEvents]=useState<OperationsEvent[]>([]),[error,setError]=useState(''),[loading,setLoading]=useState(true);useEffect(()=>{const controller=new AbortController();void(async()=>{try{let rows:OperationsEvent[]=[];for(let offset=0;;offset+=100){const {data,error}=await supabase.rpc('actv_operations_events',{p_offset:offset,p_limit:100}).abortSignal(controller.signal);if(error)throw error;if(controller.signal.aborted)return;const page=data as Page<OperationsEvent>;rows=rows.concat(page.rows);if(rows.length>=page.total||!page.rows.length)break;}setEvents(rows);}catch(e){if(!controller.signal.aborted)setError(String((e as {message?:string}).message));}finally{if(!controller.signal.aborted)setLoading(false);}})();return()=>controller.abort();},[]);return loading?<p role="status">Cargando carreras para asignación…</p>:error?<p className={styles.error} role="alert">{error}</p>:<TabUsuarios eventos={events}/>;}
