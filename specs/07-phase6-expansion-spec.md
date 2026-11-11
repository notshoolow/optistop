# 07. Especificación de Fase 6: Escalado de Corredores, Seguimiento GPS Web, Panel de Moderación y Persistencia Cloud

**Proyecto:** OptiStop  
**Versión:** 1.0  
**Estado:** En Implementación  
**Metodología:** Spec-Driven Development (SDD)

---

## 1. Alcance de la Fase 6 (100% Web en Navegador, sin PWA)

Siguiendo la directriz de producto de operar **100% desde el navegador web** sin requerir instalación de PWA, esta especificación define los contratos funcionales y técnicos para los 4 bloques de evolución hacia producción:

1. **`RF-07` — Ampliación de Corredores Nacionales (`A-5`, `AP-7`) y Script CLI de Ingesta (`seed:corridor`):**
   - Incorporar geometrías reales OSRM y paradas curadas para los ejes de Extremadura (`A-5` Madrid → Badajoz) y Corredor Mediterráneo (`AP-7` Barcelona → Valencia).
   - Proveer una herramienta CLI (`scripts/seed-corridor.ts`) para poblar y enriquecer tramos bajo demanda.
2. **`RF-08` — Seguimiento GPS Continuo en Navegador (`watchPosition`) para Modo *En Ruta*:**
   - Permitir seguimiento en vivo de la posición del vehículo desde el navegador móvil mediante `navigator.geolocation.watchPosition`, con control de distancia mínima recorrida ($\ge 1.5\text{ km}$) antes de recalcular paradas para ahorrar batería y datos móviles.
3. **`RF-09` — Panel Web de Moderación de Paradas (`/admin`):**
   - Interfaz web en `/admin` y extensión de contratos API (`GET /api/stops?status=ALL` con `x-admin-token` y `DELETE /api/stops/[id]`) para revisar, aprobar (`APPROVED`) o descartar sugerencias enviadas por usuarios (`PENDING_REVIEW`).
4. **`RNF-09` — Adaptador de Persistencia Cloud-Ready (`SupabaseStopRepository`) y Esquema SQL:**
   - Implementación de `IStopCacheRepositoryPort` sobre PostgREST/Supabase (tier gratuito) con conmutación automática en `src/infrastructure/container.ts` (usa `SupabaseStopRepository` si existen `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY`, o `FileStopRepository` en caso contrario).

---

## 2. Contratos de Dominio y API (`RF-07`, `RF-08`, `RF-09`, `RNF-09`)

### 2.1 Extensión de `IStopCacheRepositoryPort` (`src/domain/models/ports.ts`)
Para soportar el flujo completo de moderación en `/admin`, el puerto añade:
- `findByModerationStatus(status: 'PENDING_REVIEW' | 'APPROVED' | 'ALL'): Promise<RoadStopEntity[]>`
- `deleteStop(id: string): Promise<boolean>`

### 2.2 Endpoints de Moderación (`/api/stops` y `/api/stops/[id]/approve`)
- **`GET /api/stops?status=PENDING_REVIEW|APPROVED|ALL`**:
  - Sin cabecera `x-admin-token` válida: ignora `status` y devuelve **exclusivamente** paradas `APPROVED` (cumpliendo `RNF-04.5`).
  - Con cabecera `x-admin-token` válida (verificada con `isValidAdminToken` en tiempo constante): devuelve las paradas filtradas por el `status` solicitado.
- **`DELETE /api/stops/[id]`**:
  - Requiere cabecera `x-admin-token` válida.
  - Elimina una parada sugerida rechazada por el moderador. Devuelve `200 OK` o `404 Not Found`.

### 2.3 Seguimiento GPS Continuo en Navegador (`RF-08`)
- En `src/app/page.tsx` (Modo `EN_ROUTE`):
  - El usuario puede activar/desactivar **"GPS en vivo"** (`watchPosition`).
  - Solo dispara un nuevo cálculo de paradas cuando la posición del vehículo se ha desplazado al menos $1.5\text{ km}$ respecto a la última posición evaluada (calculado mediante distancia Haversine), evitando peticiones redundantes en semáforos o retenciones.
  - Limpia automáticamente el `watchId` (`navigator.geolocation.clearWatch`) al salir del modo `EN_ROUTE` o desmontar el componente.

---

## 3. Criterios de Aceptación y Verificación (Test Gates)

1. **`tests/api/admin-moderation.spec.ts`:**
   - Verifica que `GET /api/stops?status=PENDING_REVIEW` sin token NO filtra paradas pendientes, pero con `x-admin-token` válido sí las devuelve.
   - Verifica el ciclo completo: envío comunitario (`PENDING_REVIEW`) $\to$ listado admin $\to$ aprobación (`POST /api/stops/[id]/approve`) o rechazo (`DELETE /api/stops/[id]`).
2. **`tests/infrastructure/supabase-repository.spec.ts`:**
   - Verifica que `SupabaseStopRepository` cumple el contrato `IStopCacheRepositoryPort` y que el contenedor de inyección selecciona el adaptador adecuado según las variables de entorno.
3. **`tests/infrastructure/data-integrity.spec.ts`:**
   - Verifica que todos los corredores (`A-1`, `A-2`, `A-3`, `A-4`, `A-5`, `A-6`, `AP-7`) cuentan con polilíneas reales y paradas curadas cercanas a la vía ($< 5\text{ km}$).
