# 06. Especificación de Endurecimiento (Post-Auditoría)

**Origen:** Auditoría técnica del 2026-11-10 (`audit_report.md`), puntuación 3/10.
**Regla SDD:** cada requisito de este documento tiene al menos un test que fallaba antes de su implementación.

---

## RNF-04 · Integridad y honestidad de datos

| ID | Requisito | Test de verificación |
| :--- | :--- | :--- |
| RNF-04.1 | Toda parada declara `dataQuality ∈ { VERIFIED, DEMO_UNVERIFIED, UNVERIFIED_OSM, COMMUNITY_PENDING }`. | `data-integrity.spec.ts` |
| RNF-04.2 | Lo desconocido se representa como `null` (`ratingAvg`, `priceLevel`, cada servicio anexo). **Prohibido** inventar valores por defecto (p. ej. `4.1★`, `hasCleanRestrooms: true`). | `data-integrity.spec.ts` (adaptador OSM) |
| RNF-04.3 | El scorer trata `null` como neutro: calidad = *prior* Bayesiano ($v = 0 \Rightarrow R_{\text{bayes}} = C$), servicio desconocido = 0 puntos y **no** satisface un filtro obligatorio. | `domain-spec.spec.ts` |
| RNF-04.4 | El fallback de rutas **nunca** usa coordenadas de paradas como geometría. Usa (a) polilíneas de corredor pregrabadas o (b) línea recta, y declara `precision: 'HIGH' \| 'LOW'`. | `data-integrity.spec.ts` |
| RNF-04.5 | La telemetría de coste se calcula a partir de las llamadas de pago **realmente realizadas**. Nada de constantes. | `use-case.spec.ts` |
| RNF-04.6 | La UI muestra un aviso visible cuando algún resultado es `DEMO_UNVERIFIED` o `UNVERIFIED_OSM`, o cuando la ruta es `precision: 'LOW'`. | Revisión manual de la UI |
| RNF-04.7 | Los IDs del seed son coherentes con su `highwayCode` y su `kmMarker` (`{via}-pk{km}-{slug}`). | `data-integrity.spec.ts` |

## RNF-05 · Seguridad de API

| ID | Requisito | Test |
| :--- | :--- | :--- |
| RNF-05.1 | Todos los endpoints validan el cuerpo y la query con esquemas Zod `strict`. Coordenadas dentro del bbox de España (lat 27–44,5, lon −18,5–4,5). Las entradas inválidas devuelven **422**. | `api.spec.ts` |
| RNF-05.2 | Crear una parada no exige credenciales, pero la parada queda como `COMMUNITY_PENDING` y **no entra en el ranking**. El `id` lo genera el servidor; el cliente **no** puede enviar `ratingAvg`, `reviewCount` ni `id`. | `api.spec.ts` |
| RNF-05.3 | Aprobar o listar paradas pendientes exige `Authorization: Bearer ${ADMIN_API_TOKEN}`, con comparación en tiempo constante. Sin token configurado, la administración queda deshabilitada (**503**). | `api.spec.ts` |
| RNF-05.4 | Límite de peticiones por IP: búsqueda 30/min, creación 5/h y geocodificación 20/min. Si se supera, **429** con `Retry-After`. | `api.spec.ts` |
| RNF-05.5 | Cabeceras: CSP, HSTS, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` y `frame-ancestors 'none'`; sin `X-Powered-By`. | `next.config.mjs` + prueba manual |
| RNF-05.6 | Cero vulnerabilidades críticas o altas en `npm audit --omit=dev`. | CI |

## RNF-06 · Corrección temporal y geométrica

| ID | Requisito | Test |
| :--- | :--- | :--- |
| RNF-06.1 | La petición incluye `timeZone` (IANA). Todos los cálculos de reloj usan `Intl.DateTimeFormat` con esa zona; **ningún** cálculo depende de la zona del servidor. | Suite completa con `TZ=UTC` y con `TZ=Pacific/Auckland` |
| RNF-06.2 | La proyección de una parada sobre la ruta usa proyección punto-segmento (no solo vértices). Una parada **anterior** al origen (en EN_ROUTE, la posición GPS) se excluye aunque esté a menos de 1 km. | `domain-spec.spec.ts` |
| RNF-06.3 | `corridorHash` incluye la ventana (redondeada a 5 min): dos ventanas distintas no comparten entrada de caché. | `domain-spec.spec.ts` |
| RNF-06.4 | Los tests de aceptación inyectan un `IRoutingPort` *fake* determinista (sin red, DNS ni timeouts). | `bdd-scenarios.spec.ts` |

## RNF-07 · Persistencia y coste

| ID | Requisito |
| :--- | :--- |
| RNF-07.1 | El repositorio persiste en disco (`data/store.json`, escritura atómica con archivo temporal y `rename`). Sobrevive a reinicios. Interfaz preparada para migrar a Postgres/PostGIS (fuera del alcance de esta iteración: requiere infraestructura). |
| RNF-07.2 | El contador de cuota de Google es persistente, va por mes natural (`YYYY-MM`) y se reinicia solo al cambiar de mes. |
| RNF-07.3 | Las URL de OSRM, Overpass y Nominatim se configuran por entorno. Nominatim: máx. 1 req/s, `User-Agent` con contacto (`NOMINATIM_CONTACT_EMAIL`) y caché de respuestas. Se incluye `docker-compose.osrm.yml` para autoalojar OSRM. |

## RNF-08 · Frontend robusto y accesible

| ID | Requisito |
| :--- | :--- |
| RNF-08.1 | Las búsquedas usan *debounce* (≥ 350 ms) y `AbortController`: una respuesta obsoleta nunca pisa a una más reciente. |
| RNF-08.2 | Estados explícitos: carga (*skeleton*), error (mensaje + reintentar), vacío y sin conexión. |
| RNF-08.3 | El mapa (`maplibre-gl`) se carga con `next/dynamic` y `ssr: false`. Los marcadores no se recrean al cambiar la selección. |
| RNF-08.4 | WCAG 2.1 AA: todos los inputs con `<label htmlFor>`, sin elementos clicables no semánticos, modal con `role="dialog"` + foco atrapado + `Esc`, contraste ≥ 4,5:1 y `aria-pressed` en los *toggles*. |
| RNF-08.5 | Modo En Ruta: objetivos táctiles ≥ 48×48 px y aviso de seguridad vial (*"El copiloto debe manejar la app"*). |
| RNF-08.6 | Origen y destino libres, con autocompletado contra `/api/geocode` (corrige el bug de origen = Madrid). |
| RNF-08.7 | ESLint (`next/core-web-vitals`, `jsx-a11y`) sin errores en CI. |
