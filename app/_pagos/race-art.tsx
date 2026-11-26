import Image from 'next/image';
import styles from './race-journey.module.css';

export function RacePhoto({ priority = false, className, sizes }: {
  priority?: boolean;
  className?: string;
  sizes: string;
}) {
  return (
    <figure className={`${styles.photo} ${className ?? ''}`}>
      <Image src="/historico/contas-salida.jpg" alt="Corredores del 5K de los Contas junto al arco azul, en Matamoros"
        fill sizes={sizes} preload={priority} loading={priority ? undefined : 'eager'} />
      <figcaption>5K de los Contas <span aria-hidden="true">/</span> Archivo ACTV</figcaption>
    </figure>
  );
}

