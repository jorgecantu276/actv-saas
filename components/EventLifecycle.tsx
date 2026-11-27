'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { supabase } from '@/lib/supabase';
import styles from './EventOperations.module.css';
type State = {phase:string;sales_paused:boolean;revision:number;public_message:string;operational_date:string;can_manage:boolean};
export default function EventLifecycle({eventId,onChanged}:{eventId:string;onChanged:()=>void}) {
 return <LifecycleBody key={eventId} eventId={eventId} onChanged={onChanged}/>;
}
function LifecycleBody({eventId,onChanged}:{eventId:string;onChanged:()=>void}) {
 const [state,setState]=useState<State>(),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const [intent,setIntent]=useState<{id:string;args:Record<string,unknown>}>();
 async function reload(){const {data,error}=await supabase.rpc('actv_event_lifecycle',{p_event_id:eventId});if(error)throw error;setState(data);}
 useEffect(()=>{const abort=new AbortController();void supabase.rpc('actv_event_lifecycle',{p_event_id:eventId}).abortSignal(abort.signal).then(({data,error})=>{if(!abort.signal.aborted){if(error)setError(error.message);else setState(data);}});return()=>abort.abort();},[eventId]);
 async function submit(e:FormEvent<HTMLFormElement>){e.preventDefault();if(!state||busy)return;const element=e.currentTarget,form=new FormData(element);
 if(!intent&&form.get('action')==='postpone'&&!form.get('date')){setError('Selecciona la nueva fecha para aplazar.');return;}
 const args=intent?.args??{p_event_id:eventId,p_expected_revision:state.revision,p_request_id:crypto.randomUUID(),p_action:form.get('action'),p_reason:form.get('reason'),p_public_message:form.get('message'),p_new_date:form.get('action')==='postpone'?form.get('date'):null};
 setIntent({id:String(args.p_request_id),args});setBusy(true);setError('');
 try{const {data,error}=await supabase.rpc('actv_transition_event',args);if(error)throw error;setState({...data,can_manage:state.can_manage});setIntent(undefined);onChanged();}
 catch(e){const rejection=e as {code?:string;message?:string};if((/^(22|23)/.test(rejection.code??'')||['42501','P0001','P0002'].includes(rejection.code??''))){setIntent(undefined);element.reset();try{await reload();}catch{setState(undefined);}}setError(rejection.message??'No fue posible confirmar. Reintenta la misma solicitud.');}finally{setBusy(false);}}
 return <section className={styles.panel}><h3>Estado y cancelación de la carrera</h3>{error&&<p role="alert" className={styles.error}>{error}</p>}<button className={styles.button} disabled={busy||!!intent} onClick={()=>void reload().catch(()=>setError('No fue posible actualizar el estado.'))}>Actualizar estado</button>
 {state?<><p>Estado: {state.phase==='cancelled'?'Cancelada':state.phase==='postponed'?'Aplazada':'Programada'} · Ventas {state.sales_paused?'pausadas':'habilitadas según configuración'} · Fecha operativa {state.operational_date}</p><p>{state.public_message}</p>
 <p>La cancelación es definitiva. Conserva folios, pagos, cupo reservado y asistencias. Los reembolsos requieren una solicitud por orden y confirmación de su resultado.</p>
 {state.can_manage&&state.phase!=='cancelled'&&<form className={styles.form} onSubmit={submit}><fieldset disabled={busy||!!intent}>
 <label className={styles.field}>Acción<select name="action"><option value="pause">Pausar ventas de esta carrera</option><option value="resume">Reanudar ventas</option><option value="postpone">Aplazar y pausar ventas</option><option value="cancel">Cancelar definitivamente</option></select></label>
 <label className={styles.field}>Nueva fecha para aplazamiento<input type="date" name="date"/></label>
 <label className={styles.field}>Motivo interno<textarea name="reason" required minLength={10} maxLength={500}/></label>
 <label className={styles.field}>Aviso para participantes<textarea name="message" maxLength={1000}/></label>
 <label><input type="checkbox" required/> Confirmo la acción y revisaré los pagos aceptados y sus reembolsos.</label></fieldset>
 <button className={styles.button} disabled={busy}>{busy?'Guardando…':intent?'Reintentar misma solicitud':'Confirmar transición'}</button>
 {intent&&!busy&&<p>La solicitud conserva sus datos hasta confirmar el resultado. Actualiza la página para consultar el estado antes de preparar una acción diferente.</p>}</form>}</>:<p role="status">Consultando estado…</p>}</section>;
}
