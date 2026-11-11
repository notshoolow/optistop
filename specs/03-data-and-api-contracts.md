# 03. Contratos de Datos, Arquitectura Hexagonal y APIs

**Proyecto:** OptiStop  
**Arquitectura:** Hexagonal (Ports & Adapters) + Patrón *Cache-First Read-Through*  
**Stack de Datos:** Base de Datos Propia (SQLite/JSON Persistente / PostGIS-ready) + Open Data (`OSRM`, `Nominatim`, `Overpass API`) + Adaptador Opcional `GooglePlacesAdapter` con *Quota Guard* (< 900 req/mes gratis).

---

## 1. Modelo de Dominio Principal (TypeScript Contracts)

```typescript
export type StopCategory =
  | 'RESTAURANT'        // Restaurante de carretera / asador / venta tradicional
  | 'CAFE_BAKERY'       // Cafetería / obrador / parada rápida desayuno-merienda
  | 'SERVICE_AREA'      // Área de servicio integral (restauración + estación)
  | 'REST_AREA_PICNIC'; // Área de descanso destacada con servicios

export type AccessType =
  | 'DIRECT_SERVICE_AREA'         // Acceso directo en la propia vía
  | 'HIGHWAY_EXIT_EASY'           // Salida inmediata (< 800m en rotonda)
  | 'OPPOSITE_DIRECTION_OVERPASS' // Cambio de sentido por paso elevado
  | 'TOWN_ENTRY';                 // Entrada a población cercana

export type PriceLevel = 1 | 2 | 3; // 1 = €, 2 = €€, 3 = €€€

export interface StopAmenities {
  hasEvChargerNearby: boolean;     // Cargador EV en el mismo área o < 300m
  evChargerDetails?: string;       // Ej. "4x 150kW CCS2"
  hasGasStationOnsite: boolean;    // Gasolinera en la misma área de servicio
  gasStationBrand?: string;        // Ej. "Repsol / Cepsa / Plenoil"
  hasEasyParking: boolean;         // Parking amplio y fácil acceso
  hasCleanRestrooms: boolean;      // Baños bien valorados
  isPetFriendly: boolean;          // Terraza o zona habilitada para mascotas
  hasKidsArea: boolean;            // Zona infantil / parque
  hasTruckParking: boolean;        // Aparcamiento apto para caravanas/camiones
  hasWifi: boolean;
}

export interface RoadStopEntity {
  id: string;
  name: string;
  category: StopCategory;
  highwayCode: string;             // Ej. "A-1", "A-2", "A-3", "A-4", "A-5", "A-6", "AP-7"
  kmMarker: number;                // Punto kilométrico aproximado (ej. PK 103)
  locality: string;                // Municipio / Provincia
  coordinates: {
    lat: number;
    lon: number;
  };
  accessType: AccessType;
  directionNotes: string;          // Ej. "Salida 103 ambos sentidos por paso superior"
  ratingAvg: number;               // 1.0 a 5.0
  reviewCount: number;             // Volumen de reseñas
  priceLevel: PriceLevel;          // 1 (€), 2 (€€), 3 (€€€)
  specialty: string;               // Ej. "Torreznos a la brasa y menú casero"
  avgStopDurationMin: number;      // Tiempo medio de estancia (ej. 20 min café, 45 min comida)
  openingHours: string;            // Ej. "06:00 - 23:30" o "24h"
  amenities: StopAmenities;
  source: 'CURATED_DB' | 'OSM_ENRICHED' | 'GOOGLE_CACHED' | 'COMMUNITY';
  cachedAtIso?: string;            // Timestamp de última sincronización en caché
}
```

---

## 2. Puertos y Adaptadores (Arquitectura Hexagonal)

El núcleo de negocio (`OptiStopEngine`) **no conoce ningún proveedor externo**. Se comunica exclusivamente a través de 3 puertos (interfaces):

