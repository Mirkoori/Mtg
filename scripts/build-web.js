'use strict';
/* Copia i file del sito in www/ (la cartella che Capacitor mette dentro l'app). */
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..'), out = path.join(root, 'www');
const ok = f => /\.(html|js|css|png|svg|webmanifest|json)$/i.test(f) && !['package.json', 'package-lock.json', 'capacitor.config.json', 'sw.js', 'supabase-setup.sql'].includes(f);
fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true });
let n = 0;
fs.readdirSync(root).forEach(f => { const p = path.join(root, f); if (fs.statSync(p).isFile() && ok(f)) { fs.copyFileSync(p, path.join(out, f)); n++; } });
console.log('Copiati ' + n + ' file in www/');
