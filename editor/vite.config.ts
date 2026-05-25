import path from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { capiExportMiddleware } from "../src/server/exportRoute"

export default defineConfig({
  plugins: [
    {
      name: "capi-export-route",
      configureServer(server) {
        server.middlewares.use(capiExportMiddleware(__dirname))
      },
      configurePreviewServer(server) {
        server.middlewares.use(capiExportMiddleware(__dirname))
      },
    },
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
})
