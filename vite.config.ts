/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * A Content-Security-Policy that the page carries itself.
 *
 * Needed because static hosting (GitHub Pages in particular) cannot set response
 * headers. Injected into the production build only: in dev, @vitejs/plugin-react
 * inserts an inline preamble for fast refresh, and `script-src 'self'` would block
 * it and break HMR.
 *
 * `connect-src` is deliberately wide: the batch check queries a Prometheus /
 * Alertmanager address the user types in. Only rule expressions and API paths ever
 * go out — never the routing tree or the pasted config. Narrow it back to 'self' if
 * you do not want those features.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self' https: http:",
  "font-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  // No `frame-ancestors` here: browsers ignore it in a <meta> element and log a
  // warning for it. It stays in nginx.conf, where it is delivered as a header and
  // actually takes effect.
].join('; ');

function cspMeta(): Plugin {
  return {
    name: 'csp-meta',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '<head>',
        `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`,
      );
    },
  };
}

export default defineConfig({
  plugins: [react(), cspMeta()],
  // Relative paths in the built index.html, so the static bundle can live in any
  // subdirectory — nginx, GitHub Pages under /repo-name/, or even file://.
  base: './',
  server: {
    port: 5180,
    host: '127.0.0.1',
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
  test: {
    setupFiles: ['./src/test-setup.ts'],
  },
});
