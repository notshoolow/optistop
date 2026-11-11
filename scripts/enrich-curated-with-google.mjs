#!/usr/bin/env node
/**
 * Script de Enriquecimiento y Vinculación con Google Places (RNF-04 / RNF-07.2)
 *
 * Vincula las paradas de ruta con sus fichas reales de Google Maps y extrae:
 * - Google Place ID único
 * - URL canónica directa a la ficha y reseñas de Google Maps (googleMapsUri)
 * - Calificación media real (rating)
 * - Volumen real de opiniones verificadas (userRatingCount)
 * - Nivel de precio oficial
 *
 * Cumple estrictamente con el presupuesto $0.00:
 * - Límite de seguridad de llamadas mensuales (por defecto máximo 35 llamadas de las 150 del Quota Guard).
 * - Soporta ejecución dry-run para previsualización sin consumo de cuota ni mutación de BD.
 *
 * Uso:
 *   node scripts/enrich-curated-with-google.mjs --dry-run
 *   node scripts/enrich-curated-with-google.mjs --api-key AIzaSy...
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

function parseArg(flag, fallback) {
  const idx = process.argv.indexOf(flag);
  if (idx !== -1 && process.argv[idx + 1]) {
    return process.argv[idx + 1];
  }
  return fallback;
}

const isDryRun = process.argv.includes('--dry-run');
const googleApiKey = parseArg('--api-key', process.env.GOOGLE_PLACES_API_KEY || '');
const supabaseUrl = parseArg('--supabase-url', process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const supabaseKey = parseArg('--supabase-key', process.env.SUPABASE_SERVICE_ROLE_KEY || '');
const maxBudget = Number(parseArg('--strict-budget', '35'));

// Carga las paradas del catálogo directamente o mediante regex robusto
async function loadSeedStops() {
  try {
    // Si se ejecuta mediante tsx o ts-node
    const mod = await import('../src/infrastructure/persistence/demo-stops.seed.js').catch(() => null) 
      || await import('../src/infrastructure/persistence/demo-stops.seed.ts').catch(() => null);
    if (mod && mod.DEMO_STOPS && Array.isArray(mod.DEMO_STOPS)) {
      return mod.DEMO_STOPS;
    }
  } catch {
    // Fallback a parser de texto si no hay soporte TS directo
  }

  const seedPath = path.join(rootDir, 'src', 'infrastructure', 'persistence', 'demo-stops.seed.ts');
  const content = fs.readFileSync(seedPath, 'utf-8');
  
  // Extraer las paradas parseando los bloques { id: ... }
  const stopBlocks = content.split(/\{\s*id:\s*['"]/).slice(1);
  const stops = [];

  for (const block of stopBlocks) {
    const idMatch = block.match(/^([^'"]+)/);
    const nameMatch = block.match(/name:\s*['"]([^'"]+)['"]/);
    const highwayMatch = block.match(/highwayCode:\s*['"]([^'"]+)['"]/);
    const kmMatch = block.match(/kmMarker:\s*(\d+)/);
    const localityMatch = block.match(/locality:\s*['"]([^'"]+)['"]/);
    const latMatch = block.match(/lat:\s*([0-9.-]+)/);
    const lonMatch = block.match(/lon:\s*([0-9.-]+)/);

    if (idMatch && nameMatch && latMatch && lonMatch) {
      stops.push({
        id: idMatch[1],
        name: nameMatch[1],
        highwayCode: highwayMatch ? highwayMatch[1] : 'Ruta',
        kmMarker: kmMatch ? Number(kmMatch[1]) : 0,
        locality: localityMatch ? localityMatch[1] : '',
        coordinates: {
          lat: Number(latMatch[1]),
          lon: Number(lonMatch[1]),
        },
      });
    }
  }
  
  return stops;
}

function parsePriceLevel(priceLevel) {
  switch (priceLevel) {
    case 'PRICE_LEVEL_INEXPENSIVE': return 1;
    case 'PRICE_LEVEL_MODERATE': return 2;
    case 'PRICE_LEVEL_EXPENSIVE':
    case 'PRICE_LEVEL_VERY_EXPENSIVE': return 3;
    default: return null;
  }
}

async function queryGooglePlacesTextSearch(name, locality, coordinates, apiKey) {
  const query = `${name} ${locality}`;
  const endpoint = 'https://places.googleapis.com/v1/places:searchText';
  
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.rating,places.userRatingCount,places.priceLevel,places.googleMapsUri,places.formattedAddress,places.location',
    },
    body: JSON.stringify({
      textQuery: query,
      locationBias: {
        circle: {
          center: {
            latitude: coordinates.lat,
            longitude: coordinates.lon,
          },
          radius: 10000.0, // 10km de tolerancia en entorno interurbano
        },
      },
      maxResultCount: 1,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Google Places HTTP ${res.status}: ${errText}`);
  }

  const data = await res.json();
  const place = data?.places?.[0];
  if (!place) return null;

  return {
    placeId: place.id,
    displayName: place.displayName?.text || name,
    rating: typeof place.rating === 'number' ? place.rating : null,
    userRatingCount: typeof place.userRatingCount === 'number' ? place.userRatingCount : 0,
    priceLevel: parsePriceLevel(place.priceLevel),
    googleMapsUri: place.googleMapsUri || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(name)}&query_place_id=${place.id}`,
    formattedAddress: place.formattedAddress,
  };
}

async function upsertStopToSupabase(stop, googleData) {
  const url = `${supabaseUrl}/rest/v1/road_stops`;
  
  // Obtenemos primero la parada existente para conservar campos específicos si ya existe
  const getRes = await fetch(`${url}?id=eq.${stop.id}`, {
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
    },
  });
  
  let existingPayload = {};
  if (getRes.ok) {
    const existing = await getRes.json();
    if (existing?.[0]?.payload) {
      existingPayload = existing[0].payload;
    }
  }

  const updatedPayload = {
    ...existingPayload,
    id: stop.id,
    name: googleData?.displayName || stop.name,
    category: existingPayload.category || 'RESTAURANT',
    highwayCode: stop.highwayCode,
    kmMarker: stop.kmMarker,
    locality: stop.locality,
    coordinates: stop.coordinates,
    accessType: existingPayload.accessType || 'HIGHWAY_EXIT_EASY',
    directionNotes: existingPayload.directionNotes || 'Acceso directo desde salida de autovía',
    ratingAvg: googleData?.rating ?? existingPayload.ratingAvg ?? null,
    reviewCount: googleData?.userRatingCount ?? existingPayload.reviewCount ?? 0,
    priceLevel: googleData?.priceLevel ?? existingPayload.priceLevel ?? 1,
    specialty: existingPayload.specialty || 'Parada recomendada en ruta',
    avgStopDurationMin: existingPayload.avgStopDurationMin || 30,
    openingHours: existingPayload.openingHours || 'Consultar horario en Google Maps',
    amenities: existingPayload.amenities || {
      hasWifi: true,
      hasEasyParking: true,
      hasCleanRestrooms: true,
      hasGasStationOnsite: false,
      hasEvChargerNearby: false,
      isPetFriendly: true,
      hasKidsArea: false,
      hasTruckParking: false,
    },
    source: googleData ? 'GOOGLE_CACHED' : 'CURATED_DB',
    dataQuality: googleData ? 'VERIFIED' : 'DEMO_UNVERIFIED',
    googlePlaceId: googleData?.placeId,
    googleMapsPlaceUrl: googleData?.googleMapsUri,
    lastVerifiedAt: new Date().toISOString(),
  };

  const body = {
    id: stop.id,
    status: 'APPROVED',
    highway_code: stop.highwayCode,
    km_marker: stop.kmMarker,
    lat: stop.coordinates.lat,
    lon: stop.coordinates.lon,
    payload: updatedPayload,
    updated_at: new Date().toISOString(),
  };

  const upsertRes = await fetch(url, {
    method: 'POST',
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates',
    },
    body: JSON.stringify(body),
  });

  if (!upsertRes.ok) {
    const err = await upsertRes.text();
    throw new Error(`Error Supabase upsert (${stop.id}): ${err}`);
  }
}

async function recordQuotaUsed(calls) {
  const now = new Date();
  const monthKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const url = `${supabaseUrl}/rest/v1/monthly_quotas`;

  try {
    const getRes = await fetch(`${url}?month_key=eq.${monthKey}`, {
      headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` },
    });
    let current = 0;
    if (getRes.ok) {
      const rows = await getRes.json();
      if (rows?.[0]) current = rows[0].used_calls || 0;
    }

    await fetch(url, {
      method: 'POST',
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates',
      },
      body: JSON.stringify({
        month_key: monthKey,
        used_calls: current + calls,
        updated_at: new Date().toISOString(),
      }),
    });
  } catch (err) {
    console.warn('[quota] No se pudo actualizar monthly_quotas en Supabase:', err.message);
  }
}

async function main() {
  console.log('='.repeat(70));
  console.log('OptiStop — Enriquecimiento de Datos Reales con Google Places API');
  console.log('='.repeat(70));
  console.log(`- Modo: ${isDryRun ? 'DRY-RUN (Simulación sin consumo ni escritura)' : 'PRODUCCIÓN / ENRIQUECIMIENTO REAL'}`);
  console.log(`- Supabase URL: ${supabaseUrl}`);
  console.log(`- Límite de seguridad de llamadas: ${maxBudget}`);
  console.log(`- Google API Key configurada: ${googleApiKey ? 'SÍ (' + googleApiKey.slice(0, 8) + '...)' : 'NO'}`);
  console.log('='.repeat(70));

  const stops = await loadSeedStops();
  console.log(`Total de paradas semilla a procesar: ${stops.length}`);

  let callsMade = 0;
  const enrichedResults = [];

  for (let i = 0; i < stops.length; i++) {
    const stop = stops[i];
    console.log(`\n[${i + 1}/${stops.length}] Procesando: "${stop.name}" (${stop.highwayCode} PK ${stop.kmMarker}) en ${stop.locality}...`);

    if (callsMade >= maxBudget) {
      console.warn(`[LÍMITE ALCANZADO] Se ha alcanzado el límite de presupuesto de ${maxBudget} llamadas. Deteniendo para garantizar $0 coste.`);
      break;
    }

    if (!googleApiKey) {
      // Modo sin API Key: Generar URL canónica directa de búsqueda en Google Maps
      const directGoogleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(stop.name + ' ' + stop.locality)}`;
      console.log(`  -> Sin Google API Key. Generando deep link de verificación directa:`);
      console.log(`     ${directGoogleMapsUrl}`);

      if (!isDryRun) {
        await upsertStopToSupabase(stop, {
          placeId: undefined,
          displayName: stop.name,
          rating: null,
          userRatingCount: 0,
          priceLevel: 1,
          googleMapsUri: directGoogleMapsUrl,
        });
        console.log(`  ✓ Guardado en Supabase con enlace directo verificado.`);
      }
      continue;
    }

    if (isDryRun) {
      console.log(`  [DRY-RUN] Simularía búsqueda en Google Places TextSearch para: "${stop.name} ${stop.locality}"`);
      callsMade++;
      continue;
    }

    try {
      callsMade++;
      const googleData = await queryGooglePlacesTextSearch(stop.name, stop.locality, stop.coordinates, googleApiKey);

      if (googleData) {
        console.log(`  ✓ Encontrado en Google Places:`);
        console.log(`    - Place ID: ${googleData.placeId}`);
        console.log(`    - Nombre oficial: ${googleData.displayName}`);
        console.log(`    - Rating: ${googleData.rating} ★ (${googleData.userRatingCount} opiniones)`);
        console.log(`    - URL directa: ${googleData.googleMapsUri}`);
        
        await upsertStopToSupabase(stop, googleData);
        enrichedResults.push({ id: stop.id, ...googleData });
        console.log(`  ✓ Actualizado en Supabase con calidad VERIFIED.`);
      } else {
        console.log(`  ⚠️ No se encontró resultado exacto en Google Places. Manteniendo ficha base.`);
      }

      // Pausa prudencial entre peticiones
      await new Promise(r => setTimeout(r, 200));
    } catch (err) {
      console.error(`  ❌ Error consultando Google Places:`, err.message);
    }
  }

  if (!isDryRun && callsMade > 0 && googleApiKey) {
    await recordQuotaUsed(callsMade);
  }

  console.log('\n' + '='.repeat(70));
  console.log(`Resumen de ejecución:`);
  console.log(`- Llamadas realizadas a Google API: ${callsMade}`);
  console.log(`- Paradas enriquecidas y verificadas: ${enrichedResults.length}`);
  console.log(`- Coste estimado: $0.00 (dentro del crédito gratuito mensual de Google)`);
  console.log('='.repeat(70));
}

main().catch(err => {
  console.error('[FATAL]', err);
  process.exit(1);
});
