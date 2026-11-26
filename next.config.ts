import type { NextConfig } from "next";
import { wordpressOrigin } from './lib/wordpress-origin';

const nextConfig: NextConfig = {
  output: 'standalone',
  async redirects() {
    return [
      { source: '/tienda/cuenta', destination: wordpressOrigin + '/ajustes/orders/', permanent: false },
      { source: '/tienda/:path*', destination: wordpressOrigin + '/tienda/', permanent: false },
      { source: '/producto/:path*', destination: wordpressOrigin + '/producto/:path*', permanent: false },
      { source: '/carrito/:path*', destination: wordpressOrigin + '/carrito/:path*', permanent: false },
      { source: '/finalizar-compra/:path*', destination: wordpressOrigin + '/finalizar-compra/:path*', permanent: false },
    ];
  },
  images: {
    remotePatterns: [new URL('/wp-content/uploads/**', wordpressOrigin)],
  },
};

export default nextConfig;
