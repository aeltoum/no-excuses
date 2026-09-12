import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    {
      name: "spa-history-fallback",
      configureServer(server) {
        server.middlewares.use((request, _response, next) => {
          if (request.url && request.headers.accept?.includes("text/html"))
            request.url = "/";
          next();
        });
      },
      configurePreviewServer(server) {
        server.middlewares.use((request, _response, next) => {
          if (request.url && request.headers.accept?.includes("text/html"))
            request.url = "/";
          next();
        });
      },
    },
    react(),
  ],
  server: { port: 4174, strictPort: true },
  preview: { port: 4174, strictPort: true },
});
