// Baut teams/public/ für Vercel: Oberfläche aus ../ui plus client/. Aufruf: node scripts/build-public.js
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPage, ICON_LINKS } from '../lib/page.js';
const here = path.dirname(fileURLToPath(import.meta.url));
const UI = path.resolve(here, '../../ui'), CLIENT = path.resolve(here, '../client'), OUT = path.resolve(here, '../public');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT);
for (const f of fs.readdirSync(UI)) if (/\.(js|css|svg|png)$/.test(f)) fs.copyFileSync(path.join(UI, f), path.join(OUT, f));
for (const f of ['github.js', 'github.css']) fs.copyFileSync(path.join(CLIENT, f), path.join(OUT, f));
const icon = path.resolve(here, '../../design/app-icon.svg');
if (fs.existsSync(icon)) fs.copyFileSync(icon, path.join(OUT, 'favicon.svg'));
// PNG/ICO-Icons: Google (und damit das Connector-Icon in Claude) liest kein SVG
const ICONS = path.resolve(here, '../../design/web-icons');
for (const f of fs.readdirSync(ICONS)) fs.copyFileSync(path.join(ICONS, f), path.join(OUT, f));
fs.writeFileSync(path.join(OUT, 'index.html'), buildPage(UI).replace('<title>natively</title>', `<title>natively</title>\n${ICON_LINKS}`));
console.log('public/ gebaut:', fs.readdirSync(OUT).join(', '));
