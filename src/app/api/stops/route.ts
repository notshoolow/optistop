import { NextRequest, NextResponse } from 'next/server';
import { getContainer } from '@/infrastructure/container';
import { verifyAdminBearerToken } from '@/infrastructure/security/admin-auth';
import { extractClientIp } from '@/infrastructure/security/rate-limiter';
import { CommunityStopSubmissionSchema } from '@/infrastructure/validation/schemas';

/**
 * RNF-05.3: Listar paradas pendientes y aprobadas requiere token de administrador.
 */
export async function GET(req: NextRequest) {
  const auth = verifyAdminBearerToken(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { stopRepository } = getContainer();
  const [pending, approved] = await Promise.all([
    stopRepository.listPending(),
    stopRepository.getAllActiveStops(),
  ]);

  return NextResponse.json(
    {
      pendingCount: pending.length,
      approvedCount: approved.length,
      pending,
      approved,
    },
    { status: 200 }
  );
}

/**
 * RNF-05.2 y RNF-05.4: Propuesta comunitaria de nueva parada.
 * - Limitada a 5 envíos por hora por IP (429 con Retry-After).
 * - Rechaza cualquier intento de enviar `id`, `ratingAvg` o `reviewCount` (422).
 * - Se guarda con estado `COMMUNITY_PENDING` (202 Accepted) fuera del ranking hasta moderación.
 */
export async function POST(req: NextRequest) {
  const { stopRepository, rateLimiter } = getContainer();

  const ip = extractClientIp(req);
  const rl = rateLimiter.check(`stops:create:${ip}`, 5, 3600_000);
  if (!rl.allowed) {
    return NextResponse.json(
      {
        error:
          'Límite de propuestas alcanzado (máx. 5 por hora). Inténtelo más tarde.',
      },
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

  const parsed = CommunityStopSubmissionSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'Datos de parada inválidos o campos no permitidos.',
        details: parsed.error.flatten(),
      },
      { status: 422 }
    );
  }

  const pending = await stopRepository.submitCommunityStop(parsed.data);
  return NextResponse.json(
    {
      message:
        'Propuesta recibida en cola de moderación (COMMUNITY_PENDING). Entrará en el ranking tras ser verificada.',
      stop: pending,
    },
    { status: 202 }
  );
}
