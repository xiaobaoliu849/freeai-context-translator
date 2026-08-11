import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';
import { defineConfig } from 'vite';

/**
 * Content scripts in Manifest V3 are classic scripts: they cannot contain
 * top-level `import` statements or load sibling chunk files. This build bundles
 * content.tsx into ONE self-contained IIFE file (plus content.css), then copies
 * them over the outputs of vite.extension.config.ts.
 */
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'content-standalone-output',
      closeBundle() {
        const outDir = path.resolve(__dirname, 'dist-content');
        const distDir = path.resolve(__dirname, 'dist');
        if (!fs.existsSync(distDir)) {
          fs.mkdirSync(distDir, { recursive: true });
        }
        // content.js is always named exactly; the css gets a hashed name, so
        // locate it by extension and copy as content.css.
        const jsSrc = path.resolve(outDir, 'content.js');
        if (fs.existsSync(jsSrc)) {
          fs.copyFileSync(jsSrc, path.resolve(distDir, 'content.js'));
        }
        const cssFile = fs.readdirSync(outDir).find((f) => f.endsWith('.css'));
        if (cssFile) {
          fs.copyFileSync(path.resolve(outDir, cssFile), path.resolve(distDir, 'content.css'));
        }
      },
    },
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  build: {
    outDir: 'dist-content',
    emptyOutDir: true,
    cssCodeSplit: false,
    rollupOptions: {
      input: path.resolve(__dirname, 'src/content.tsx'),
      output: {
        format: 'iife',
        inlineDynamicImports: true,
        entryFileNames: 'content.js',
        // cssCodeSplit is off, so there is exactly one css asset — name it
        // content.css directly (no assets/ subfolder) for easy copying.
        assetFileNames: (assetInfo) => {
          if (assetInfo.name?.endsWith('.css')) return 'content.css';
          return 'assets/[name]-[hash].[ext]';
        },
      },
    },
  },
});
