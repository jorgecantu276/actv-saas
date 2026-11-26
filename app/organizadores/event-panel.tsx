import { useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import styles from './event-panel.module.css';

type Registration = {
  registration_id: string;
  folio: string;
  name: string;
  attended: boolean;
};

type Attendance = {
  sales: number;
  attended: number;
  can_record: boolean;
  registrations: Registration[];
};

type AttendanceFilter = 'all' | 'present' | 'unrecorded';

const pageSize = 30;
const numberFormat = new Intl.NumberFormat('es-MX');

const searchable = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('es-MX');

export default function EventPanel({ eventId }: { eventId: string }) {
  const [attendance, setAttendance] = useState<Attendance | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<AttendanceFilter>('all');
  const [limit, setLimit] = useState(pageSize);
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [marking, setMarking] = useState<string | null>(null);
  const [loadError, setLoadError] = useState('');
  const [markError, setMarkError] = useState('');
  const [notice, setNotice] = useState('');
  const mutation = useRef<AbortController | null>(null);
  const canRecord = attendance?.can_record === true;

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const { data, error } = await supabase
          .rpc('actv_organizer_attendance', { p_event_id: eventId })
          .abortSignal(controller.signal);
        if (controller.signal.aborted) return;
        if (error || !data) {
          setAttendance(null);
          setLoadError(error?.code === '42501'
            ? 'Tu cuenta no tiene acceso a las inscripciones de este evento.'
            : 'No se pudo cargar la lista de inscripciones.');
          return;
        }
        setAttendance(data as Attendance);
      } catch {
        if (controller.signal.aborted) return;
        setAttendance(null);
        setLoadError('No se pudo cargar la lista de inscripciones.');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [eventId, refresh]);

  useEffect(() => () => mutation.current?.abort(), []);

  function reload() {
    setLoadError('');
    setLoading(true);
    setRefresh((value) => value + 1);
  }

  async function recordAttendance(registration: Registration) {
    if (!canRecord || mutation.current || registration.attended || loading) return;
    const controller = new AbortController();
    mutation.current = controller;
    setMarking(registration.registration_id);
    setMarkError('');
    setNotice('');
    try {
      const { data, error } = await supabase.rpc('actv_record_attendance', {
        p_event_id: eventId,
        p_registration_id: registration.registration_id,
      }).abortSignal(controller.signal);
      if (controller.signal.aborted) return;
      if (error) {
        setMarkError(error.code === '42501' || error.code === 'P0002'
          ? 'La inscripción ya no está disponible para registrar asistencia.'
          : 'No se pudo registrar la asistencia. Intenta de nuevo.');
      } else if (data === true) {
        setNotice('Asistencia registrada para el folio ' + registration.folio + '.');
      } else {
        setMarkError('No se pudo confirmar el cambio. Revisa el estado actualizado del folio.');
      }
      reload();
    } catch {
      if (controller.signal.aborted) return;
      setMarkError('No se pudo confirmar el cambio. Revisa el estado actualizado del folio.');
      reload();
    } finally {
      if (!controller.signal.aborted) {
        mutation.current = null;
        setMarking(null);
      }
    }
  }

  const terms = searchable(query.trim()).split(/\s+/).filter(Boolean);
  const matches = attendance?.registrations.filter((registration) => {
    if (filter === 'present' && !registration.attended) return false;
    if (filter === 'unrecorded' && registration.attended) return false;
    if (terms.length === 0) return true;
    const searchableFields = searchable(registration.folio + ' ' + registration.name);
    return terms.every((term) => searchableFields.includes(term));
  }) ?? [];

  return (
    <section id="inscritos" aria-labelledby="attendance-heading" className={styles.panel}>
      <header className={styles.header}>
        <h2 id="attendance-heading">Inscripciones y asistencia</h2>
        <button type="button" className={styles.button} onClick={reload} disabled={loading || !!marking}>
          <RefreshCw size={15} aria-hidden="true" /> Actualizar lista
        </button>
      </header>
      {(loadError || markError) && <p className={styles.alert} role="alert">{loadError || markError}</p>}
      <div aria-live="polite">
        {notice && <p className={styles.message}>{notice}</p>}
        {loading && !notice && <p className={styles.message}>{attendance ? 'Actualizando lista…' : 'Cargando inscripciones…'}</p>}
      </div>
      {attendance && (
        <>
          <dl className={styles.totals}>
            <div>
              <dt>Inscripciones pagadas</dt>
              <dd>{numberFormat.format(attendance.sales)}</dd>
            </div>
            <div>
              <dt>Presentes</dt>
              <dd>{numberFormat.format(attendance.attended)}</dd>
            </div>
            <div>
              <dt>Por registrar</dt>
              <dd>{numberFormat.format(attendance.sales - attendance.attended)}</dd>
            </div>
          </dl>
          {!canRecord && <p className={styles.message}>Podrás registrar asistencia a partir del día del evento.</p>}
          {attendance.registrations.length === 0
            ? <p className={styles.empty}>Todavía no hay inscripciones pagadas para este evento.</p>
            : (
              <>
                <div className={styles.filters}>
                  <label>
                    Buscar por folio o nombre
                    <input
                      type="search"
                      value={query}
                      onChange={(event) => { setQuery(event.target.value); setLimit(pageSize); }}
                      autoComplete="off"
                      maxLength={120}
                    />
                  </label>
                  <label>
                    Estado de asistencia
                    <select value={filter} onChange={(event) => { setFilter(event.target.value as AttendanceFilter); setLimit(pageSize); }}>
                      <option value="all">Todos</option>
                      <option value="present">Presentes</option>
                      <option value="unrecorded">Por registrar</option>
                    </select>
                  </label>
                </div>
                <p className={styles.count} role="status">
                  {matches.length > 0 && `Mostrando ${numberFormat.format(Math.min(limit, matches.length))} de ${numberFormat.format(matches.length)}`}
                </p>
                {matches.length === 0
                  ? <div className={styles.empty}>
                    <p>No se encontraron inscripciones.</p>
                    <button type="button" className={styles.button} onClick={() => {
                      setQuery('');
                      setFilter('all');
                      setLimit(pageSize);
                    }}>Limpiar filtros</button>
                  </div>
                  : <table className={styles.roster} aria-busy={loading}>
                    <caption className="sr-only">Participantes con inscripción pagada</caption>
                    <thead>
                      <tr>
                        <th scope="col">Folio</th>
                        <th scope="col">Participante</th>
                        <th scope="col">Asistencia</th>
                      </tr>
                    </thead>
                    <tbody>
                      {matches.slice(0, limit).map((registration) => (
                        <tr key={registration.registration_id}>
                          <th scope="row">{registration.folio}</th>
                          <td>
                            <div className={styles.participant}>
                              <span>{registration.name?.trim() || 'Participante sin nombre'}</span>
                            </div>
                          </td>
                          <td>
                            <div className={styles.rowActions}>
                              <span className={registration.attended ? styles.present : styles.pending}>
                                {registration.attended ? 'Presente' : 'Por registrar'}
                              </span>
                              {canRecord && !registration.attended && (
                                <button
                                  type="button"
                                  className={styles.mark}
                                  disabled={loading || !!marking}
                                  aria-label={'Registrar asistencia del folio ' + registration.folio}
                                  onClick={() => void recordAttendance(registration)}
                                >{marking === registration.registration_id ? 'Guardando…' : 'Registrar'}</button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>}
                {matches.length > limit && (
                  <button type="button" className={styles.more + ' ' + styles.button} onClick={() => setLimit((value) => value + pageSize)}>
                    Mostrar {Math.min(pageSize, matches.length - limit)} más
                  </button>
                )}
              </>
            )}
        </>
      )}
    </section>
  );
}
