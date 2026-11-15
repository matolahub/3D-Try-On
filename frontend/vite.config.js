import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

// Il Try-On si distribuisce come widget (embed.html, in iframe) + SDK statico (public/sdk).
// La pagina demo-shop/ e' solo per lo sviluppo: non entra nella build.
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: { input: { embed: fileURLToPath(new URL('./embed.html', import.meta.url)) } },
  },
})
