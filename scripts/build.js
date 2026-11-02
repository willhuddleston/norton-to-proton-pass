'use strict';

/*
 * Builds dist/norton-to-proton-pass.html: src/index.html with both scripts
 * inlined and the Content-Security-Policy meta tag added. The CSP is added here
 * only, because during development index.html loads the scripts as separate
 * files, which the policy would block.
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const OUT_DIR = path.join(ROOT, 'dist');
const OUT_FILE = path.join(OUT_DIR, 'norton-to-proton-pass.html');
const SCRIPTS = ['converter.js', 'app.js'];

const CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; " +
  "img-src data:; base-uri 'none'; form-action 'none'";
const CSP_TAG = `<meta http-equiv="Content-Security-Policy" content="${CSP}">`;

function build() {
  let html = fs.readFileSync(path.join(SRC, 'index.html'), 'utf8');

  const charset = '<meta charset="utf-8">';
  if (!html.includes(charset)) throw new Error(`index.html must contain ${charset}`);
  // Right after the charset, so the policy applies before anything else loads.
  html = html.replace(charset, () => `${charset}\n${CSP_TAG}`);

  for (const name of SCRIPTS) {
    const tag = `<script src="${name}"></script>`;
    if (!html.includes(tag)) throw new Error(`index.html must contain ${tag}`);
    const code = fs.readFileSync(path.join(SRC, name), 'utf8');
    if (/<\/script/i.test(code)) throw new Error(`${name} must not contain "</script"`);
    // A function replacement, so "$" sequences in the code are not special.
    html = html.replace(tag, () => `<script>\n${code}</script>`);
  }

  if (/<script\s[^>]*src=/i.test(html)) throw new Error('built file still loads an external script');
  return html;
}

if (require.main === module) {
  const html = build();
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, html, 'utf8');
  process.stdout.write(`Built ${path.relative(ROOT, OUT_FILE)} (${Buffer.byteLength(html)} bytes)\n`);
}

module.exports = { build, CSP };
