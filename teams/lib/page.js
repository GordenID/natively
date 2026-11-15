// index.html der Mac-App plus die Teile der Team-Version (github.css, github.js). Gemeinsam für server.js und den Vercel-Build.
import fs from 'node:fs';
import path from 'node:path';
export function buildPage(uiDir, pre = '') {
  return fs.readFileSync(path.join(uiDir, 'index.html'), 'utf8')
    .replace('<link rel="stylesheet" href="styles.css">', '<link rel="stylesheet" href="styles.css">\n<link rel="stylesheet" href="github.css">')
    .replace('<script src="app.js"></script>', `${pre}<script src="github.js"></script>\n<script src="app.js"></script>`);
}
// Icons im Kopf der Seite: PNG/ICO zuerst (für Google-Favicons und das Connector-Icon in Claude), SVG für Browser
export const ICON_LINKS = '<link rel="icon" href="/favicon.ico" sizes="any">\n<link rel="icon" type="image/png" sizes="192x192" href="/icon-192.png">\n<link rel="icon" type="image/svg+xml" href="/favicon.svg">\n<link rel="apple-touch-icon" href="/icon-180.png">';
