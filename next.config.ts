import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone',
  typescript: {
    // !! ADVERTENCIA !!
    // Esto permite que el build termine incluso si hay errores de tipos.
    ignoreBuildErrors: true,
  },
  eslint: {
    // También ignoramos avisos estéticos de ESLint para mayor velocidad
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;