export const DEFAULT_TIME_ZONE = 'Europe/Madrid';

const formatterCache = new Map<string, Intl.DateTimeFormat>();

/**
 * RNF-06.1: Valida que la zona horaria sea un identificador IANA válido.
 * Lanza RangeError si no es reconocida por Intl.DateTimeFormat.
 */
export function assertValidTimeZone(timeZone: string): string {
  if (!timeZone || typeof timeZone !== 'string') {
    throw new RangeError('Zona horaria vacía o inválida');
  }
  const cached = formatterCache.get(timeZone);
  if (cached) return timeZone;

  // Intl.DateTimeFormat lanza RangeError si la zona IANA no existe
  const fmt = new Intl.DateTimeFormat('es-ES', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  formatterCache.set(timeZone, fmt);
  return timeZone;
}

function getClockFormatter(timeZone: string): Intl.DateTimeFormat {
  assertValidTimeZone(timeZone);
  return formatterCache.get(timeZone)!;
}

/**
 * Convierte "HH:MM" a minutos desde medianoche [0, 1439].
 */
export function parseClockToMinutesOfDay(hhmm: string): number {
  const match = /^(\d{2}):(\d{2})$/.exec(hhmm.trim());
  if (!match) return 0;
  const hh = Number(match[1]);
  const mm = Number(match[2]);
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return 0;
  return hh * 60 + mm;
}

/**
 * Obtiene los minutos desde medianoche de un Date en la zona IANA indicada,
 * sin depender nunca de la zona horaria del proceso de Node.js.
 */
export function getMinutesOfDayInTimeZone(
  date: Date,
  timeZone = DEFAULT_TIME_ZONE
): number {
  const fmt = getClockFormatter(timeZone);
  const parts = fmt.formatToParts(date);
  const hh = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const mm = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  return (hh % 24) * 60 + mm;
}

/**
 * Suma `minutesToAdd` a un instante ISO y devuelve "HH:MM" en la zona IANA indicada.
 */
export function addMinutesAsClock(
  iso: string,
  minutesToAdd: number,
  timeZone = DEFAULT_TIME_ZONE
): string {
  const fmt = getClockFormatter(timeZone);
  const base = new Date(iso);
  if (Number.isNaN(base.getTime())) {
    throw new RangeError(`Timestamp ISO inválido: ${iso}`);
  }
  const target = new Date(base.getTime() + Math.round(minutesToAdd) * 60_000);
  const parts = fmt.formatToParts(target);
  const hh = (parts.find((p) => p.type === 'hour')?.value ?? '00').padStart(2, '0');
  const mm = (parts.find((p) => p.type === 'minute')?.value ?? '00').padStart(2, '0');
  return `${hh === '24' ? '00' : hh}:${mm}`;
}
