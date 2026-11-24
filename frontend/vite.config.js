import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { fileURLToPath } from 'node:url'

// Il Try-On si distribuisce come widget (embed.html, in iframe) + SDK statico (public/sdk).
// La pagina demo-shop/ e' solo per lo sviluppo: non entra nella build.
// `npm run dev:phone` (mode "phone"): HTTPS con certificato autofirmato e server visibile in rete locale, per provare dal
// telefono la scansione del corpo: i browser danno accesso alla fotocamera solo su HTTPS (o su localhost).
export default defineConfig(({ mode }) => ({
  plugins: [react(), ...(mode === 'phone' ? [basicSsl({ name: 'wearit-dev' })] : [])],
  server: mode === 'phone' ? { host: true } : undefined,
  build: {
    rollupOptions: { input: { embed: fileURLToPath(new URL('./embed.html', import.meta.url)) } },
  },
}))
