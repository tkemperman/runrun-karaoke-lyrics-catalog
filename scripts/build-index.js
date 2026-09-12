"use strict";
const fs = require('node:fs');
const path = require('node:path');
const R = require('./repositories.js');
const root = path.resolve(__dirname, '..');
const entries = [];
function visit(directory) {
  for (const item of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    const full = path.join(directory, item.name);
    if (item.isSymbolicLink()) throw new Error(`Symlinks are not supported: ${full}`);
    if (item.isDirectory()) visit(full);
    else if (item.name.endsWith('.json')) {
      if (fs.statSync(full).size > 3000000) throw new Error(`Project exceeds 3 MB: ${full}`);
      entries.push(R.entry(JSON.parse(fs.readFileSync(full, 'utf8')), path.relative(root, full).split(path.sep).join('/')));
    }
  }
}
visit(path.join(root, 'translations'));
entries.sort((a, b) => a.file.localeCompare(b.file, 'en'));
const index = { schemaVersion: 1, entries };
R.index(index);
const output = JSON.stringify(index, null, 2) + '\n';
if (Buffer.byteLength(output) > 3000000) throw new Error('Catalog exceeds 3 MB.');
fs.writeFileSync(path.join(root, 'index.json'), output);
console.log(`Indexed ${entries.length} projects.`);