```typescript
export interface CorridorBoundingBox {
  corridorHash: string; // Identificador único del tramo (ej. "grid:40.1,-3.2:39.8,-2.5")
  polyline: Array<{ lat: number; lon: number; cumulativeMinutes: number; cumulativeKm: number }>;
  maxRadiusKm: number;
}

/**
 * PUERTO 1: Motor de Rutas y Geometría Vial (100% Gratuito siempre)
 */
export interface IRoutingPort {
  computeRoute(origin: { lat: number; lon: number }, destination: { lat: number; lon: number }): Promise<{
    totalDurationMinutes: number;
    totalDistanceKm: number;
    polyline: Array<{ lat: number; lon: number; cumulativeMinutes: number; cumulativeKm: number }>;
  }>;

  estimateRoundTripDetourMinutes(
    corridorPointPre: { lat: number; lon: number },
    stopCoord: { lat: number; lon: number },
    corridorPointPost: { lat: number; lon: number },
    accessType: AccessType
  ): Promise<{ detourMinutes: number; detourDistanceKm: number }>;
}

/**
 * PUERTO 2: Repositorio Propio Cache-First (Activo del Negocio)
 */
export interface IStopCacheRepositoryPort {
  findStopsInCorridor(corridor: CorridorBoundingBox): Promise<RoadStopEntity[]>;
  saveOrUpdateStops(stops: RoadStopEntity[], corridorHash: string): Promise<void>;
  hasFreshCorridorCoverage(corridorHash: string): Promise<boolean>;
}

/**
 * PUERTO 3: Proveedores Externos de Descubrimiento (Conmutables por Presupuesto)
 */
export interface IExternalStopProviderPort {
  readonly providerName: 'OVERPASS_OSM' | 'GOOGLE_PLACES_QUOTA_GUARDED';
  discoverStopsInCorridor(corridor: CorridorBoundingBox): Promise<RoadStopEntity[]>;
}
```

### Flujo "Read-Through Cache" en el Caso de Uso (`FindOptimalStopsUseCase`)
1. Se calcula la ruta con `OSRMRoutingAdapter` ($0€) y se recorta la polilínea de la **Ventana de Parada** (`CorridorSlicer`).
2. Se consulta `CuratedAndCachedStopRepository.findStopsInCorridor(corridor)` ($0€).
3. **Si el tramo ya tiene cobertura suficiente ($\ge 4$ candidatos verificados):** Se puntúan y devuelven directamente en $< 30\text{ ms}$ sin llamar a APIs externas.
4. **Si el tramo es nuevo o tiene baja cobertura:**
   - Se invoca `OverpassOsmAdapter` (gratis) para extraer áreas de servicio, restaurantes, gasolineras y cargadores EV del tramo.
   - Si está habilitado `GooglePlacesQuotaGuardedAdapter` y el contador mensual está bajo el umbral gratuito ($< 900\text{ llamadas/mes}$), se enriquecen notas y reseñas.
   - Los nuevos establecimientos descubiertos **se guardan en la Base de Datos Propia** (`saveOrUpdateStops`) para que futuras consultas en esa misma carretera sean instantáneas y gratuitas.

---

## 3. Contrato de Respuesta (`EvaluatedOptimalStop`) y Endpoint REST

### `POST /api/routes/optimal-stops`

Devuelve:
- `routeSummary`: Distancia total, duración total, polilínea completa y sub-polilínea del tramo de la ventana activa.
- `windowInfo`: Minuto inicial/final, kilómetro inicial/final y hora estimada de paso por la ventana.
- `cacheHit`: Booleano y desglose de fuentes (`CURATED_DB`, `OSM_ENRICHED`, `GOOGLE_CACHED`) para trazabilidad de costes.
- `optimalStops`: Lista del **Top 3–5** de `EvaluatedOptimalStop` con `routeMetrics`, `scoring` y `navigationLinks` (Google Maps, Waze, Apple Maps).
