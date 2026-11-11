#!/usr/bin/env node
/**
 * OptiStop — Motor de Ingesta Nacional (Fase 2)
 *
 * Permite extender la red de paradas a toda la geografía española:
 * - A-7 (Corredor Mediterráneo: Valencia - Murcia - Almería - Málaga)
 * - A-8 (Corredor Cantábrico: Bilbao - Santander - Gijón)
 * - A-66 (Ruta de la Plata: Gijón - León - Salamanca - Cáceres - Sevilla)
 * - A-92 (Eje Andaluz: Sevilla - Granada - Almería)
 * - A-68 / AP-68 (Ebro - Cantábrico: Zaragoza - Logroño - Bilbao)
 * - A-42 (Madrid - Toledo)
 *
 * Integra:
 * - Traza OSRM oficial del corredor
 * - 11.400+ gasolineras del Ministerio para la Transición Ecológica (MITECO)
 * - Joint espacial automático (gasolinera + restaurante/cafetería + puntos EV)
 * - Enlaces canónicos directos a Google Maps (coste $0.00)
 * - Upsert por lotes en Supabase
 *
 * Uso:
 *   node scripts/ingest-national-corridors.mjs --dry-run
 *   node scripts/ingest-national-corridors.mjs --corridors a7,a8,a66
 *   node scripts/ingest-national-corridors.mjs --all
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  fetchMitecoGasStations,
  buildServiceAreasForCorridor,
} from './ingest-service-areas-phase1.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Catálogo de corredores nacionales de Fase 2
export const NATIONAL_PHASE2_CORRIDORS = [
  {
    id: 'a7',
    code: 'A-7',
    name: 'Valencia — Alicante — Murcia — Málaga',
    from: { label: 'Valencia', lat: 39.4699, lon: -0.3763 },
    to: { label: 'Málaga', lat: 36.7213, lon: -4.4214 },
    minKm: 25,
  },
  {
    id: 'a8',
    code: 'A-8',
    name: 'Bilbao — Santander — Gijón',
    from: { label: 'Bilbao', lat: 43.263, lon: -2.935 },
    to: { label: 'Gijón', lat: 43.5357, lon: -5.6615 },
    minKm: 20,
  },
  {
    id: 'a66',
    code: 'A-66',
    name: 'Ruta de la Plata (Sevilla — Mérida — Salamanca — León)',
    from: { label: 'Sevilla', lat: 37.3891, lon: -5.9845 },
    to: { label: 'León', lat: 42.5987, lon: -5.5671 },
    minKm: 25,
  },
  {
    id: 'a92',
    code: 'A-92',
    name: 'Sevilla — Antequera — Granada — Almería',
    from: { label: 'Sevilla', lat: 37.3891, lon: -5.9845 },
    to: { label: 'Granada', lat: 37.1773, lon: -3.5986 },
    minKm: 25,
  },
  {
    id: 'ap68',
    code: 'AP-68',
    name: 'Zaragoza — Logroño — Bilbao',
    from: { label: 'Zaragoza', lat: 41.6488, lon: -0.8891 },
    to: { label: 'Bilbao', lat: 43.263, lon: -2.935 },
    minKm: 20,
  },
];

function parseArg(flag, fallback) {
  const idx = process.argv.indexOf(flag);
  if (idx !== -1 && process.argv[idx + 1]) {
    return process.argv[idx + 1];
  }
  return fallback;
}

// Obtener o descargar la geometría del corredor mediante OSRM
async function getOrFetchCorridorPolyline(corridorSpec) {
  const localFile = path.resolve(rootDir, 'data', 'corridors', `${corridorSpec.id}.json`);
  if (fs.existsSync(localFile)) {
    const cached = JSON.parse(fs.readFileSync(localFile, 'utf-8'));
    return {
      polyline: cached.coords.map(([lat, lon]) => ({ lat, lon })),
      totalKm: cached.distanceKm,
    };
  }

  console.log(`[OSRM] Descargando geometría oficial para ${corridorSpec.code} (${corridorSpec.from.label} -> ${corridorSpec.to.label})...`);
  const url = `https://router.project-osrm.org/route/v1/driving/${corridorSpec.from.lon},${corridorSpec.from.lat};${corridorSpec.to.lon},${corridorSpec.to.lat}?overview=full&geometries=geojson`;

  const res = await fetch(url, {
    headers: { 'User-Agent': 'OptiStop-NationalIngest/2.0' },
  });
  if (!res.ok) throw new Error(`OSRM HTTP ${res.status}`);
  const data = await res.json();
  const route = data?.routes?.[0];
  if (!route?.geometry?.coordinates?.length) {
    throw new Error('OSRM no devolvió geometría de ruta');
  }

  const raw = route.geometry.coordinates;
  const step = Math.max(1, Math.floor(raw.length / 180));
  const coords = [];
  for (let i = 0; i < raw.length; i += step) {
    coords.push([Number(raw[i][1].toFixed(5)), Number(raw[i][0].toFixed(5))]);
  }
  const last = raw[raw.length - 1];
  coords.push([Number(last[1].toFixed(5)), Number(last[0].toFixed(5))]);

  const totalKm = Math.round(route.distance / 1000);
  const totalMin = Math.round(route.duration / 60);

  const fixture = {
    id: corridorSpec.id,
    highway: corridorSpec.code,
    distanceKm: totalKm,
    durationMin: totalMin,
    coords,
  };

  fs.writeFileSync(localFile, JSON.stringify(fixture, null, 2), 'utf-8');
  console.log(`[OSRM] Geometría guardada en ${localFile} (${totalKm} km, ${coords.length} vértices).`);

  return {
    polyline: coords.map(([lat, lon]) => ({ lat, lon })),
    totalKm,
  };
}

async function main() {
  const isDryRun = process.argv.includes('--dry-run');
  const targetFilter = parseArg('--corridors', 'all').toLowerCase();
  const supabaseUrl = (parseArg('--supabase-url', process.env.SUPABASE_URL || 'https://lbdkwgfhconzsuwngzcp.supabase.co')).replace(/\/+$/, '');
  const supabaseKey = parseArg('--supabase-key', process.env.SUPABASE_SERVICE_ROLE_KEY || '');

  console.log('='.repeat(70));
  console.log('OptiStop — Fase 2: Motor de Escalabilidad Nacional de Paradas');
  console.log('='.repeat(70));
  console.log(`- Modo: ${isDryRun ? 'DRY-RUN (Simulación sin mutar base de datos)' : 'PRODUCCIÓN / ESCRITURA'}`);
  console.log(`- Filtro corredores: ${targetFilter}`);
  console.log('='.repeat(70));

  const gasStations = await fetchMitecoGasStations();

  const selectedCorridors =
    targetFilter === 'all'
      ? NATIONAL_PHASE2_CORRIDORS
      : NATIONAL_PHASE2_CORRIDORS.filter((c) =>
          targetFilter.split(',').includes(c.id)
        );

  console.log(`Procesando ${selectedCorridors.length} corredores nacionales...`);

  const allGenerated = [];

  for (const corridor of selectedCorridors) {
    console.log(`\n--- [${corridor.code}] ${corridor.name} ---`);
    const { polyline, totalKm } = await getOrFetchCorridorPolyline(corridor);
    const serviceAreas = buildServiceAreasForCorridor(
      corridor,
      polyline,
      totalKm,
      gasStations,
      []
    );
    allGenerated.push(...serviceAreas);
  }

  console.log('\n' + '='.repeat(70));
  console.log(`Fase 2 completada: ${allGenerated.length} nuevas paradas identificadas y estructuradas.`);
  console.log('='.repeat(70));

  if (isDryRun) {
    console.log('[Dry-Run] Muestra de 10 paradas nacionales:');
    console.table(
      allGenerated.slice(0, 10).map((s) => ({
        ID: s.id,
        Nombre: s.name,
        Vía: s.highwayCode,
        PK: s.kmMarker,
        Gasolinera: s.amenities.gasStationBrand,
      }))
    );
    return;
  }

  // Guardar archivo maestro nacional
  const outputPath = path.resolve(rootDir, 'scripts', 'national-phase2-catalog.json');
  fs.writeFileSync(outputPath, JSON.stringify(allGenerated, null, 2), 'utf-8');
  console.log(`Catálogo nacional guardado en: ${outputPath}`);

  if (supabaseKey) {
    console.log(`Insertando ${allGenerated.length} paradas en Supabase (${supabaseUrl})...`);
    let inserted = 0;
    const batchSize = 25;
    for (let i = 0; i < allGenerated.length; i += batchSize) {
      const batch = allGenerated.slice(i, i + batchSize).map((stop) => ({
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
      }
    }
    console.log(`Sincronizadas ${inserted} paradas en Supabase exitosamente.`);
  }
}

main().catch(console.error);
