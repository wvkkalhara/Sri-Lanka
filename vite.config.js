import { defineConfig } from 'vite';
import { readFile } from 'node:fs/promises';

// Mapillary's street viewer compiles its image filter with new Function(), which this site's CSP (no 'unsafe-eval')
// forbids, so the viewer would not even start. We never filter images, so that one line becomes a plain function for
// the empty filter. Applied to the production build (rollup) and to the dev server's pre-bundling (esbuild).
const MLY_FIND = 'return new Function("node", "return " + this._compile(filter) + ";");';
const MLY_SAFE = 'if (filter == null || filter.length <= 1) return () => true; throw new Error("Mapillary filters are off on this site: its security policy forbids eval");';
function mapillaryNoEval() {
  return { name: 'mapillary-no-eval', enforce: 'pre', transform(code, id) { if (id.includes('mapillary-js') && code.includes(MLY_FIND)) return code.replace(MLY_FIND, MLY_SAFE); } };
}
const mapillaryNoEvalEsbuild = { name: 'mapillary-no-eval', setup(b) { b.onLoad({ filter: /mapillary-js[\/]dist[\/]mapillary\.module\.js$/ }, async (a) => ({ contents: (await readFile(a.path, 'utf8')).replace(MLY_FIND, MLY_SAFE), loader: 'js' })); } };

// Renders every place, region and answer into index.html at build (and dev) time,
// so the guide is complete without JavaScript and the first paint needs no script.
function staticGuide() {
  return {
    name: 'static-guide',
    async transformIndexHtml(html, ctx) {
      let mod, tmp;
      if (ctx?.server) mod = await ctx.server.ssrLoadModule('/src/render.js');
      else {
        const { createServer } = await import('vite');
        tmp = await createServer({ configFile: false, base: process.env.BASE_PATH || '/', server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'silent' });
        mod = await tmp.ssrLoadModule('/src/render.js');
      }
      let out = html.replace('<!--BODY-->', mod.renderBody());
      // the dev server injects CSS as <style> tags and its overlay uses innerHTML: relax CSP in dev only
      if (ctx?.server) out = out.replace("style-src 'self'", "style-src 'self' 'unsafe-inline'").replace(" require-trusted-types-for 'script'; trusted-types default", '');
      await tmp?.close();
      return out;
    },
  };
}

// BASE_PATH: where the site lives. "/" on Netlify or a custom domain; "/Sri-Lanka/" on GitHub Pages (set by the workflow).
export default defineConfig({
  base: process.env.BASE_PATH || '/',
  plugins: [staticGuide(), mapillaryNoEval()],
  optimizeDeps: { esbuildOptions: { plugins: [mapillaryNoEvalEsbuild] } },
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,               // no data: URIs: keeps the CSP strict
    modulePreload: { polyfill: false }, // the polyfill would be an inline script
    rollupOptions: { output: { manualChunks: { three: ['three'] } } },
  },
  server: { port: 5173 },
});
