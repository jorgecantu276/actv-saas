# Alcance vigente de ACTV

Actualizado el 22 de noviembre de 2026. El [plan de implementación](implementation-plan.md) gobierna la sustitución total del sistema de carreras y punto de venta. La aplicación anterior se apaga después de construir, probar y aceptar la nueva; no queda un POS antiguo operando en paralelo.

## Entrega incluida

- Una aplicación en Hostinger con tres experiencias: carreras públicas y compra como invitado; Mi ACTV; y un espacio de operación por carrera para organizadores y personal según sus permisos.
- Conservar la base operativa actual de Supabase, sus usuarios de personal, IDs, registros y folios. Reconocer y atender las inscripciones vigentes existentes sin inventar capturas de pago ni atribuir cuentas por nombre.
- Un solo ciclo de carrera, pedido, pago e inscripción para ventas en línea, efectivo y el dispositivo físico que resulte compatible y verificado. Mantener las reglas transaccionales, el cupo, la protección de duplicados, los reembolsos y la recuperación.
- Mantener las capacidades actuales necesarias: Caja, altas/búsqueda de atletas, grupos/relevos, recibos/reimpresión/WhatsApp, kits/fotos, asistencia, eventos, clubes, usuarios/asignaciones, reportes, clientes, servicios y cotizaciones. La administración secundaria vive dentro de la nueva aplicación; no depende de un enlace permanente al POS anterior.
- Conservar la impresión directa desde las tablets existentes a la PT210. Identificar y probar el servicio Android instalado antes de proponer un adaptador nuevo. Reimprimir el mismo pedido emitido sin otro cobro ni otro folio. Las cotizaciones conservan su propia semántica y los formatos que se utilicen.
- Mi ACTV permite activar la cuenta después de pagar, muestra primero la próxima carrera y su folio, y después las asistencias personales en una lista sencilla. Incluye vinculación verificada para compras físicas y acompañantes. La compra, el retiro de kit y la asistencia son hechos distintos.
- Pruebas de staging con el esquema completo, dispositivos reales, roles, carga, fallos y recuperación de base, evidencia de kits y efectivo; cambio coordinado de aplicación/esquema/funciones/configuración y retiro de todos los emisores antiguos de carreras.

## Límites de la entrega

- La tienda actual permanece en vivo como está. No se crea ni integra una nueva tienda, carrito, inventario, envíos o checkout de productos.
- No se importa ni sincroniza cronometraje, tiempos, clasificaciones o resultados de Mi Tiempo Chip u otro proveedor.
- No se migran cuentas, contraseñas, pedidos o historial externo de WordPress/Sheets. Conservar registros operativos existentes en Supabase no es una migración externa.
- El checkout general de Mercado Pago que está incompleto no se habilita en el lanzamiento inicial. Si el equipo físico utiliza otro proveedor, se valida e integra la ruta de mostrador necesaria dentro del mismo núcleo.
- No se supone compatibilidad del dispositivo de tarjeta, una aplicación Android nueva, un servidor de impresión, un cambio de equipo ni un recurso de pago nuevo sin la evidencia y decisión correspondientes.

La tienda nueva, los resultados externos y una migración de historial externo requieren cotización adicional y aprobación explícita. Si una obligación activa solo existe en un sistema externo, debe resolverse antes del corte o acordarse su transición de forma expresa; no se oculta una migración dentro de esta entrega.

## Condición de salida

La sustitución termina cuando las capacidades acordadas funcionan en la nueva aplicación, los folios válidos existentes siguen atendibles, la operación con tablets/impresora/tarjeta y la recuperación están probadas, la tienda permanece intacta y el POS y los emisores antiguos de carreras están apagados. El plan describe el trabajo pendiente; no declara que ya se haya desplegado.
