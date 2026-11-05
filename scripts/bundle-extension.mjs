import * as esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const distDir = path.join(process.cwd(), 'public', 'extension-dist');
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

console.log('1. Building extension dashboard.bundle.js with esbuild...');
esbuild.buildSync({
  entryPoints: ['src/extensionDashboard.tsx'],
  bundle: true,
  minify: true,
  format: 'iife',
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
