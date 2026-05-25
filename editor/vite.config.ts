import path from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { capiRuntimeMiddleware } from "../src/server/runtimeRoutes"

export default defineConfig({
  plugins: [
    {
      name: "capi-runtime-routes",
      configureServer(server) {
        server.middlewares.use(capiRuntimeMiddleware(__dirname))
      },
      configurePreviewServer(server) {
        server.middlewares.use(capiRuntimeMiddleware(__dirname))
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
