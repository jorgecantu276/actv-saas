import { wordpressOrigin as wordpressSite } from '@/lib/wordpress-origin';

export { wordpressSite };

export const wordpressPaths = {
  archive: '/eventos/',
  calendar: '/calendario/',
  clubs: '/clubs/',
  services: '/nosotros/',
  account: '/mi-cuenta-2/',
  accountSettings: '/ajustes/',
  accountDashboard: '/dashboard/',
  passwordReset: '/ajustes/lost-password/',
} as const;

export const legacyRacePages = [
  { slug: 'carrera-5k-rigo-tovar', title: 'Rigo Tovar 5K' },
  { slug: 'carrera-10k-roadrunners-5ta-edicion', title: '5.ª edición RoadRunners 10K' },
  { slug: 'carrera-5k-bennigans-8va-edicion', title: '8.ª edición Bennigans 5K' },
  { slug: 'carrera-5k-8m-matamoros-2da-edicion', title: '2.ª edición 5K 8M Matamoros' },
  { slug: 'atleta-playero-5k', title: 'Atleta Playero 5K' },
  { slug: 'carrera-10k-medanos-5ta-edicion', title: '5.ª edición Médanos 10K' },
  { slug: 'carrera-5k-cts-norteno-run', title: 'CTS 5K Norteño Run' },
  { slug: 'carrera-6k-uat-corre-por-la-copa', title: 'UAT 6K Corre por la Copa' },
  { slug: 'carrera-10k-super-xhab-2026', title: 'Súper XHAB 10K 2026' },
] as const;

export const raceArchive = [
  {
    title: '10.ª edición del 5K de los Contas',
    date: '2026-05-24',
    image: '/historico/contas-5k.jpg',
    alt: 'Corredores en ruta cerca del arco azul del 5K de los Contas',
    path: '/5k-10a-contas/',
  },
  {
    title: 'FACONSA 5K',
    date: '2026-05-10',
    image: '/historico/faconsa-5k.jpg',
    alt: 'Participantes de FACONSA reunidos con sus playeras de la carrera',
    path: '/2026-faconsa/',
  },
  {
    title: '10.ª Carrera 5K YAGEO Kemet',
    date: '2026-05-09',
    image: '/historico/yageo-kemet-5k.jpg',
    alt: 'Un corredor saluda a la cámara durante el 5K de YAGEO Kemet',
    path: '/%F0%9F%8F%81-exito-total-en-la-decima-carrera-5k-yageo-kemet-2026-en-matamoros/',
  },
] as const;

export const additionalRaceArticles = [
  { title: 'CTS 5K Norteño Run', date: '2026-04-18', path: '/carrera-cts-5k-norteno-run/' },
  { title: 'Atleta Playero 5K', date: '2026-04-08', path: '/carrera-atleta-playero-2026-5k/' },
  { title: 'Rigo Tovar 5K', date: '2026-03-29', path: '/carrera-rigo-tovar-5k/' },
  {
    title: '1.ª Expo Carreras y Runners Matamoros',
    date: '2026-03-28',
    path: '/1er-expo-carreras-y-runners-matamoros-2026-active-tu-aliado-para-la-carrera-perfecta/',
  },
  { title: '5.ª edición RoadRunners 10K', date: '2026-03-22', path: '/carrera-roadrunners-10k/' },
  { title: 'Bennigans 5K', date: '2026-03-15', path: '/carrera-bennigans-5k/' },
] as const;

export const wordpressResources = [
  {
    title: 'Calendario de Matamoros',
    description: 'Consulta las sedes y distancias publicadas en el calendario local.',
    href: wordpressSite + wordpressPaths.calendar,
  },
  {
    title: 'Running Clubs',
    description: 'Visita la sección de clubes de ACTV.',
    href: wordpressSite + wordpressPaths.clubs,
  },
  {
    title: 'Servicios para eventos',
    description: 'Inscripciones, playeras, medallas, dorsales y logística de ruta.',
    href: wordpressSite + wordpressPaths.services,
  },
];

export const wordpressAccountLinks = [
  { title: 'Mi Cuenta', path: wordpressPaths.account },
  { title: 'Dashboard', path: wordpressPaths.accountDashboard },
  { title: 'Ajustes', path: wordpressPaths.accountSettings },
  { title: 'Recuperar contraseña', path: wordpressPaths.passwordReset },
];
