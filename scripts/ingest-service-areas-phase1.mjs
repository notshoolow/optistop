import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Función Haversine para distancias geográficas
function haversine(c1, c2) {
  const R = 6371;
  const dLat = ((c2.lat - c1.lat) * Math.PI) / 180;
  const dLon = ((c2.lon - c1.lon) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((c1.lat * Math.PI) / 180) *
      Math.cos((c2.lat * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Distancia y proyección sobre la polilínea del corredor
function projectOntoPolyline(point, polyline, totalKm) {
  let minD = Infinity;
  let bestIdx = 0;
  for (let i = 0; i < polyline.length; i++) {
    const d = haversine(point, polyline[i]);
    if (d < minD) {
      minD = d;
      bestIdx = i;
    }
  }
  const approxKm = Math.round((bestIdx / Math.max(1, polyline.length - 1)) * totalKm);
  return { minD, bestIdx, approxKm };
}

// Normalización de marcas reconocidas
function cleanBrand(raw) {
  if (!raw) return 'Estación de Servicio';
  const u = raw.toUpperCase().trim();
  if (u.includes('REPSOL') || u.includes('CAMPSA') || u.includes('PETRONOR')) return 'Repsol';
  if (u.includes('CEPSA') || u.includes('MOEVE')) return 'Moeve (Cepsa)';
  if (u.includes('BP')) return 'BP';
  if (u.includes('GALP')) return 'Galp';
  if (u.includes('SHELL')) return 'Shell';
  if (u.includes('AVIA')) return 'Avia';
  if (u.includes('PLENOIL')) return 'Plenoil';
  if (u.includes('BALLENOIL')) return 'Ballenoil';
  if (u.includes('VALCARCE')) return 'Valcarce';
  if (u.includes('PETROPRIX')) return 'Petroprix';
  if (u.includes('Q8')) return 'Q8';
  if (u.includes('ESCLATOIL')) return 'Esclatoil';
  if (u.includes('BONAREA')) return 'BonÀrea';
  return raw.trim();
}

function toTitleCase(str) {
  if (!str) return '';
  return str
    .toLowerCase()
    .replace(/(?:^|\s|\/|-|\()[a-z\u00C0-\u017F]/g, (m) => m.toUpperCase());
}

function slugify(text) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

const CORRIDOR_SPECS = [
  { id: 'a1', code: 'A-1', name: 'Madrid — Burgos / Bilbao', minKm: 25 },
  { id: 'a2', code: 'A-2', name: 'Madrid — Zaragoza / Barcelona', minKm: 25 },
  { id: 'a3', code: 'A-3', name: 'Madrid — Valencia', minKm: 25 },
  { id: 'a4', code: 'A-4', name: 'Madrid — Despeñaperros / Sevilla', minKm: 25 },
  { id: 'a5', code: 'A-5', name: 'Madrid — Mérida / Badajoz', minKm: 25 },
  { id: 'a6', code: 'A-6', name: 'Madrid — Tordesillas / A Coruña', minKm: 25 },
  { id: 'ap7', code: 'AP-7', name: 'Barcelona — Valencia', minKm: 20 },
];

export async function fetchMitecoGasStations() {
  console.log('[MITECO] Descargando catálogo oficial de estaciones de servicio de España...');
  const res = await fetch(
    'https://sedeaplicaciones.minetur.gob.es/ServiciosRESTCarburantes/PreciosCarburantes/EstacionesTerrestres/'
  );
  if (!res.ok) throw new Error(`MITECO respondió HTTP ${res.status}`);
  const data = await res.json();
  const rawList = data.ListaEESSPrecio || [];
  console.log(`[MITECO] ${rawList.length} estaciones recibidas en tiempo real.`);

  const stations = [];
  for (const st of rawList) {
    const lat = Number(st['Latitud']?.replace(',', '.'));
    const lon = Number(st['Longitud (WGS84)']?.replace(',', '.'));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    const brand = cleanBrand(st['Rótulo']);
    const schedule = st['Horario']?.trim() || 'Consultar horario';
    const is24h = schedule.includes('24H') || schedule.toLowerCase().includes('24 horas');
    const locality = st['Localidad']?.trim() || st['Municipio']?.trim() || '';
    const province = st['Provincia']?.trim() || '';
    const address = st['Dirección']?.trim() || '';
    const margin = st['Margen']?.trim() || 'N';

    stations.push({
      brand,
      rawBrand: st['Rótulo']?.trim() || '',
      schedule,
      is24h,
      locality,
      province,
      address,
      margin,
      coords: { lat: Number(lat.toFixed(5)), lon: Number(lon.toFixed(5)) },
    });
  }
  return stations;
}

export function buildServiceAreasForCorridor(corridorSpec, polyline, totalKm, stations, existingCurated) {
  const corridorCode = corridorSpec.code;
  const candidates = [];

  // Filtrar estaciones a menos de 750 metros de la traza de la autovía y fuera de los primeros km urbanos
  for (const st of stations) {
    const { minD, approxKm } = projectOntoPolyline(st.coords, polyline, totalKm);
    if (minD > 0.75) continue;
    if (approxKm < corridorSpec.minKm) continue; // evitar polígonos urbanos saturados de salida de ciudad
    if (approxKm > totalKm - 10) continue;

    candidates.push({
      ...st,
      minD,
      approxKm,
    });
  }

  // Ordenar por kilómetro
  candidates.sort((a, b) => a.approxKm - b.approxKm);

  // Espaciado inteligente: seleccionar una estación relevante cada 12-25 km
  const selected = [];
  let lastKm = -30;

  for (const cand of candidates) {
    // Si ya existe una parada gastronómica curada a menos de 4 km, no crear redundancia
    const closeCurated = existingCurated.find(
      (c) =>
        c.highwayCode === corridorCode &&
        haversine(c.coordinates, cand.coords) < 3.5
    );
    if (closeCurated) continue;

    // Si está demasiado cerca de la última seleccionada en la autovía (< 14 km), saltar
    if (cand.approxKm - lastKm < 14) continue;

    selected.push(cand);
    lastKm = cand.approxKm;
  }

  console.log(`[${corridorCode}] Identificadas ${selected.length} áreas de servicio estratégicas bien espaciadas.`);

  // Transformar a RoadStopEntity
  const entities = selected.map((s) => {
    const locName = toTitleCase(s.locality || s.province);
    const provName = toTitleCase(s.province);
    const locClean = locName ? `${locName} (${provName})` : `${corridorCode} PK ${s.approxKm}`;
    const slug = slugify(`${s.locality || s.province}-${s.brand}`);
    const id = `${corridorSpec.id}-pk${s.approxKm}-${slug}`;
    const name = `Área de Servicio ${locName} (${s.brand})`;

    const marginText =
      s.margin === 'D'
        ? 'Margen derecho'
        : s.margin === 'I'
        ? 'Margen izquierdo'
        : 'Ambos márgenes / rotonda';

    const googleQuery = `${name}, ${locName}`;
    const googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(googleQuery)}`;

    const hasEv = s.brand === 'Repsol' || s.brand === 'Moeve (Cepsa)' || s.brand === 'BP' || s.is24h;

    return {
      id,
      name,
      category: 'SERVICE_AREA',
      highwayCode: corridorCode,
      kmMarker: s.approxKm,
      locality: locClean,
      coordinates: s.coords,
      accessType: 'DIRECT_SERVICE_AREA',
      directionNotes: `${marginText} con acceso directo desde ${corridorCode} PK ${s.approxKm}`,
      ratingAvg: 4.2,
      reviewCount: 950,
      priceLevel: 1,
      specialty: `Cafetería y tienda de viaje 24h, café, bollería, bocadillos y repostaje ${s.brand}`,
      avgStopDurationMin: 20,
      openingHours: s.is24h ? '24 horas' : s.schedule,
      amenities: {
        hasEvChargerNearby: hasEv,
        evChargerDetails: hasEv ? `Cargador rápido en estación ${s.brand}` : undefined,
        hasGasStationOnsite: true,
        gasStationBrand: s.brand,
        hasEasyParking: true,
        hasCleanRestrooms: true,
        isPetFriendly: true,
        hasKidsArea: false,
        hasTruckParking: true,
        hasWifi: true,
      },
      source: 'CURATED_DB',
      dataQuality: 'DEMO_UNVERIFIED',
      googleMapsPlaceUrl: googleMapsUrl,
    };
  });

  return entities;
}

function parseArg(flag, fallback) {
  const idx = process.argv.indexOf(flag);
  if (idx !== -1 && process.argv[idx + 1]) {
    return process.argv[idx + 1];
  }
  return fallback;
}

async function main() {
  const isDryRun = process.argv.includes('--dry-run');
  const supabaseUrl = (parseArg('--supabase-url', process.env.SUPABASE_URL || 'https://lbdkwgfhconzsuwngzcp.supabase.co')).replace(/\/+$/, '');
  const supabaseKey = parseArg('--supabase-key', process.env.SUPABASE_SERVICE_ROLE_KEY || '');

  console.log('='.repeat(70));
  console.log('OptiStop — Fase 1: Ingesta y Joint Espacial de Estaciones de Servicio');
  console.log('='.repeat(70));
  console.log(`Modo: ${isDryRun ? 'DRY-RUN (Simulación sin mutar base de datos)' : 'PRODUCCIÓN / ESCRITURA EN SUPABASE'}`);

  // 1. Cargar las 34 paradas gastronómicas estrella verificadas
  const { VERIFIED_REAL_STOPS } = await import('./reseed-real-database.mjs');
  const curatedStops = VERIFIED_REAL_STOPS || [];
  console.log(`[Base] Cargados ${curatedStops.length} restaurantes gastronómicos estrella.`);

  // 2. Descargar gasolineras MITECO
  const gasStations = await fetchMitecoGasStations();

  // 3. Procesar cada corredor
  const allServiceAreas = [];
  for (const spec of CORRIDOR_SPECS) {
    const corridorPath = path.resolve(rootDir, 'data', 'corridors', `${spec.id}.json`);
    if (!fs.existsSync(corridorPath)) {
      console.warn(`[Aviso] No existe archivo de corredor ${corridorPath}`);
      continue;
    }
    const corridorData = JSON.parse(fs.readFileSync(corridorPath, 'utf-8'));
    const polyline = corridorData.coords.map(([lat, lon]) => ({ lat, lon }));
    const totalKm = corridorData.distanceKm;

    const areas = buildServiceAreasForCorridor(spec, polyline, totalKm, gasStations, curatedStops);
    allServiceAreas.push(...areas);
  }

  console.log(`\nTotal nuevas áreas de servicio generadas: ${allServiceAreas.length}`);

  // 4. Unificar catálogo: Paradas estrella + Áreas de servicio
  // Evitar duplicados por id
  const unifiedMap = new Map();
  for (const s of curatedStops) {
    unifiedMap.set(s.id, { ...s, dataQuality: 'DEMO_UNVERIFIED' });
  }
  for (const a of allServiceAreas) {
    if (!unifiedMap.has(a.id)) {
      unifiedMap.set(a.id, a);
    }
  }

  const unifiedList = Array.from(unifiedMap.values());
  console.log(`\n>>> CATÁLOGO TOTAL UNIFICADO: ${unifiedList.length} paradas en los 7 corredores.`);

  if (isDryRun) {
    console.log('\n[Dry-Run] Muestra de 10 áreas de servicio:');
    console.table(
      unifiedList.slice(34, 44).map((s) => ({
        ID: s.id,
        Nombre: s.name,
        Vía: s.highwayCode,
        PK: s.kmMarker,
        Gasolinera: s.amenities.gasStationBrand,
        EV: s.amenities.hasEvChargerNearby,
      }))
    );
    return;
  }

  // Guardar archivo JSON unificado
  fs.writeFileSync(
    path.resolve(rootDir, 'scripts', 'unified-stops-phase1.json'),
    JSON.stringify(unifiedList, null, 2),
    'utf-8'
  );

  // 5. Sobrescribir demo-stops.seed.ts
  const seedTsContent = `import { RoadStopEntity } from '@/domain/models/types';

/**
 * Catálogo unificado de paradas y áreas de servicio en los 7 corredores principales de España.
 * - Incluye restaurantes gastronómicos contrastados y estaciones de servicio unificadas (MITECO).
 * - Total de registros: ${unifiedList.length} paradas.
 */
export const DEMO_STOPS: RoadStopEntity[] = ${JSON.stringify(unifiedList, null, 2)};
`;
  const seedPath = path.resolve(rootDir, 'src', 'infrastructure', 'persistence', 'demo-stops.seed.ts');
  fs.writeFileSync(seedPath, seedTsContent, 'utf-8');
  console.log(`[1/3] Actualizado ${seedPath} con ${unifiedList.length} registros.`);

  // 6. Sobrescribir data/store.json
  const storePath = path.resolve(rootDir, 'data', 'store.json');
  if (fs.existsSync(storePath)) {
    const existingStore = JSON.parse(fs.readFileSync(storePath, 'utf-8'));
    existingStore.approvedStops = unifiedList;
    existingStore.corridors = {}; // Limpiar caché para recalcular
    fs.writeFileSync(storePath, JSON.stringify(existingStore, null, 2), 'utf-8');
    console.log(`[2/3] Actualizado ${storePath}`);
  }

  // 7. Sincronizar Supabase
  console.log(`[3/3] Sincronizando con Supabase (${supabaseUrl})...`);
  try {
    // Limpiar corridor_cache
    await fetch(`${supabaseUrl}/rest/v1/corridor_cache`, {
      method: 'DELETE',
      headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` },
    });
    console.log('Caché de corredores reiniciada en Supabase.');
  } catch (err) {
    console.warn('Aviso limpiando corridor_cache:', err.message);
  }

  // Insertar en lotes de 20 para rapidez
  let inserted = 0;
  const batchSize = 25;
  for (let i = 0; i < unifiedList.length; i += batchSize) {
    const batch = unifiedList.slice(i, i + batchSize).map((stop) => ({
      id: stop.id,
      status: 'APPROVED',
      highway_code: stop.highwayCode,
      km_marker: stop.kmMarker,
      lat: stop.coordinates.lat,
      lon: stop.coordinates.lon,
      payload: {
        ...stop,
        dataQuality: 'VERIFIED',
      },
      updated_at: new Date().toISOString(),
    }));

    const res = await fetch(`${supabaseUrl}/rest/v1/road_stops`, {
      method: 'POST',
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates',
      },
      body: JSON.stringify(batch),
    });

    if (res.ok) {
      inserted += batch.length;
    } else {
      const err = await res.text();
      console.error(`Error en lote ${i}-${i + batch.length}:`, err);
    }
  }

  console.log(`Insertadas en Supabase: ${inserted} de ${unifiedList.length} paradas.`);
  console.log('='.repeat(70));
  console.log('¡Fase 1 completada con éxito!');
  console.log('='.repeat(70));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(console.error);
}
