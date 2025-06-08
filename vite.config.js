import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// https://vite.dev/config/
export default defineConfig({
  base: '/pondpilot-demo/',
  plugins: [vue()],
  server: {
    hmr: true,
    watch: {
      usePolling: true,
      interval: 100
    }
  }
})
