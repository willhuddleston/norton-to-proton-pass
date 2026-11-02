'use strict';

// Static checks for the spec's Security and privacy rules.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { build, CSP } = require('../scripts/build.js');

const src = (name) => fs.readFileSync(path.join(__dirname, '..', 'src', name), 'utf8');
const scripts = { 'converter.js': src('converter.js'), 'app.js': src('app.js') };
const built = build();

describe('source scripts', () => {
  const forbidden = {
    'network access': /\b(fetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|importScripts)/,
    'storage': /\b(localStorage|sessionStorage|indexedDB|document\.cookie|caches\.)/,
    'logging': /\bconsole\./,
    'HTML injection': /\.(innerHTML|outerHTML)\b|insertAdjacentHTML|document\.write/,
    'dynamic code': /\beval\s*\(|new Function\s*\(/,
  };
  for (const [file, code] of Object.entries(scripts)) {
    for (const [rule, pattern] of Object.entries(forbidden)) {
      test(`${file} has no ${rule}`, () => {
        assert.doesNotMatch(code, pattern);
      });
    }
  }

  test('the download object URL is revoked', () => {
    assert.match(scripts['app.js'], /URL\.revokeObjectURL\(/);
  });
});

describe('built HTML', () => {
  test('has the exact CSP meta tag, once, before any script', () => {
    const tag = `<meta http-equiv="Content-Security-Policy" content="${CSP}">`;
    assert.equal(built.split(tag).length - 1, 1);
    assert.ok(built.indexOf(tag) < built.indexOf('<script'));
    assert.equal(
      CSP,
      "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'",
    );
  });

  test('inlines both scripts and loads nothing external', () => {
    assert.doesNotMatch(built, /<script[^>]*\ssrc=/i);
    assert.doesNotMatch(built, /<link\b/i);
    const css = built.match(/<style>([\s\S]*?)<\/style>/)[1];
    assert.doesNotMatch(css, /@import|url\(/i);
    assert.ok(built.includes(scripts['converter.js']));
    assert.ok(built.includes(scripts['app.js']));
  });

  test('the only outside link is the README security section, opened safely', () => {
    const links = [...built.matchAll(/<a\b[^>]*>/gi)].map((m) => m[0]);
    assert.equal(links.length, 1);
    assert.match(links[0], /href="https:\/\/github\.com\/[^"]+#security"/);
    assert.match(links[0], /rel="noopener noreferrer"/);
  });

  test('the development page has no CSP (it would block its own scripts)', () => {
    assert.doesNotMatch(src('index.html'), /Content-Security-Policy/);
  });
});
