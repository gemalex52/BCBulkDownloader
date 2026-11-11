import * as esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const distDir = path.join(process.cwd(), 'public', 'extension-dist');
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

console.log('0. Building extension core.js from src/services/bandcampCore.ts with esbuild...');
await esbuild.build({
  entryPoints: ['src/services/bandcampCore.ts'],
  bundle: true,
  minify: false,
  format: 'iife',
  globalName: 'BandcampCore',
  footer: {
    js: `
if (typeof self !== 'undefined') { Object.assign(self, BandcampCore); }
if (typeof window !== 'undefined') { Object.assign(window, BandcampCore); }
if (typeof globalThis !== 'undefined') { Object.assign(globalThis, BandcampCore); }
if (typeof module !== 'undefined' && module.exports) { Object.assign(module.exports, BandcampCore); }
`,
  },
  outfile: path.join(distDir, 'core.js'),
});

import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const rawLoaderPlugin = {
  name: 'raw-loader',
  setup(build) {
    build.onResolve({ filter: /\?raw$/ }, (args) => {
      const cleanPath = args.path.replace(/\?raw$/, '');
      let resolvedPath;
      if (cleanPath.startsWith('.') || path.isAbsolute(cleanPath)) {
        resolvedPath = path.isAbsolute(cleanPath)
          ? cleanPath
          : path.resolve(args.resolveDir, cleanPath);
      } else {
        try {
          resolvedPath = require.resolve(cleanPath);
        } catch {
          resolvedPath = path.resolve(process.cwd(), 'node_modules', cleanPath);
        }
      }
      return { path: resolvedPath, namespace: 'raw-file' };
    });
    build.onLoad({ filter: /.*/, namespace: 'raw-file' }, (args) => {
      const text = fs.readFileSync(args.path, 'utf8');
      return { contents: text, loader: 'text' };
    });
  },
};

console.log('1. Building extension dashboard.bundle.js with esbuild...');
await esbuild.build({
  entryPoints: ['src/extensionDashboard.tsx'],
  bundle: true,
  minify: true,
  format: 'iife',
  plugins: [rawLoaderPlugin],
  outfile: path.join(distDir, 'dashboard.bundle.js'),
});

console.log('2. Building extension dashboard.css with tailwindcss...');
try {
  execSync('npx @tailwindcss/cli -i src/index.css -o public/extension-dist/dashboard.css --minify', {
    stdio: 'inherit',
  });
} catch (e) {
  console.warn('Tailwind CLI build warning:', e);
}

console.log('✓ Extension React dashboard assets compiled successfully in public/extension-dist!');
