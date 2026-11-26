'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import type { OperationsEvent } from './EventOperations';
import styles from './EventOperations.module.css';

type Policy = { required_fields: string[]; notice_version: string | null; waiver_version: string | null; notice_text: string | null; waiver_text: string | null; revision: number };
const fieldLabels: Record<string,string> = {nombre:'Nombre',apellido:'Apellido',telefono:'Teléfono',telefono_emergencia:'Teléfono de emergencia',talla_playera:'Talla',fecha_nacimiento:'Fecha de nacimiento',genero:'Género',ciudad:'Ciudad',club:'Club',email:'Correo'};

export default function EventOperationsSettings({ event, manager, onSaved }: { event: OperationsEvent | null; manager: boolean; onSaved: (id: string) => void }) {
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [policy,setPolicy]=useState<Policy|null>(null);
  const identity=useRef<string>('');
  useEffect(()=>{if(!event){identity.current=crypto.randomUUID();return;}const controller=new AbortController();void supabase.rpc('actv_registration_policy',{p_event_id:event.id}).abortSignal(controller.signal).then(({data,error})=>{if(!controller.signal.aborted&&!error)setPolicy(data as Policy);});return()=>controller.abort();},[event]);
  async function save(e:FormEvent<HTMLFormElement>){e.preventDefault();setBusy(true);setError('');setNotice('');const form=new FormData(e.currentTarget);try{
    const {data,error}=await supabase.rpc('actv_operations_save_event',{p_event_id:event?.id??identity.current,p_values:{...(manager?{reader_id:String(form.get('reader_id')||'').trim()}:{}),name:form.get('name'),date:form.get('date'),distance:form.get('distance'),capacity:Number(form.get('capacity')),price:Number(form.get('price')),package_name:form.get('package_name'),price2:form.get('price2')?Number(form.get('price2')):null,package_name2:form.get('package_name2'),description:form.get('description'),image:form.get('image'),slug:form.get('slug'),live_mode:form.get('mode')==='live',online_enabled:form.get('online')==='on',folio_start:Number(form.get('folio_start')||1)}});
    if(error)throw error;setNotice('Carrera guardada. Las obligaciones existentes conservan su identidad.');onSaved(data.event_id);
  }catch(e){setError(e instanceof Error?e.message:String((e as {message?:string}).message??'No fue posible guardar.'));}finally{setBusy(false);}}
  async function savePolicy(e:FormEvent<HTMLFormElement>){e.preventDefault();if(!event)return;setBusy(true);setError('');const form=new FormData(e.currentTarget);try{const {error}=await supabase.rpc('actv_set_registration_policy',{p_event_id:event.id,p_required_fields:form.getAll('required'),p_notice_version:String(form.get('notice_version')||'').trim()||null,p_notice_text:String(form.get('notice_text')||'').trim()||null,p_waiver_version:String(form.get('waiver_version')||'').trim()||null,p_waiver_text:String(form.get('waiver_text')||'').trim()||null});if(error)throw error;setNotice('Política registrada para nuevas solicitudes. Los consentimientos anteriores conservan su versión.');}catch(e){setError(String((e as {message?:string}).message??'No fue posible guardar.'));}finally{setBusy(false);}}
  return <section className={styles.panel}><h2 className={styles.heading}>{event?'Configuración de la carrera':'Nueva carrera'}</h2><p className={styles.muted}>Elige explícitamente el entorno. Publicar requiere una cuenta de cobro verificada en ese entorno. La pausa de ventas conserva los pagos aceptados.</p>{error&&<p className={styles.error} role="alert">{error}</p>}{notice&&<p className={styles.notice} role="status">{notice}</p>}
    <form key={event?.id??'new'} className={styles.form} onSubmit={save}>
      <label className={styles.field}>Nombre<input name="name" defaultValue={event?.nombre_carrera??''} required minLength={3} maxLength={100}/></label>
      <label className={styles.field}>Fecha<input name="date" type="date" defaultValue={event?.fecha??''} required/></label>
      <label className={styles.field}>Distancia<input name="distance" defaultValue={event?.distancia??''} required maxLength={45}/></label>
      <label className={styles.field}>Cupo<input name="capacity" type="number" min={1} max={20000} defaultValue={event?.cupo_maximo??100} required/></label>
      <label className={styles.field}>Paquete 1<input name="package_name" defaultValue={event?.nombre_precio_1??'Individual'} required maxLength={100}/></label>
      <label className={styles.field}>Precio 1 (MXN)<input name="price" type="number" min="0.01" step="0.01" defaultValue={event?.precio_1??''} required/></label>
      <label className={styles.field}>Paquete 2 (opcional)<input name="package_name2" defaultValue={event?.nombre_precio_2??''} maxLength={100}/></label>
      <label className={styles.field}>Precio 2 (MXN)<input name="price2" type="number" min="0.01" step="0.01" defaultValue={event?.precio_2??''}/></label>
      <label className={styles.field}>Entorno<select name="mode" defaultValue={event?(event.live_mode?'live':'test'):''} required><option value="" disabled>Selecciona el entorno</option><option value="test">Pruebas</option><option value="live">Real</option></select></label>
      {manager&&<label className={styles.field}>Terminal de este entorno (opcional)<input name="reader_id" defaultValue={event?.reader_id??''} pattern="tmr_[A-Za-z0-9]+"/><span className={styles.muted}>Cambiar de entorno retira la terminal anterior. Vuelve a comprobarla antes de asignar la del nuevo entorno.</span></label>}
      <label className={styles.field}>Dirección pública<input name="slug" defaultValue={event?.slug??''} maxLength={80} placeholder="mi-carrera"/></label>
      {!event&&<label className={styles.field}>Primer folio<input name="folio_start" type="number" min={1} max={99999999} defaultValue={1} required/></label>}
      <label className={styles.field}>Imagen (URL)<input name="image" type="url" defaultValue={event?.imagen_evento??''} maxLength={2000}/></label>
      <label className={`${styles.field} ${styles.full}`}>Descripción<textarea name="description" defaultValue={event?.descripcion??''} maxLength={10000} rows={3}/></label>
      <label className={`${styles.check} ${styles.full}`}><input name="online" type="checkbox" defaultChecked={event?.online_enabled??false}/>Habilitar inscripciones en línea</label>
      <div className={`${styles.actions} ${styles.full}`}><button className={`${styles.button} ${styles.primary}`} disabled={busy}>Guardar carrera</button>{event&&<Link href={`/organizadores?evento=${event.id}#inscripcion-en-linea`}>Conexión y estado de Stripe</Link>}</div>
    </form>
    {event&&manager&&policy&&<section className={styles.separator}><h3>Campos y documentos de inscripción</h3><p className={styles.muted}>Registra la política aprobada por ACTV. Una exención deportiva y el aviso de privacidad son documentos distintos; la configuración no sustituye su aprobación.</p><form className={styles.form} onSubmit={savePolicy}>
      <fieldset className={styles.full}><legend>Campos obligatorios</legend><div className={styles.actions}>{Object.entries(fieldLabels).map(([key,label])=><label className={styles.check} key={key}><input type="checkbox" name="required" value={key} defaultChecked={policy.required_fields.includes(key)}/>{label}</label>)}</div></fieldset>
      <label className={styles.field}>Versión del aviso<input name="notice_version" defaultValue={policy.notice_version??''} maxLength={80}/></label><label className={styles.field}>Versión de exención<input name="waiver_version" defaultValue={policy.waiver_version??''} maxLength={80}/></label>
      <label className={styles.field}>Texto del aviso<textarea name="notice_text" defaultValue={policy.notice_text??''} rows={6}/></label><label className={styles.field}>Texto de exención<textarea name="waiver_text" defaultValue={policy.waiver_text??''} rows={6}/></label><button className={styles.button} disabled={busy}>Registrar política aprobada</button>
    </form></section>}
  </section>;
}
