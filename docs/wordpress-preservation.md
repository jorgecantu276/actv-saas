> Archivo de exploración anterior. Los trabajos de tienda, cronometraje externo y migración descritos aquí quedaron fuera de la entrega el 21 de noviembre de 2026. Requieren cotización y aprobación adicionales. Véase [alcance vigente](project-scope.md).

# Contenido y rutas de actv.mx

Inventario público revisado el 14 de noviembre de 2026. Next.js muestra accesos a este contenido desde `/inicio`. Los enlaces apuntan a WordPress, donde siguen las páginas, las galerías y las cuentas existentes. [Mapa del sitio](https://actv.mx/wp-sitemap.xml) · [Páginas de WordPress](https://actv.mx/wp-sitemap-posts-page-1.xml)

| Ruta actual | Qué conservar |
| --- | --- |
| `/` | Marca, fotos de carreras, presentación de productos y servicios, navegación editorial y formulario de suscripción. |
| `/eventos/` y las nueve crónicas | Galerías, textos, enlaces a resultados, URL de cada publicación y atribución de las fotos. `/inicio` enlaza las nueve crónicas. |
| `/calendario/` | Calendario 2026 y material gráfico publicado. Distinguir estas fechas de las próximas inscripciones en `/carreras`. |
| `/clubs/` | Página Running Clubs, que hoy sirve como entrada de navegación. |
| `/nosotros/` | Servicios de inscripción, logística, sublimación, dorsales, medallas, arcos y envíos México–Estados Unidos. |
| `/dashboard/`, `/ajustes/`, `/ajustes/lost-password/`, `/mi-cuenta-2/`, `/registro-actv/`, `/wp-signup.php` | Cuenta existente, recuperación de contraseña y registro en WordPress. Mi ACTV usa Supabase Auth y tiene su propio acceso. |
| `/tienda/`, `/producto/actv-neon-flow/`, `/carrito/`, `/finalizar-compra/` | Mantener los productos, variantes, carrito, cobro e historial existentes en WooCommerce mientras se verifica su recorrido en el nuevo sitio. |

La liga de resultados en las crónicas lleva a Mi Tiempo Chip. En el pie de WordPress aparecen términos, privacidad, cookies y cancelaciones como etiquetas, sin enlaces públicos comprobados. El botón de cotización de `/nosotros/` apunta a `#`. El formulario de suscripción sigue en WordPress. Si se sustituye esa página, hay que trasladar el formulario y comprobar el destino de cada alta. [Archivo de eventos](https://actv.mx/eventos/) · [Calendario](https://actv.mx/calendario/) · [Servicios](https://actv.mx/nosotros/) · [Mi Tiempo Chip](https://www.mitiempochip.com/)

## Rutas de carreras existentes

WordPress ya publica estas nueve rutas bajo `/carreras/`. Si Next.js pasa a servir el dominio principal, preservar cada ruta de WordPress hasta que su ficha tenga un destino equivalente. El comodín `/carreras/[slug]` de Next.js se usa para inscripciones de ACTV. [Mapa de fichas de carreras](https://actv.mx/wp-sitemap-posts-carreras-1.xml)

En la vista previa, Next.js consulta la disponibilidad de inscripción para estas nueve direcciones. Si el backend confirma que no hay una inscripción abierta, la página enlaza la ficha original. Si el backend no responde, la página muestra un aviso y permite volver a intentar. En un cambio de dominio, configurar `ACTV_LEGACY_WORDPRESS_ORIGIN` con el origen HTTPS que seguirá sirviendo esas fichas y verificar que cada liga mantenga su ruta. La página oculta el enlace a una ficha que resolvería en el mismo dominio para evitar un bucle.

- `/carreras/carrera-5k-rigo-tovar/`
- `/carreras/carrera-10k-roadrunners-5ta-edicion/`
- `/carreras/carrera-5k-bennigans-8va-edicion/`
- `/carreras/carrera-5k-8m-matamoros-2da-edicion/`
- `/carreras/atleta-playero-5k/`
- `/carreras/carrera-10k-medanos-5ta-edicion/`
- `/carreras/carrera-5k-cts-norteno-run/`
- `/carreras/carrera-6k-uat-corre-por-la-copa/`
- `/carreras/carrera-10k-super-xhab-2026/`

Antes de cambiar el dominio, cotejar los destinos por URL y confirmar que siguen operando el pago, el carrito, la recuperación de cuenta y la suscripción. Conservar la fuente pública de cada galería para que una crónica enlazada siga disponible tras el cambio. [Mapa de crónicas](https://actv.mx/wp-sitemap-posts-post-1.xml) · [Mapa de productos](https://actv.mx/wp-sitemap-posts-product-1.xml)

## Tienda y pedidos

`/tienda` y `/producto/[slug]` muestran los productos públicamente visibles en WooCommerce. El servidor consulta el catálogo y las variantes cada cinco minutos. La ficha envía al producto original con las opciones seleccionadas. WooCommerce gestiona cantidades, carrito, cupones, entrega, cobro y pedidos anteriores. Durante una caída del catálogo, la ficha de Neon Flow conserva la galería y enlaza a la tienda sin afirmar precio ni existencia. Si ya recibió el precio y falla la consulta de variantes, el comprador confirma las tallas en WooCommerce.

Antes de servir Next.js en el dominio principal, configurar `ACTV_LEGACY_WORDPRESS_ORIGIN` con el origen HTTPS donde seguirá el WordPress legado. Verificar que sus enlaces de producto y API declaren ese origen. Enrutar o migrar de forma explícita las páginas editoriales, medios y rutas privadas, mantener las sesiones y validar enlaces firmados de pago, recuperación y pedidos. Verificar con una copia de WooCommerce configurada para pruebas el carrito, los cupones, los envíos, los impuestos, los cobros y los correos. El inventario público de la tienda principal no abarca pedidos privados ni tiendas de carreras en subdominios.
