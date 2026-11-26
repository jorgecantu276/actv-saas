import type { NextConfig } from "next";
import { wordpressOrigin } from './lib/wordpress-origin';

const verificationBrowserId = process.env.ACTV_VERIFY_BROWSER_ID;
if (verificationBrowserId && !/^[a-f0-9]{32}$/.test(verificationBrowserId)) {
  throw new Error('Invalid isolated browser verification identity');
}
const nextConfig: NextConfig = {
  output: 'standalone',
  ...(verificationBrowserId ? {
    distDir: `.next/actv-browser-${verificationBrowserId}`,
    typescript: { tsconfigPath: `.next/actv-browser-${verificationBrowserId}/tsconfig.json` },
  } : {}),
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
