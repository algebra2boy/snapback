import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  base: "/snapback/",
  plugins: [tailwindcss(), react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    proxy: {
      "/api/gamma": {
        target: "https://gamma-api.polymarket.com",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api\/gamma/, ""),
      },
      "/api/clob": {
        target: "https://clob.polymarket.com",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api\/clob/, ""),
      },
    },
  },
  preview: {
    proxy: {
      "/api/gamma": {
        target: "https://gamma-api.polymarket.com",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api\/gamma/, ""),
      },
      "/api/clob": {
        target: "https://clob.polymarket.com",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api\/clob/, ""),
      },
    },
  },
});
