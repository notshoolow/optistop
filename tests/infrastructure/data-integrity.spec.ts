import { describe, expect, it } from 'vitest';
import { DEMO_STOPS } from '@/infrastructure/persistence/demo-stops.seed';
import { OSRMRoutingAdapter } from '@/infrastructure/routing/osrm-routing.adapter';
import { mapOverpassElementsToStops } from '@/infrastructure/providers/overpass-osm.adapter';
import { sliceRouteByWindow } from '@/domain/geometry/corridor-slicer';
import { RouteVertex } from '@/domain/models/types';

describe('RNF-04 · Integridad y honestidad de datos', () => {
  it('RNF-04.1: el seed está etiquetado como DEMO_UNVERIFIED', () => {
    expect(DEMO_STOPS.length).toBeGreaterThan(10);
    for (const s of DEMO_STOPS) expect(s.dataQuality).toBe('DEMO_UNVERIFIED');
  });

  it('RNF-04.7: los IDs del seed son coherentes con la vía y el PK', () => {
    for (const s of DEMO_STOPS) {
      const normalizedHighway = s.highwayCode.toLowerCase().replace('-', '');
      expect(s.id.startsWith(`${normalizedHighway}-pk${s.kmMarker}-`)).toBe(true);
    }
    expect(new Set(DEMO_STOPS.map((s) => s.id)).size).toBe(DEMO_STOPS.length);
  });

  it('RNF-04.4: sin OSRM, una ruta de corredor conocido usa la geometría pregrabada, NO las paradas', async () => {
    const routing = new OSRMRoutingAdapter({ baseUrl: null });
    const r = await routing.computeRoute({ lat: 40.4168, lon: -3.7038 }, { lat: 39.4699, lon: -0.3763 });
    expect(r.provider).toBe('CORRIDOR_FIXTURE');
    expect(r.precision).toBe('HIGH');
    expect(r.totalDistanceKm).toBeGreaterThan(340);
    const stopKeys = new Set(DEMO_STOPS.map((s) => `${s.coordinates.lat},${s.coordinates.lon}`));
    for (const v of r.polyline) expect(stopKeys.has(`${v.lat},${v.lon}`)).toBe(false);
  });

  it('RNF-04.4: sin OSRM y fuera de corredores conocidos, línea recta con precisión LOW', async () => {
    const routing = new OSRMRoutingAdapter({ baseUrl: null });
    const r = await routing.computeRoute({ lat: 42.8782, lon: -8.5448 }, { lat: 43.3614, lon: -5.8494 }); // Santiago → Oviedo
    expect(r.provider).toBe('STRAIGHT_LINE');
    expect(r.precision).toBe('LOW');
  });

  it('RNF-04.2: el adaptador de OSM no inventa notas, precios ni servicios', () => {
    const poly: RouteVertex[] = [
      { lat: 40.0, lon: -3.0, cumulativeKm: 0, cumulativeMinutes: 0 },
      { lat: 40.0, lon: -2.9, cumulativeKm: 8.5, cumulativeMinutes: 5 },
    ];
    const corridor = sliceRouteByWindow(poly, 0, 5, 6);
    const stops = mapOverpassElementsToStops(
      [
        { id: 1, lat: 40.001, lon: -2.95, tags: { amenity: 'restaurant', name: 'Casa Pepe' } },
        { id: 2, lat: 40.0012, lon: -2.9502, tags: { amenity: 'charging_station', operator: 'Zunder' } },
      ],
      corridor
    );
    expect(stops).toHaveLength(1);
    const s = stops[0];
    expect(s.ratingAvg).toBeNull();
    expect(s.reviewCount).toBe(0);
    expect(s.priceLevel).toBeNull();
    expect(s.amenities.hasCleanRestrooms).toBeNull();
    expect(s.amenities.hasEasyParking).toBeNull();
    expect(s.amenities.hasEvChargerNearby).toBe(true); // dato real derivado de OSM
    expect(s.dataQuality).toBe('UNVERIFIED_OSM');
  });
});
