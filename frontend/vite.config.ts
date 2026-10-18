import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true, // Needed for Docker container port mapping
    watch: {
      usePolling: true, // Helps with file-change detection in Docker on macOS/Windows
    }
  }
})
