import { Coordinates, NavigationLinks } from '../models/types';

/**
 * Genera la URL directa a la ficha y reseñas de Google Maps del establecimiento.
 */
export function buildGoogleReviewsUrl(
  stopCoord: Coordinates,
  stopName: string,
  googlePlaceId?: string,
  googleMapsPlaceUrl?: string,
  locality?: string
): string {
  if (googleMapsPlaceUrl) return googleMapsPlaceUrl;
  if (googlePlaceId) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
      stopName
    )}&query_place_id=${googlePlaceId}`;
  }
  const cleanLocality = locality ? locality.replace(/\s*\([^)]*\)/, '').trim() : '';
  const query = cleanLocality ? `${stopName}, ${cleanLocality}` : stopName;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

/**
 * Genera enlaces profundos (Deep Links) con 1 toque para abrir la parada
 * en Google Maps (como parada en ruta hacia el destino o destino directo), Waze y Apple Maps.
 */
export function buildNavigationLinks(
  stopCoord: Coordinates,
  stopName: string,
  finalDestination?: Coordinates,
  googlePlaceId?: string,
  googleMapsPlaceUrl?: string
): NavigationLinks {
  const lat = stopCoord.lat.toFixed(5);
  const lon = stopCoord.lon.toFixed(5);
  const encodedQuery = encodeURIComponent(`${stopName} ${lat},${lon}`);

  const googleMapsUrl = finalDestination
    ? `https://www.google.com/maps/dir/?api=1&destination=${finalDestination.lat.toFixed(
        5
      )},${finalDestination.lon.toFixed(5)}&waypoints=${lat},${lon}&travelmode=driving`
    : googleMapsPlaceUrl ||
      (googlePlaceId
        ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
            stopName
          )}&query_place_id=${googlePlaceId}`
        : `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}&travelmode=driving`);

  const wazeUrl = `https://waze.com/ul?ll=${lat},${lon}&navigate=yes&q=${encodedQuery}`;
  const appleMapsUrl = `https://maps.apple.com/?daddr=${lat},${lon}&dirflg=d`;

  return {
    googleMapsUrl,
    wazeUrl,
    appleMapsUrl,
  };
}
