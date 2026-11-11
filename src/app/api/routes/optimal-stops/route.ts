import { NextRequest, NextResponse } from 'next/server';
import { FindOptimalStopsUseCase } from '@/application/use-cases/find-optimal-stops.use-case';
import { getContainer } from '@/infrastructure/container';
import { extractClientIp } from '@/infrastructure/security/rate-limiter';
import { OptimalStopsRequestSchema } from '@/infrastructure/validation/schemas';

export async function POST(req: NextRequest) {
  const {
    stopRepository,
    routingAdapter,
    overpassAdapter,
    googleAdapter,
    rateLimiter,
  } = getContainer();

  // RNF-05.4: Límite de 30 búsquedas por minuto por IP
  const ip = extractClientIp(req);
  const rl = rateLimiter.check(`search:${ip}`, 30, 60_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Demasiadas búsquedas desde esta IP. Inténtelo en unos segundos.' },
      {
        status: 429,
        headers: { 'Retry-After': String(rl.retryAfterSeconds) },
      }
    );
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json(
      { error: 'Cuerpo JSON mal formado.' },
      { status: 400 }
    );
  }

  // RNF-05.1: Validación estricta con Zod
  const parsed = OptimalStopsRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'Parámetros de búsqueda inválidos.',
        details: parsed.error.flatten(),
      },
      { status: 422 }
    );
  }

  try {
    const useCase = new FindOptimalStopsUseCase(
      routingAdapter,
      stopRepository,
      [overpassAdapter, googleAdapter],
      () => googleAdapter.getRemainingMonthlyQuota()
    );

    const response = await useCase.execute(parsed.data);
    return NextResponse.json(response, { status: 200 });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Error procesando ruta y paradas.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
