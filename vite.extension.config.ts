import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';
import { defineConfig } from 'vite';

// Plugin to copy manifest.json, content.css, and icons to dist after build
function copyManifestPlugin() {
  return {
    name: 'copy-manifest-plugin',
    closeBundle() {
      const distDir = path.resolve(__dirname, 'dist');
      const distAssets = path.resolve(distDir, 'assets');
      if (!fs.existsSync(distDir)) {
        fs.mkdirSync(distDir, { recursive: true });
      }
      if (!fs.existsSync(distAssets)) {
        fs.mkdirSync(distAssets, { recursive: true });
      }

      fs.copyFileSync(path.resolve(__dirname, 'manifest.json'), path.resolve(distDir, 'manifest.json'));
      if (fs.existsSync(path.resolve(__dirname, 'src/content.css'))) {
        fs.copyFileSync(path.resolve(__dirname, 'src/content.css'), path.resolve(distDir, 'content.css'));
      }

      // Copy icon PNGs from public/assets
      const srcAssets = path.resolve(__dirname, 'public/assets');
      if (fs.existsSync(srcAssets)) {
        const files = fs.readdirSync(srcAssets);
        for (const file of files) {
          if (file.endsWith('.png') || file.endsWith('.jpg') || file.endsWith('.svg')) {
            fs.copyFileSync(path.resolve(srcAssets, file), path.resolve(distAssets, file));
          }
        }
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), copyManifestPlugin()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: path.resolve(__dirname, 'popup.html'),
        background: path.resolve(__dirname, 'src/background.ts'),
      },
      output: {
        entryFileNames: (chunkInfo) => {
          if (chunkInfo.name === 'background') return 'background.js';
          return 'assets/[name]-[hash].js';
        },
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]',
      },
    },
  },
});
