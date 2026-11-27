import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// Runs only inside the owned browser harness and synthetic local API.
export async function verifyLinkingBrowser({ managerPage, browser, appOrigin, apiUrl, manager, recipient, db, rpc }) {
  assert(['127.0.0.1', 'localhost'].includes(new URL(apiUrl).hostname));
  let assertions = 0;
  const check = condition => { assert(condition); assertions++; };
  const race = randomUUID(), athlete = randomUUID(), raceName = 'Synthetic linking browser ' + race.slice(0, 8);
  await db.query(`insert into public.eventos(id,nombre_carrera,fecha,organizador,distancia,precio_1,nombre_precio_1,cupo_maximo,folio_inicial)
    values($1,$2,(now() at time zone 'America/Matamoros')::date,'ACTV','5K',500,'Browser linking package',10,1)`, [race, raceName]);
  await db.query("insert into actv_payments.events(event_id,organizer_id) values($1,'00000000-0000-4000-8000-000000000ac7')", [race]);
  await db.query(`insert into public.atletas(id,nombre,apellido,telefono,telefono_emergencia,talla_playera)
    values($1,'Browser Linking','Participant','8685550100','8685550101','M')`, [athlete]);
  const order = await rpc(manager.client, 'actv_create_staff_order', { p_event_id: race, p_request_id: randomUUID(),
    p_channel: 'cash', p_items: [{ athlete_id: athlete, package: 1 }], p_relay: false });
  const shift = await rpc(manager.client, 'actv_open_shift', { p_opening: 50000 });
  const issued = await rpc(manager.client, 'actv_confirm_cash', { p_order_id: order.order_id, p_shift_id: shift.id, p_received: 50000 });
  const registration = issued.registrations[0];
  await managerPage.goto(appOrigin + '/operaciones', { waitUntil: 'domcontentloaded' });
  await managerPage.getByLabel('Buscar carrera', { exact: true }).fill(raceName);
  await managerPage.getByRole('listitem').filter({ hasText: raceName }).getByRole('button', { name: 'Operar carrera', exact: true }).click();
  const row = managerPage.getByRole('row').filter({ hasText: 'Browser Linking Participant' });
  await row.getByRole('button', { name: 'Detalle', exact: true }).click();
  const linking = managerPage.getByRole('region', { name: 'Vinculación personal del participante', exact: true });
  await linking.getByLabel('Correo confirmado del participante', { exact: true }).fill(recipient.email);
  await linking.getByLabel('Verificación', { exact: true }).selectOption('in_person');
  await linking.getByLabel('Motivo y referencia de verificación (sin documentos de identidad)', { exact: true }).fill('Synthetic browser direct identity attestation');
  await managerPage.route('**/rest/v1/rpc/actv_create_participant_invitation', async route => {
    const response = await route.fetch(); assert(response.ok());
    await route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"Synthetic lost response after commit"}' });
  }, { times: 1 });
  await linking.getByRole('button', { name: 'Crear invitación privada', exact: true }).click();
  await linking.getByText('No pudimos crear la invitación. Revisa el correo, la verificación y el estado del folio. Puedes reintentar.', { exact: true }).waitFor();
  await linking.getByRole('button', { name: 'Crear invitación privada', exact: true }).click();
  const link = await linking.getByLabel('Enlace privado de invitación', { exact: true }).inputValue();
  check((await db.query('select count(*)::int n from actv_payments.participant_invitations where registration_id=$1', [registration.id])).rows[0].n === 1);
  check(new URL(link).pathname === '/mi-actv'); check(new URL(link).search === ''); check(/^#vincular=[a-f0-9]{64}$/.test(new URL(link).hash));
  const recipientContext = await browser.newContext({ serviceWorkers: 'block' });
  try {
    let external = 0;
    await recipientContext.route('**/*', route => {
      const url = new URL(route.request().url());
      if (['data:', 'blob:'].includes(url.protocol) || [appOrigin, new URL(apiUrl).origin].includes(url.origin)) return route.continue();
      external++; return route.abort('blockedbyclient');
    });
    const page = await recipientContext.newPage(); page.setDefaultTimeout(30000);
    // The supported password entry lives on the organizer account screen;
    // signing in there does not confer organizer membership or staff access.
    await page.goto(appOrigin + '/organizadores', { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
    await page.getByRole('button', { name: 'Entrar con contraseña', exact: true }).click();
    await page.getByLabel('Correo electrónico', { exact: true }).fill(recipient.email);
    await page.getByLabel('Contraseña', { exact: true }).fill(recipient.password);
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    await page.getByRole('button', { name: 'Cerrar sesión', exact: true }).waitFor();
    await page.goto(link, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.route('**/rest/v1/rpc/actv_accept_participant_invitation', async route => {
      const response = await route.fetch(); assert(response.ok());
      await route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"Synthetic lost response after commit"}' });
    }, { times: 1 });
    await page.getByRole('button', { name: 'Aceptar invitación', exact: true }).click();
    await page.getByText('No pudimos vincular el folio. Usa el correo confirmado de la invitación; también puede haber vencido o sido revocada.', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Aceptar invitación', exact: true }).click();
    await page.getByText('Vinculado a tu historial personal', { exact: true }).waitFor();
    check(!page.url().includes('vincular')); check(!page.url().includes(new URL(link).hash.slice(10)));
    check((await db.query('select user_id from actv_payments.runner_entries where registration_id=$1', [registration.id])).rows[0].user_id === recipient.id);
    check(external === 0);

    await managerPage.getByRole('button', { name: 'Cerrar detalle', exact: true }).click();
    await row.getByRole('button', { name: 'Registrar asistencia', exact: true }).click();
    await row.getByText('Kit pendiente · Presente', { exact: false }).waitFor();
    await row.getByRole('button', { name: 'Detalle', exact: true }).click();
    const attendance = managerPage.locator('section').filter({ has: managerPage.getByRole('heading', { name: 'Historial de asistencia', exact: true }) }).last();
    await attendance.getByText('Asistencia confirmada · Revisión 0', { exact: true }).waitFor();
    // Another authorized operator commits after this UI loaded its revision.
    await rpc(manager.client, 'actv_correct_attendance', { p_registration_id: registration.id, p_expected_revision: 0,
      p_request_id: randomUUID(), p_present: true, p_reason: 'Synthetic concurrent operator confirms existing observation' });
    await attendance.locator('select[name="present"]').selectOption('false');
    await attendance.getByLabel('Motivo', { exact: true }).fill('Synthetic browser observation corrected after verification');
    await attendance.getByRole('button', { name: 'Registrar corrección auditada', exact: true }).click();
    await attendance.getByText('Asistencia confirmada · Revisión 1', { exact: true }).waitFor();
    check(await attendance.locator('select[name="present"]').isEnabled());
    await attendance.locator('select[name="present"]').selectOption('false');
    await attendance.getByLabel('Motivo', { exact: true }).fill('Synthetic browser observation corrected after stale revision recovery');
    await attendance.getByRole('button', { name: 'Registrar corrección auditada', exact: true }).click();
    await attendance.getByText('Asistencia sin confirmar · Revisión 2', { exact: true }).waitFor();
    check((await db.query('select present from actv_payments.attendance_state where registration_id=$1', [registration.id])).rows[0].present === false);
    check((await db.query('select count(*)::int n from actv_payments.attendance where registration_id=$1', [registration.id])).rows[0].n === 1);

    const refund = managerPage.getByRole('region', { name: 'Reembolsos por participante', exact: true });
    await refund.getByLabel(/Browser Linking Participant/).check();
    await refund.getByLabel('Motivo y decisión de acceso', { exact: true }).fill('Synthetic browser participant cancellation refund');
    await refund.getByLabel('Confirmo que entregué realmente este efectivo.', { exact: true }).check();
    await refund.getByRole('button', { name: 'Registrar entrega de efectivo', exact: true }).click();
    await refund.getByText('Operación consultada. Revisa el estado confirmado abajo.', { exact: true }).waitFor();
    await refund.getByText(/500,00.*succeeded|500\.00.*succeeded/).waitFor();
    check((await db.query('select count(*)::int n from actv_payments.runner_entries where registration_id=$1', [registration.id])).rows[0].n === 1);
    await managerPage.getByRole('button', { name: 'Cerrar detalle', exact: true }).click();
    await managerPage.getByRole('button', { name: 'Configuración', exact: true }).click();
    const lifecycle = managerPage.locator('section').filter({ has: managerPage.getByRole('heading', { name: 'Estado y cancelación de la carrera', exact: true }) }).last();
    await lifecycle.locator('select[name="action"]').selectOption('cancel');
    await lifecycle.getByLabel('Motivo interno', { exact: true }).fill('Synthetic browser event cancellation reviewed');
    await lifecycle.getByLabel('Aviso para participantes', { exact: true }).fill('Synthetic event canceled. Contact operations about accepted payments.');
    await lifecycle.getByLabel('Confirmo la acción y revisaré los pagos aceptados y sus reembolsos.', { exact: true }).check();
    await lifecycle.getByRole('button', { name: 'Confirmar transición', exact: true }).click();
    await lifecycle.getByText(/Estado: Cancelada/).waitFor();
    check((await db.query('select phase from actv_payments.event_lifecycle where event_id=$1', [race])).rows[0].phase === 'cancelled');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByText('Vinculado a tu historial personal', { exact: true }).waitFor();
    check((await db.query('select count(*)::int n from actv_payments.runner_entries where registration_id=$1', [registration.id])).rows[0].n === 1);
    return { assertions, privateFragmentInvitation: true, lostResponseCreateAndAcceptRecovery: true, realRecipientBrowserLogin: true, auditedAttendanceCorrection: true, staleAttendanceRevisionRecovery: true,
      cashParticipantRefund: true, eventCancellation: true, preservedPersonalOwnership: true };
  } finally { await recipientContext.close(); }
}
