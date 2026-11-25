import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {liveBridge} from './server/live-bridge';
export default defineConfig({
  base: '/XAUUSDreplay/',
  plugins: [react(), liveBridge()],
  worker: {format: 'es'},
  build: {target: 'es2022', sourcemap: false},
  server: {host: '127.0.0.1', port: 5199},
});
