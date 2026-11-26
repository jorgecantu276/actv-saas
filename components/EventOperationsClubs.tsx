'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { supabase } from '@/lib/supabase';

type ClubFields = {
  nombre: string; responsable1: string; telefono1: string; responsable2: string; telefono2: string;
  logo_url: string; facebook_url: string; instagram_url: string; web_url: string;
};
type Club = ClubFields & { id: number; total_atletas: number };
type Member = { id: string; nombre: string; apellido: string; telefono: string | null;
  club: string | null; talla_playera: string | null; genero: string | null };
type Page<T> = { total: number; rows: T[] };
const pageSize = 25;
const empty: ClubFields = { nombre: '', responsable1: '', telefono1: '', responsable2: '', telefono2: '',
  logo_url: '', facebook_url: '', instagram_url: '', web_url: '' };
const labels: Record<keyof ClubFields, string> = { nombre: 'Club o equipo', responsable1: 'Responsable principal',
  telefono1: 'Teléfono principal', responsable2: 'Responsable secundario', telefono2: 'Teléfono secundario',
  logo_url: 'URL del logo', facebook_url: 'Facebook', instagram_url: 'Instagram', web_url: 'Sitio web' };
const button = 'rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold disabled:opacity-50';
const field = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm';
const safeUrl = (url: string | null | undefined) => /^https?:\/\/[^\s]+$/i.test(url ?? '') ? url! : undefined;
const html = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!));
const cell = (value: unknown) => {
  const text = String(value ?? '');
  return /^[\s]*[=+@-]/.test(text) ? "'" + text : text;
};

