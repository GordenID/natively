// index.html der Mac-App plus die Teile der Team-Version (github.css, github.js). Gemeinsam für server.js und den Vercel-Build.
import fs from 'node:fs';
import path from 'node:path';
export function buildPage(uiDir, pre = '') {
  return fs.readFileSync(path.join(uiDir, 'index.html'), 'utf8')
    .replace('<link rel="stylesheet" href="styles.css">', '<link rel="stylesheet" href="styles.css">\n<link rel="stylesheet" href="github.css">')
    .replace('<script src="app.js"></script>', `${pre}<script src="github.js"></script>\n<script src="app.js"></script>`);
}
