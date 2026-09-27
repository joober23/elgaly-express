const fs = require('fs');
const path = require('path');

const srcDir = __dirname;
const targets = [path.join(__dirname, 'www'), path.join(__dirname, 'public')];

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

const dirsToCopy = ['images', 'vendor'];

targets.forEach(outDir => {
  if (fs.existsSync(outDir)) {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
  fs.mkdirSync(outDir, { recursive: true });

  filesToCopy.forEach(file => {
    const src = path.join(srcDir, file);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(outDir, file));
    }
  });

  dirsToCopy.forEach(dir => {
    const src = path.join(srcDir, dir);
    if (fs.existsSync(src)) {
      fs.cpSync(src, path.join(outDir, dir), { recursive: true });
    }
  });
});

console.log('✅ Build www/ e public/ gerados com sucesso!');
