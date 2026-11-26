import {build, defineConfig, type Plugin} from 'vite';
import react from '@vitejs/plugin-react';
import {liveBridge} from './server/live-bridge';
// The opaque-origin Pine worker takes a standalone bundle in development too.
function livePineDevBundle(): Plugin {
  return {name: 'live-pine-dev-bundle', apply: 'serve', configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      if (req.url?.split('?')[0] !== server.config.base + 'live-pine-worker.js') return next();
      try {
        const output = await build({configFile: false, publicDir: false, logLevel: 'silent',
          build: {write: false, target: 'es2022', lib: {entry: 'src/lib/pine.worker.ts', formats: ['iife'], name: 'XauLivePine', fileName: 'pine'}}});
        const chunks = (Array.isArray(output) ? output[0] : output);
        if (!('output' in chunks) || chunks.output[0].type !== 'chunk') throw Error('Missing Pine bundle');
        res.setHeader('Content-Type', 'text/javascript');
        res.end(chunks.output[0].code);
      } catch (error) { next(error); }
    });
  }};
}
export default defineConfig({
  base: '/XAUUSDreplay/',
  plugins: [react(), liveBridge(), livePineDevBundle()],
  worker: {format: 'iife'},
  build: {target: 'es2022', sourcemap: false},
  server: {host: '127.0.0.1', port: 5199},
});
