import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // For GitHub Pages served at username.github.io/repo-name/, set
  // VITE_BASE_PATH=/repo-name/ at build time. Defaults to root for
  // Docker/local/custom-domain deploys.
  base: process.env.VITE_BASE_PATH || "/",
  server: {
    host: true,
    port: 5173,
  },
});
