import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const dist = new URL('../dist/', import.meta.url);
const assets = (await readdir(new URL('assets/', dist))).map(name => '/assets/' + name);
const html = await readFile(new URL('index.html', dist), 'utf8');
const version = createHash('sha256').update(html + assets.join('|')).digest('hex').slice(0, 12);
const files = ['/index.html', '/manifest.webmanifest', '/icon.svg', ...assets];
const source = await readFile(new URL('./service-worker.template.js', import.meta.url), 'utf8');
await writeFile(new URL('sw.js', dist), source
  .replace('__CACHE_NAME__', JSON.stringify('arca-shell-' + version))
  .replace('__FILES__', JSON.stringify(files)));
console.log('Aplicación preparada para uso sin conexión.');
