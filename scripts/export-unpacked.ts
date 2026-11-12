import fs from 'fs';
import path from 'path';
import { EXTENSION_FILES } from '../src/services/extensionPackage';

const distDir = path.join(process.cwd(), 'public', 'extension-dist');
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

console.log('3. Exporting unpacked extension files to public/extension-dist...');
for (const file of EXTENSION_FILES) {
  // core.js, dashboard.bundle.js, and dashboard.css are already compiled by esbuild/tailwind
  if (file.path === 'core.js' || file.path === 'dashboard.bundle.js' || file.path === 'dashboard.css') {
    continue;
  }

  const targetPath = path.join(distDir, file.path);
  const parentDir = path.dirname(targetPath);
  if (!fs.existsSync(parentDir)) {
    fs.mkdirSync(parentDir, { recursive: true });
  }

  if (file.path === 'jszip.min.js') {
    const jszipPath = path.join(process.cwd(), 'node_modules', 'jszip', 'dist', 'jszip.min.js');
    if (fs.existsSync(jszipPath)) {
      fs.writeFileSync(targetPath, fs.readFileSync(jszipPath, 'utf8'), 'utf8');
      continue;
    }
  }

  if (file.binaryBuffer) {
    fs.writeFileSync(targetPath, Buffer.from(file.binaryBuffer));
  } else if (file.content) {
    const str = typeof file.content === 'string' ? file.content : String(file.content);
    fs.writeFileSync(targetPath, str, 'utf8');
  }
}

console.log('✓ All unpacked Chrome extension files successfully written to public/extension-dist!');
