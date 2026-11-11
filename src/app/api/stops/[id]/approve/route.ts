import { NextRequest, NextResponse } from 'next/server';
import { getContainer } from '@/infrastructure/container';
import { verifyAdminBearerToken } from '@/infrastructure/security/admin-auth';

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = verifyAdminBearerToken(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { id } = await context.params;
  if (!id || id.trim().length === 0) {
    return NextResponse.json({ error: 'ID de parada requerido.' }, { status: 400 });
  }

  const { stopRepository } = getContainer();
  const approved = await stopRepository.approvePending(id);
  if (!approved) {
    return NextResponse.json(
      { error: 'Parada pendiente no encontrada.' },
      { status: 404 }
    );
  }

  return NextResponse.json({ stop: approved }, { status: 200 });
}
