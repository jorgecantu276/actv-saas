// Actual browser + app + owned local Supabase. Never use a retained browser
// profile, hosted credentials, traces, stored sessions, or real providers.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { chromium } from 'playwright';
import { verifyLinkingBrowser } from './linking-browser.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const delay = milliseconds => new Promise(done => setTimeout(done, milliseconds));
async function reservePort() {
  const server = createServer();
  await new Promise((done, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', done); });
  const port = server.address().port;
  await new Promise(done => server.close(done));
  return port;
}
async function stopOwnedServer(server) {
  if (!server?.pid || server.exitCode !== null || server.signalCode !== null) return;
  const exited = once(server, 'exit');
  if (process.platform === 'win32') {
    // This PID is the still-live ChildProcess spawned below, never a searched
    // listener or a reused retained app. Its descendants belong to this server.
    execFileSync('taskkill.exe', ['/PID', String(server.pid), '/T', '/F'], {
      windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], timeout: 15000,
    });
  } else process.kill(-server.pid, 'SIGTERM');
  let timer;
  try { await Promise.race([exited, new Promise((_, fail) => { timer = setTimeout(() => fail(Error('Owned browser-test server did not stop')), 10000); })]); }
  finally { clearTimeout(timer); }
}

export async function verifyOperationsBrowser(context) {
  const { db, apiUrl, anonKey, serviceKey } = context;
  assert.equal(new URL(apiUrl).hostname, '127.0.0.1');
  assert.equal(JSON.parse(readFileSync(join(root, 'node_modules/playwright/package.json'), 'utf8')).version, '1.65.1');
  assert(!readdirSync(root).some(name => name.startsWith('.env')), 'Browser staging refuses inherited dotenv files');
  const buildFile = join(root, '.next/BUILD_ID');
  const productionBuild = existsSync(buildFile) ? readFileSync(buildFile, 'utf8') : null;
  const rootTypeScriptConfig = readFileSync(join(root, 'tsconfig.json'), 'utf8');
  const nextEnvPath = join(root, 'next-env.d.ts');
  const originalNextEnv = existsSync(nextEnvPath) ? readFileSync(nextEnvPath) : null;
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  const admin = createClient(apiUrl, serviceKey, options);
  const staffIds = [];
  let assertions = 0, blockedExternal = 0, externalProviderRequests = 0, browserRequests = 0;
  const equal = (actual, expected) => { assert.deepEqual(actual, expected); assertions++; };
  const check = condition => { assert(condition); assertions++; };
  const rpc = async (client, name, input = {}) => {
    const result = await client.rpc(name, input);
    assert.equal(result.error, null, `Browser fixture ${name} must succeed`);
    return result.data;
  };
  const identity = async role => {
    const email = `browser-${role || 'organizer'}-${randomUUID()}@example.invalid`;
    const password = 'Synthetic-only-Aa1!-' + randomUUID();
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    assert.equal(created.error, null, 'Owned browser fixture Auth creation must succeed');
    const id = created.data.user.id;
    if (role) { await db.query('insert into actv_payments.staff(user_id,role,all_events) values($1,$2,$3)', [id, role, role === 'manager']); staffIds.push(id); }
    const client = createClient(apiUrl, anonKey, options);
    assert.equal((await client.auth.signInWithPassword({ email, password })).error, null);
    return { id, email, password, client };
  };
  const temporaryRoot = realpathSync(tmpdir());
  const temporary = mkdtempSync(join(temporaryRoot, 'actv-browser-'));
  const marker = randomUUID();
  writeFileSync(join(temporary, '.owned'), marker);
  const browserBuildId = randomUUID().replaceAll('-', '');
  const browserBuildRoot = join(root, '.next', 'actv-browser-' + browserBuildId);
  assert(!existsSync(browserBuildRoot));
  mkdirSync(browserBuildRoot, { recursive: true });
  writeFileSync(join(browserBuildRoot, '.owned'), marker);
  writeFileSync(join(browserBuildRoot, 'tsconfig.json'), JSON.stringify({
    extends: join(root, 'tsconfig.json'), compilerOptions: { baseUrl: root },
    include: [join(root, 'next-env.d.ts'), join(root, '**/*.ts'), join(root, '**/*.tsx'), join(root, '**/*.mts')],
    exclude: [join(root, 'node_modules'), join(root, 'tests'), join(root, 'supabase/functions')],
  }));
  const restoreNextEnv = () => {
    const current = existsSync(nextEnvPath) ? readFileSync(nextEnvPath) : null;
    const unchanged = current === null ? originalNextEnv === null : originalNextEnv !== null && current.equals(originalNextEnv);
    if (!unchanged) {
      // Next regenerates this ignored root declaration even with a private
      // tsconfig. Restore only our generated path, never an unrelated edit.
      assert(current !== null && current.toString('utf8').includes('actv-browser-' + browserBuildId),
        'Refusing to overwrite an unexpected next-env declaration change');
      if (originalNextEnv === null) rmSync(nextEnvPath);
      else writeFileSync(nextEnvPath, originalNextEnv);
    }
    const restored = existsSync(nextEnvPath) ? readFileSync(nextEnvPath) : null;
    assert(restored === null ? originalNextEnv === null : originalNextEnv !== null && restored.equals(originalNextEnv),
      'Original next-env declaration must be preserved');
  };
  let server, browser;
  try {
    const manager = await identity('manager'), cashier = await identity('cashier'), organizer = await identity(), recipient = await identity();
    const organization = await rpc(organizer.client, 'actv_organizer_signup', { p_name: 'Synthetic browser organizer' });
    const race = randomUUID(), athlete = randomUUID();
    const raceName = 'Synthetic browser operations ' + race.slice(0, 8);
    await db.query(`insert into public.eventos(id,nombre_carrera,fecha,organizador,distancia,precio_1,nombre_precio_1,cupo_maximo,folio_inicial)
      values($1,$2,current_date+7,'Synthetic browser organizer','5K',500,'Browser package',20,1)`, [race, raceName]);
    await db.query('insert into actv_payments.events(event_id,organizer_id) values($1,$2)', [race, organization.organizer_id]);
    await db.query('insert into actv_payments.staff_events(user_id,event_id) values($1,$2)', [cashier.id, race]);
    await db.query(`insert into public.atletas(id,nombre,apellido,telefono,telefono_emergencia,talla_playera,club)
      values($1,'Browser Original','Participant','8685550100','8685550101','M','Synthetic browser club')`, [athlete]);
    const order = await rpc(cashier.client, 'actv_create_staff_order', { p_event_id: race, p_request_id: randomUUID(),
      p_channel: 'cash', p_items: [{ athlete_id: athlete, package: 1 }], p_relay: false });
    const shift = await rpc(cashier.client, 'actv_open_shift', { p_opening: 0 });
    const issued = await rpc(cashier.client, 'actv_confirm_cash', { p_order_id: order.order_id, p_shift_id: shift.id, p_received: 50000 });
    const registration = issued.registrations[0];
    await db.query("update public.atletas set nombre='Browser later profile',talla_playera='XL' where id=$1", [athlete]);
    const port = await reservePort(), appOrigin = `http://127.0.0.1:${port}`;
    // Next's documented source test hook avoids font API/file network requests.
    // Font rendering is explicitly synthetic and cannot qualify printed output.
    const fontMock = join(temporary, 'fonts.cjs');
    writeFileSync(fontMock, `module.exports=new Proxy({}, {get(_target,url){const family=new URL(url).searchParams.get('family').split(':')[0];if(!['Geist','Geist Mono'].includes(family))throw Error('Unexpected test font');return "@font-face {font-family:'"+family+"';src:local('Arial');font-style:normal;font-weight:100 900;}";}});`);
    const environment = Object.fromEntries(Object.entries(process.env).filter(([name]) =>
      !/^(?:ACTV_|SUPABASE_|NEXT_PUBLIC_|STRIPE_|HOSTINGER_|AWS_|AZURE_|GOOGLE_|NEXT_FONT_|GH_TOKEN$|GITHUB_TOKEN$)/i.test(name)));
    Object.assign(environment, { NEXT_PUBLIC_SUPABASE_URL: apiUrl, NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey,
      SUPABASE_URL: apiUrl, SUPABASE_SERVICE_ROLE_KEY: serviceKey,
      NEXT_TELEMETRY_DISABLED: '1', NEXT_FONT_GOOGLE_MOCKED_RESPONSES: fontMock,
      ACTV_VERIFY_BROWSER_ID: browserBuildId,
      ACTV_STRIPE_MODE: 'test', ACTV_APP_URL: appOrigin, ACTV_STAFF_ORIGIN: appOrigin,
      ACTV_LEGACY_WORDPRESS_ORIGIN: 'https://example.invalid' });
    server = spawn(process.execPath, [join(root, 'node_modules/next/dist/bin/next'), 'dev', '--webpack', '--hostname', '127.0.0.1', '--port', String(port)], {
      cwd: root, env: environment, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'],
    });
    let ready = false;
    const privateOutput = [];
    server.stdout.on('data', data => { const text = data.toString(); if (text.includes('Ready')) ready = true; privateOutput.push(text); });
    server.stderr.on('data', data => privateOutput.push(data.toString()));
    let startupFailure;
    server.once('error', error => { startupFailure = error; });
    for (let attempt = 0; attempt < 120; attempt++) {
      if (startupFailure || server.exitCode !== null) throw Error('Owned browser-test server failed to start; private output withheld');
      if (ready) {
        const response = await fetch(appOrigin + '/operaciones', { signal: AbortSignal.timeout(90000) });
        if (response.ok) break;
      }
      if (attempt === 119) throw Error('Owned browser-test server readiness timed out');
      await delay(500);
    }
    browser = await chromium.launch({ headless: true });
    const browserVersion = browser.version();
    // Next dev recompiles shared client modules on the first public-route visit.
    // Finish those anonymous compilations before opening any staff draft/modal;
    // production builds serve precompiled routes and do not run this HMR path.
    console.info('ACTV browser phase: anonymous public route warming');
    const warming = await browser.newContext({ serviceWorkers: 'block' });
    try {
      await warming.route('**/*', route => {
        const url = new URL(route.request().url());
        if (['data:', 'blob:'].includes(url.protocol)) return route.continue();
        if (![appOrigin, new URL(apiUrl).origin].includes(url.origin)) {
          blockedExternal++;
          if (/stripe|mercadopago|facebook|actv\.mx/i.test(url.hostname)) externalProviderRequests++;
          return route.abort('blockedbyclient');
        }
        browserRequests++;
        return route.continue();
      });
      const warmPage = await warming.newPage();
      for (const path of ['/organizadores', '/mi-actv']) {
        const response = await warmPage.goto(appOrigin + path, { waitUntil: 'networkidle', timeout: 90000 });
        assert(response?.ok(), 'Owned anonymous public route must finish compiling');
      }
    } finally { await warming.close(); }
    const contexts = [];
    const open = async (user, viewport, expectedName = 'Browser Original Participant') => {
      const isolated = await browser.newContext({ viewport, serviceWorkers: 'block' });
      contexts.push(isolated);
      await isolated.route('**/*', async route => {
        const request = route.request(), url = new URL(request.url());
        if (['data:', 'blob:'].includes(url.protocol)) return route.continue();
        if (![appOrigin, new URL(apiUrl).origin].includes(url.origin)) {
          blockedExternal++;
          if (/stripe|mercadopago|facebook|actv\.mx/i.test(url.hostname)) externalProviderRequests++;
          return route.abort('blockedbyclient');
        }
        browserRequests++;
        return route.continue();
      });
      const page = await isolated.newPage();
      page.setDefaultTimeout(20000);
      await page.goto(appOrigin + '/operaciones', { waitUntil: 'domcontentloaded', timeout: 90000 });
      await page.getByLabel('Correo', { exact: true }).fill(user.email);
      await page.getByLabel('Contraseña', { exact: true }).fill(user.password);
      await page.getByRole('button', { name: 'Entrar', exact: true }).click();
      await page.getByLabel('Buscar carrera', { exact: true }).fill(raceName);
      await page.getByRole('listitem').filter({ hasText: raceName }).getByRole('button', { name: 'Operar carrera', exact: true }).click();
      await page.getByRole('heading', { name: 'Inscripciones y asistencia', exact: true }).waitFor();
      await page.getByLabel('Folio o participante', { exact: true }).fill(registration.folio_asignado);
      await page.getByRole('row').filter({ hasText: expectedName }).waitFor();
      return page;
    };
    const managerPage = await open(manager, { width: 1440, height: 1080 });
    check(await managerPage.getByRole('button', { name: 'Usuarios y asignaciones', exact: true }).isVisible());
    check(await managerPage.getByRole('button', { name: 'Caja y recuperación', exact: true }).isVisible());
    await managerPage.getByRole('row').filter({ hasText: 'Browser Original Participant' }).getByRole('button', { name: 'Detalle', exact: true }).click();
    const detail = managerPage.getByRole('region', { name: 'Datos e historial de inscripción', exact: true });
    await detail.getByRole('button', { name: 'Corregir datos con motivo', exact: true }).click();
    await detail.getByLabel('Nombre', { exact: true }).fill('Browser Corrected');
    await detail.getByLabel('Motivo de la corrección', { exact: true }).fill('Synthetic browser identity-checked typo correction');
    await detail.getByRole('button', { name: 'Guardar corrección', exact: true }).click();
    await detail.getByText('Corrección registrada. Se conservan la inscripción, el pago y el folio originales.', { exact: true }).waitFor();
    equal((await db.query('select revision from actv_payments.registration_snapshots where registration_id=$1', [registration.id])).rows[0].revision, 1);
    equal((await db.query('select original from actv_payments.registration_snapshots where registration_id=$1', [registration.id])).rows[0].original.participant.nombre, 'Browser Original');
    equal((await db.query('select effective from actv_payments.registration_snapshots where registration_id=$1', [registration.id])).rows[0].effective.participant.nombre, 'Browser Corrected');
    console.info('ACTV browser phase: original manager correction detail close');
    await managerPage.getByRole('button', { name: 'Cerrar detalle', exact: true }).click().catch(() => {
      throw new Error('ACTV operations browser phase failed: original manager correction detail close');
    });
    const row = managerPage.getByRole('row').filter({ hasText: 'Browser Corrected Participant' });
    await row.waitFor(); await row.getByRole('button', { name: 'Recibo', exact: true }).click();
    const receipt = managerPage.getByRole('dialog', { name: 'Recibo de inscripción', exact: true });
    await receipt.getByText('Browser Corrected Participant', { exact: false }).waitFor();
    check((await receipt.innerText()).includes(registration.folio_asignado));
    check((await receipt.innerText()).includes('500.00'));
    // Opening/reopening the same receipt never invokes print or another payment.
    await receipt.getByRole('button', { name: 'Cerrar', exact: true }).click();
    await row.getByRole('button', { name: 'Recibo', exact: true }).click(); await receipt.waitFor();
    await receipt.getByRole('button', { name: 'Cerrar', exact: true }).click();
    equal((await db.query('select count(*)::integer as n from public.inscripciones where evento_id=$1', [race])).rows[0].n, 1);
    mkdirSync(join(root, '.verification'), { recursive: true });
    await managerPage.screenshot({ path: join(root, '.verification/operations-desktop.png'), fullPage: true });
    const staffPage = await open(cashier, { width: 800, height: 1280 }, 'Browser Corrected Participant');
    // The corrected snapshot must be visible after a real fresh browser login.
    await staffPage.getByRole('row').filter({ hasText: 'Browser Corrected Participant' }).waitFor();
    equal(await staffPage.getByRole('button', { name: 'Usuarios y asignaciones', exact: true }).count(), 0);
    equal(await staffPage.getByRole('button', { name: 'Conciliación financiera', exact: true }).count(), 0);
    await staffPage.getByRole('row').filter({ hasText: 'Browser Corrected Participant' }).getByRole('button', { name: 'Detalle', exact: true }).click();
    const staffDetail = staffPage.getByRole('region', { name: 'Datos e historial de inscripción', exact: true });
    await staffDetail.getByText('Revisión 1 · Datos conservados al aceptar la orden', { exact: true }).waitFor();
    equal(await staffDetail.getByRole('button', { name: 'Corregir datos con motivo', exact: true }).count(), 0);
    console.info('ACTV browser phase: original cashier detail close');
    await staffPage.getByRole('button', { name: 'Cerrar detalle', exact: true }).click().catch(() => {
      throw new Error('ACTV operations browser phase failed: original cashier detail close');
    });
    await staffPage.screenshot({ path: join(root, '.verification/operations-tablet.png'), fullPage: true });
    const organizerPage = await open(organizer, { width: 1280, height: 900 }, 'Browser Corrected Participant');
    await organizerPage.getByRole('row').filter({ hasText: 'Browser Corrected Participant' }).waitFor();
    equal(await organizerPage.getByRole('button', { name: 'Caja y recuperación', exact: true }).count(), 0);
    equal(await organizerPage.getByRole('button', { name: 'Entrega de kits', exact: true }).count(), 0);
    equal(await organizerPage.getByRole('button', { name: 'Clubes', exact: true }).count(), 0);
    equal(await organizerPage.getByRole('button', { name: 'Recibo', exact: true }).count(), 0);
    check(await organizerPage.getByRole('button', { name: 'Configuración', exact: true }).isVisible());
    console.info('ACTV browser phase: linking helper start');
    const linking = await verifyLinkingBrowser({ managerPage, browser, appOrigin, apiUrl, manager, recipient, db, rpc });
    await db.query('update actv_payments.staff set active=false where user_id=$1', [cashier.id]);
    await staffPage.reload({ waitUntil: 'domcontentloaded' });
    await staffPage.getByRole('button', { name: 'Cerrar sesión', exact: true }).waitFor();
    await staffPage.getByText('Consulta o actualiza los permisos de la carrera.', { exact: false }).waitFor();
    equal(await staffPage.getByRole('button', { name: 'Detalle', exact: true }).count(), 0);
    equal(externalProviderRequests, 0); equal(blockedExternal, 0); check(browserRequests > 10);
    for (const isolated of contexts) await isolated.close();
    await browser.close(); browser = null;
    await stopOwnedServer(server); server = null;
    restoreNextEnv();
    if (productionBuild !== null) equal(readFileSync(buildFile, 'utf8'), productionBuild);
    equal(readFileSync(join(root, 'tsconfig.json'), 'utf8'), rootTypeScriptConfig);
    return { assertions, linking, browserVersion, actualBrowserAuthAndPostgrest: true, isolatedTemporaryBrowserContexts: true, publicRoutesWarmedAnonymously: true,
      managerCorrectionAndReceipt: true, staffAndOrganizerBoundaries: true, activeRevocation: true,
      externalRequests: blockedExternal, externalProviderRequests, fontMode: 'synthetic_local_system_fallback',
      screenshots: ['operations-desktop.png', 'operations-tablet.png'].map(path => ({ path,
        sha256: createHash('sha256').update(readFileSync(join(root, '.verification', path))).digest('hex') })),
      productionBuildPreserved: productionBuild === null ? null : true,
      rootTypeScriptConfigPreserved: true,
      nextEnvPreserved: true,
      physicalDeviceQualified: false, productionQualified: false };
  } finally {
    const cleanupFailures = [];
    const cleanup = async action => { try { await action(); } catch { cleanupFailures.push('owned_resource_cleanup_failed'); } };
    await cleanup(async () => { if (browser) await browser.close(); });
    await cleanup(() => stopOwnedServer(server));
    await cleanup(restoreNextEnv);
    await cleanup(async () => { if (staffIds.length) await db.query('delete from actv_payments.staff where user_id=any($1::uuid[])', [staffIds]); });
    await cleanup(() => {
      const actual = realpathSync(temporary), boundary = relative(temporaryRoot, actual);
      assert(boundary && boundary !== '..' && !boundary.startsWith('..' + sep) && !boundary.includes(sep));
      assert.equal(readFileSync(join(actual, '.owned'), 'utf8'), marker);
      rmSync(actual, { recursive: true });
    });
    await cleanup(() => {
      const actualBuild = realpathSync(browserBuildRoot);
      assert.equal(dirname(actualBuild), realpathSync(join(root, '.next')));
      assert.equal(readFileSync(join(actualBuild, '.owned'), 'utf8'), marker);
      rmSync(actualBuild, { recursive: true });
    });
    assert.equal(cleanupFailures.length, 0, 'Browser staging must remove all owned resources');
  }
}
