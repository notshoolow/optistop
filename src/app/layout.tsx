import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'OptiStop — Encuentra las Paradas Más Óptimas en Carretera',
  description:
    'Planifica o encuentra en ruta los mejores restaurantes, áreas de servicio y cafeterías con mínimo desvío, valoración ponderada y servicios EV/gasolinera.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <body className="min-h-screen antialiased bg-[#f4f1ea] text-[#181816] selection:bg-[#165b40]/15 selection:text-[#165b40]">
        {children}
      </body>
    </html>
  );
}
