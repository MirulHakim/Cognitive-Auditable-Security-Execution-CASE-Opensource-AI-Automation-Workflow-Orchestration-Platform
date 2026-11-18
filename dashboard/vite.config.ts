import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/**
 * The dev server proxies /api to the CASE workflow API, so the browser sees a
 * single origin (no CORS, no cookie/header differences). Point VITE_API_BASE at
 * another origin when the API lives elsewhere.
 */
const apiProxy = {
  "/api": {
    // Default to the auth gateway. Point VITE_API_PROXY at :8000 to run the
    // legacy API without auth (the gateway proxies to it in the normal setup).
    target: process.env.VITE_API_PROXY ?? "http://127.0.0.1:8080",
    changeOrigin: true,
  },
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5174,
    proxy: apiProxy,
  },
  // `npm run preview` serves the built bundle; the same proxy keeps /api on one
  // origin, so a production-style run needs no CORS entry and no VITE_API_BASE.
  preview: {
    port: 4174,
    proxy: apiProxy,
  },
});
