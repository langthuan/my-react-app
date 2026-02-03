import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'
import { copyFileSync } from 'node:fs'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(), 
    tailwindcss(),
    {
      name: 'copy-manifest',
      closeBundle() {
        try {
          copyFileSync(
            resolve(__dirname, 'public/manifest.json'),
            resolve(__dirname, 'dist/manifest.json')
          )
        } catch (err) {
          console.error('Error copying manifest:', err)
        }
      }
    }
  ],
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        content: resolve(__dirname, 'src/content/flowContentScript.js'),
        background: resolve(__dirname, 'src/background/serviceWorker.js'),
      },
      output: {
        entryFileNames: (chunkInfo) => {
          if (chunkInfo.name === 'content') {
            return 'content/flowContentScript.js'
          }
          if (chunkInfo.name === 'background') {
            return 'background/serviceWorker.js'
          }
          return 'assets/[name]-[hash].js'
        },
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: (assetInfo) => {
          if (assetInfo.name === 'manifest.json') {
            return '[name][extname]'
          }
          if (assetInfo.name?.endsWith('.svg')) {
            return '[name][extname]'
          }
          return 'assets/[name]-[hash][extname]'
        }
      }
    },
    chunkSizeWarningLimit: 1000,
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
})
