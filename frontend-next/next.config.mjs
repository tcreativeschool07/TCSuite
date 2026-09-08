// Mirrors the Vite dev proxy from the old frontend: '/api' and '/admin' are
// both forwarded to the Django backend so the Axios baseURL ('/api') in
// src/api/client.js does not change.
const BACKEND = process.env.BACKEND_URL || 'http://127.0.0.1:8000';

// Content Security Policy.
//
// React escapes every value it renders, and nothing in this app renders
// user-supplied HTML, so the realistic XSS risk is already low — this is
// defence in depth for the case where that stops being true.
//
// 'unsafe-inline' in script-src is a real weakening and is deliberate: Next's
// App Router emits inline hydration scripts (self.__next_f.push(...)) whose
// content changes every build, so neither a hash list nor a static nonce can
// cover them. Removing it means adopting per-request nonces via middleware,
// which would opt every statically prerendered page into dynamic rendering.
// The remaining directives still carry weight — they stop a third-party script
// origin, an injected <object>, a rewritten <base>, a form posting off-site,
// and any attempt to frame the app for clickjacking.
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  // Tailwind's generated stylesheet plus inline style attributes from
  // framer-motion's animated elements.
  "style-src 'self' 'unsafe-inline'",
  // next/font self-hosts the Google fonts at build time, so no external origin.
  "font-src 'self' data:",
  // data: for the inline SVG paper-grain tile; blob: for the object URLs the
  // PDF and workbook downloads create.
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  // The three.js login scene draws to a canvas; no worker or media is loaded.
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  'upgrade-insecure-requests',
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  // frame-ancestors covers modern browsers; this covers the rest.
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // The app asks for none of these; deny them rather than leave them open.
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()' },
  { key: 'X-DNS-Prefetch-Control', value: 'off' },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Django/DRF endpoints all end with a trailing slash. Without this flag,
  // Next 308-redirects '/api/accounts/login/' → '/api/accounts/login' before
  // the rewrite runs, and the slash-less path 404s on Django (POSTs can't be
  // APPEND_SLASH-redirected). Skip the normalization so the slash survives.
  skipTrailingSlashRedirect: true,

  // Don't advertise the framework to anyone fingerprinting the stack.
  poweredByHeader: false,

  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },

  async rewrites() {
    return [
      // Explicit trailing-slash variants first so ':path*' keeps the slash.
      { source: '/api/:path*/', destination: `${BACKEND}/api/:path*/` },
      { source: '/api/:path*', destination: `${BACKEND}/api/:path*` },
      { source: '/admin/:path*/', destination: `${BACKEND}/admin/:path*/` },
      { source: '/admin/:path*', destination: `${BACKEND}/admin/:path*` },
      // Django admin's own CSS/JS live under /static/ and are served by
      // WhiteNoise. Without this the admin renders unstyled behind the proxy,
      // because Next would try to resolve /static/admin/... in the app.
      { source: '/static/:path*', destination: `${BACKEND}/static/:path*` },
    ];
  },
};

export default nextConfig;
