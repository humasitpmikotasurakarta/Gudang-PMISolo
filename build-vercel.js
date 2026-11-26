/**
 * ============================================================================
 * SISTEM INFORMASI MANAJEMEN STOK GUDANG - PMI KOTA SURAKARTA
 * File: build-vercel.js
 * Deskripsi: Script bundler otomatis untuk Vercel. Menggabungkan file modular
 *            Google Apps Script (Index.html, CSS.html, Components.html,
 *            JavaScript.html) menjadi file HTML statis siap-pakai di dist/index.html.
 * ============================================================================
 */

const fs = require('fs');
const path = require('path');

const rootDir = __dirname;
const distDir = path.join(rootDir, 'dist');

if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

const indexHtml = fs.readFileSync(path.join(rootDir, 'Index.html'), 'utf8');
const cssHtml = fs.readFileSync(path.join(rootDir, 'CSS.html'), 'utf8');
const componentsHtml = fs.readFileSync(path.join(rootDir, 'Components.html'), 'utf8');
let jsHtml = fs.readFileSync(path.join(rootDir, 'JavaScript.html'), 'utf8');

// Jika Environment Variable GAS_WEB_APP_URL diset di Vercel Dashboard, injeksikan sebagai default URL
if (process.env.GAS_WEB_APP_URL && process.env.GAS_WEB_APP_URL.trim() !== '') {
  const envUrl = process.env.GAS_WEB_APP_URL.trim();
  jsHtml = jsHtml.replace(
    /var DEFAULT_GAS_WEB_APP_URL = '[^']+';/,
    "var DEFAULT_GAS_WEB_APP_URL = '" + envUrl + "';"
  );
}

const bundledHtml = indexHtml
  .replace(/<\?!=\s*include\(['"]CSS['"]\);\s*\?>/g, cssHtml)
  .replace(/<\?!=\s*include\(['"]Components['"]\);\s*\?>/g, componentsHtml)
  .replace(/<\?!=\s*include\(['"]JavaScript['"]\);\s*\?>/g, jsHtml);

fs.writeFileSync(path.join(distDir, 'index.html'), bundledHtml, 'utf8');
fs.writeFileSync(path.join(rootDir, 'Preview_Lokal_PMI_Surakarta.html'), bundledHtml, 'utf8');

console.log('✅ Build Vercel selesai: dist/index.html & Preview_Lokal_PMI_Surakarta.html berhasil dibuat.');