/** Global directory authority is checked on every server request. */
export default function EventOperationsClubs() {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('az');
  const [offset, setOffset] = useState(0);
  const [result, setResult] = useState<Page<Club> | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [form, setForm] = useState<ClubFields>(empty);
  const [editing, setEditing] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const mutation = useRef(false);
  const [selected, setSelected] = useState<Club | null>(null);
  const [memberQuery, setMemberQuery] = useState('');
  const [memberOffset, setMemberOffset] = useState(0);
  const [members, setMembers] = useState<Page<Member> | null>(null);
  const [membersLoading, setMembersLoading] = useState(false);
  const [memberError, setMemberError] = useState('');
  const [exporting, setExporting] = useState(false);
  const exportController = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    void (async () => {
      try {
        const { data, error: failure } = await supabase.rpc('actv_operations_clubs', {
          p_query: query.trim(), p_offset: offset, p_limit: pageSize, p_sort: sort,
        }).abortSignal(controller.signal);
        if (controller.signal.aborted) return;
        if (failure) throw failure;
        setResult(data as Page<Club>);
      } catch (failure) {
        if (!controller.signal.aborted) { setResult(null); setError((failure as { message?: string }).message || 'No se pudo cargar el directorio.'); }
      } finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => controller.abort();
  }, [query, sort, offset, refresh]);

  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();
    setMembersLoading(true); setMembers(null); setMemberError('');
    void (async () => {
      try {
        const { data, error: failure } = await supabase.rpc('actv_operations_club_members', {
          p_club_id: selected.id, p_query: memberQuery.trim(), p_offset: memberOffset, p_limit: pageSize,
        }).abortSignal(controller.signal);
        if (controller.signal.aborted) return;
        if (failure) throw failure;
        setMembers(data as Page<Member>);
      } catch (failure) {
        if (!controller.signal.aborted) setMemberError((failure as { message?: string }).message || 'No se pudieron cargar los integrantes.');
      } finally { if (!controller.signal.aborted) setMembersLoading(false); }
    })();
    return () => controller.abort();
  }, [selected, memberQuery, memberOffset, refresh]);
  useEffect(() => () => exportController.current?.abort(), []);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (mutation.current) return;
    mutation.current = true; setBusy(true); setError(''); setMessage('');
    try {
      const { data, error: failure } = await supabase.rpc('actv_save_club', { p_club_id: editing, p_fields: form });
      if (failure) throw failure;
      if (!data?.id) throw new Error('No se confirmó el club. Consulta el directorio antes de volver a registrar.');
      setMessage('Club guardado. Las inscripciones conservan su club aceptado; el cambio del nombre del directorio no reasigna perfiles.');
      setForm(empty); setEditing(null); setSelected(null); setRefresh(value => value + 1);
    } catch (failure) { setError((failure as { message?: string }).message || 'No se pudo confirmar el cambio. Consulta el directorio antes de repetirlo.'); }
    finally { mutation.current = false; setBusy(false); }
  }
  async function remove(club: Club) {
    if (mutation.current || !window.confirm(`¿Eliminar "${club.nombre}" del directorio? Sus perfiles e inscripciones se conservarán.`)) return;
    mutation.current = true; setBusy(true); setError(''); setMessage('');
    try {
      const { error: failure } = await supabase.rpc('actv_delete_club', { p_club_id: club.id });
      if (failure) throw failure;
      if (selected?.id === club.id) setSelected(null);
      if (editing === club.id) { setEditing(null); setForm(empty); }
      setMessage('Club retirado del directorio; perfiles e inscripciones conservados.');
      setRefresh(value => value + 1);
    } catch (failure) { setError((failure as { message?: string }).message || 'No se pudo confirmar la eliminación. Actualiza el directorio.'); }
    finally { mutation.current = false; setBusy(false); }
  }
  function edit(club: Club) {
    setEditing(club.id); setSelected(null); setMessage('');
    setForm(Object.fromEntries(Object.keys(empty).map(key => [key, club[key as keyof ClubFields] || ''])) as ClubFields);
  }
  async function exportDirectory(format: 'csv' | 'xls') {
    if (exportController.current) return;
    const controller = new AbortController(); exportController.current = controller;
    setExporting(true); setError(''); setMessage('Preparando exportación por páginas…');
    try {
      const clubs: Club[] = [];
      let total = 0;
      do {
        const { data, error: failure } = await supabase.rpc('actv_operations_clubs', {
          p_query: query.trim(), p_offset: clubs.length, p_limit: 100, p_sort: sort,
        }).abortSignal(controller.signal);
        if (controller.signal.aborted) return;
        if (failure) throw failure;
        const page = data as Page<Club>;
        if (!page || !Array.isArray(page.rows)) throw new Error('Exportación sin confirmar.');
        total = page.total;
        if (!page.rows.length && clubs.length < total) throw new Error('El directorio cambió; vuelve a exportar.');
        clubs.push(...page.rows);
        setMessage(`Preparando ${clubs.length} de ${total} clubes…`);
      } while (clubs.length < total);
      const headers = ['Club', 'Atletas', 'Responsable principal', 'Teléfono principal', 'Responsable secundario', 'Teléfono secundario', 'Logo', 'Facebook', 'Instagram', 'Sitio web'];
      const rows = clubs.map(club => [club.nombre, club.total_atletas, club.responsable1, club.telefono1, club.responsable2, club.telefono2,
        club.logo_url, club.facebook_url, club.instagram_url, club.web_url]);
      const content = format === 'csv'
        ? '\uFEFF' + [headers, ...rows].map(row => row.map(value => '"' + cell(value).replaceAll('"', '""') + '"').join(',')).join('\r\n')
        : '<html><head><meta charset="utf-8"></head><body><table>' + [headers, ...rows].map(row => '<tr>' + row.map(value => '<td>' + html(cell(value)) + '</td>').join('') + '</tr>').join('') + '</table></body></html>';
      const objectUrl = URL.createObjectURL(new Blob([content], { type: format === 'csv' ? 'text/csv;charset=utf-8' : 'application/vnd.ms-excel;charset=utf-8' }));
      const link = document.createElement('a'); link.href = objectUrl; link.download = `Clubes-ACTV-${Date.now()}.${format}`;
      link.click(); setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      setMessage(`${clubs.length} clubes exportados de la búsqueda actual. Los conteos corresponden al directorio consultado.`);
    } catch (failure) { if (!controller.signal.aborted) setError((failure as { message?: string }).message || 'No se pudo exportar el directorio.'); }
    finally { exportController.current = null; if (!controller.signal.aborted) setExporting(false); }
  }

  return <section className="space-y-6" aria-label="Directorio de clubes">
    <header><h2 className="text-xl font-bold">Clubes y equipos</h2><p className="mt-1 text-sm text-slate-600">Directorio de personal. Los conteos e integrantes se consultan en el servidor por páginas.</p></header>
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-800">{error}</p>}
    {message && <p role="status" className="rounded-lg bg-slate-100 p-3 text-sm">{message}</p>}
    <form onSubmit={event => void save(event)} className="space-y-3 rounded-xl border border-slate-200 p-4">
      <h3 className="font-bold">{editing === null ? 'Registrar club' : 'Editar club'}</h3>
      <div className="grid gap-3 md:grid-cols-2">{(Object.keys(empty) as (keyof ClubFields)[]).map(key => <label key={key} className="text-sm">
        {labels[key]}{['nombre', 'responsable1', 'telefono1'].includes(key) ? ' *' : ''}
        <input className={field} type={key.endsWith('_url') ? 'url' : key.startsWith('telefono') ? 'tel' : 'text'}
          required={['nombre', 'responsable1', 'telefono1'].includes(key)} maxLength={key.endsWith('_url') ? 2048 : key.startsWith('telefono') ? 30 : 150}
          value={form[key]} disabled={busy} onChange={event => setForm(previous => ({ ...previous, [key]: event.target.value }))} />
      </label>)}</div>
      {editing !== null && <p className="text-xs text-slate-600">Cambiar el nombre del directorio conserva los textos de club en perfiles y en inscripciones anteriores.</p>}
      <div className="flex gap-2"><button type="submit" className={button} disabled={busy}>{busy ? 'Guardando…' : 'Guardar club'}</button>
        {editing !== null && <button type="button" className={button} disabled={busy} onClick={() => { setEditing(null); setForm(empty); }}>Cancelar edición</button>}</div>
    </form>
    <div className="flex flex-wrap items-end gap-3">
      <label className="min-w-48 flex-1 text-sm">Buscar club o responsable<input type="search" maxLength={120} className={field} value={query} onChange={event => { setQuery(event.target.value); setOffset(0); }} /></label>
      <label className="text-sm">Orden<select className={field} value={sort} onChange={event => { setSort(event.target.value); setOffset(0); }}>
        <option value="az">A–Z</option><option value="za">Z–A</option><option value="mayor">Más integrantes</option><option value="menor">Menos integrantes</option>
      </select></label>
      <button type="button" className={button} disabled={loading} onClick={() => setRefresh(value => value + 1)}>Actualizar</button>
      <button type="button" className={button} disabled={exporting || loading || !result} onClick={() => void exportDirectory('csv')}>Exportar búsqueda CSV</button>
      <button type="button" className={button} disabled={exporting || loading || !result} onClick={() => void exportDirectory('xls')}>Exportar búsqueda Excel</button>
    </div>
    {loading && <p role="status">Consultando clubes…</p>}
    {result && <>
      <p className="text-sm text-slate-600">{result.total} clubes encontrados · página {Math.floor(offset / pageSize) + 1}</p>
      {!result.rows.length && <p>No hay clubes en esta página.</p>}
      <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200">{result.rows.map(club => <li key={club.id} className="space-y-3 p-4">
        <div className="flex items-start gap-3">
          {safeUrl(club.logo_url) && <img src={safeUrl(club.logo_url)} alt={`Logo de ${club.nombre}`} width={64} height={64} className="h-16 w-16 rounded-lg object-contain" />}
          <div className="flex-1"><h3 className="font-bold">{club.nombre}</h3>
            <p className="text-sm">{club.responsable1} · {club.telefono1}</p>
            {(club.responsable2 || club.telefono2) && <p className="text-sm">{club.responsable2} · {club.telefono2}</p>}
            <div className="mt-2 flex flex-wrap gap-3 text-sm">{(['facebook_url', 'instagram_url', 'web_url'] as const).map(key => safeUrl(club[key]) && <a key={key} href={safeUrl(club[key])} target="_blank" rel="noopener noreferrer" className="underline">{labels[key]}</a>)}</div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={loading || busy} onClick={() => { setSelected(club); setMemberQuery(''); setMemberOffset(0); }}>{club.total_atletas} integrantes</button>
          <button type="button" className={button} disabled={loading || busy} onClick={() => edit(club)}>Editar</button>
          <button type="button" className={button} disabled={loading || busy} onClick={() => void remove(club)}>Eliminar del directorio</button>
        </div>
      </li>)}</ul>
      <div className="flex gap-2"><button type="button" className={button} disabled={loading || offset === 0} onClick={() => setOffset(value => Math.max(0, value - pageSize))}>Anterior</button>
        <button type="button" className={button} disabled={loading || offset + pageSize >= result.total} onClick={() => setOffset(value => value + pageSize)}>Siguiente</button></div>
    </>}
    {selected && <section className="space-y-3 rounded-xl border border-slate-300 p-4" aria-label={`Integrantes de ${selected.nombre}`}>
      <div className="flex items-center justify-between gap-3"><h3 className="font-bold">Integrantes de {selected.nombre}</h3><button type="button" className={button} onClick={() => setSelected(null)}>Cerrar integrantes</button></div>
      <label className="block text-sm">Buscar nombre o teléfono<input type="search" maxLength={120} className={field} value={memberQuery} onChange={event => { setMemberQuery(event.target.value); setMemberOffset(0); }} /></label>
      {membersLoading && <p role="status">Consultando integrantes…</p>}{memberError && <p role="alert" className="text-red-800">{memberError}</p>}
      {members && <><p className="text-sm">{members.total} integrantes encontrados · página {Math.floor(memberOffset / pageSize) + 1}</p>
        <ul className="divide-y divide-slate-200">{members.rows.map(member => <li key={member.id} className="py-3">
          <p className="font-semibold">{member.nombre} {member.apellido}</p><p className="text-sm">Talla: {member.talla_playera || 'Sin dato'} · Género: {member.genero || 'Sin dato'}</p>
          {member.telefono && <div className="mt-1 flex gap-3 text-sm"><a href={`tel:${member.telefono.replace(/[^+\d]/g, '')}`} className="underline">Llamar: {member.telefono}</a>
            <a href={`https://wa.me/?text=${encodeURIComponent(`Hola ${member.nombre}, te contactamos de ACTV.`)}`} target="_blank" rel="noopener noreferrer" className="underline">WhatsApp</a></div>}
        </li>)}</ul>
        <div className="flex gap-2"><button type="button" className={button} disabled={membersLoading || memberOffset === 0} onClick={() => setMemberOffset(value => Math.max(0, value - pageSize))}>Anterior</button>
          <button type="button" className={button} disabled={membersLoading || memberOffset + pageSize >= members.total} onClick={() => setMemberOffset(value => value + pageSize)}>Siguiente</button></div>
      </>}
    </section>}
  </section>;
}
