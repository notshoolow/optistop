import { NextRequest, NextResponse } from 'next/server';
import { getContainer } from '@/infrastructure/container';
import { verifyAdminBearerToken } from '@/infrastructure/security/admin-auth';

/**
 * RF-09: Rechazar/eliminar una parada pendiente de moderación.
 */
export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = verifyAdminBearerToken(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { id } = await context.params;
  if (!id || id.trim().length === 0) {
    return NextResponse.json(
      { error: 'ID de parada requerido.' },
      { status: 400 }
    );
  }

  const { stopRepository } = getContainer();
  const rejected = await stopRepository.rejectPending(id);
  if (!rejected) {
    return NextResponse.json(
      { error: 'Parada pendiente no encontrada.' },
      { status: 404 }
    );
  }

  return NextResponse.json({ deleted: true, id }, { status: 200 });
}
