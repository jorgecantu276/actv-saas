import type { Metadata } from 'next';
import RunnerSpace from './runner-space';

export const metadata: Metadata = {
  title: 'Mi ACTV | Tu pasaporte de carreras',
  description: 'Tus próximas carreras, tu colección de asistencias y tus logros en la comunidad ACTV.',
  robots: { index: false, follow: false },
};

export default function MiActvPage() {
  return <RunnerSpace />;
}
