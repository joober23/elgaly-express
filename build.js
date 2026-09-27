const fs = require('fs');
const path = require('path');

const srcDir = __dirname;
const outDir = path.join(__dirname, 'www');

if (fs.existsSync(outDir)) {
  fs.rmSync(outDir, { recursive: true, force: true });
}
fs.mkdirSync(outDir, { recursive: true });

const filesToCopy = [
  'index.html',
  'style.css',
  'app.js',
  'firebase-service.js',
  'report.js',
  'sp-cities.js',
  'manifest.webmanifest',
  'sw.js'
];

filesToCopy.forEach(file => {
  const src = path.join(srcDir, file);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, path.join(outDir, file));
  }
});

const dirsToCopy = ['images', 'vendor'];
dirsToCopy.forEach(dir => {
  const src = path.join(srcDir, dir);
  if (fs.existsSync(src)) {
    fs.cpSync(src, path.join(outDir, dir), { recursive: true });
  }
});

console.log('✅ Build www/ gerado com sucesso para o Capacitor!');
