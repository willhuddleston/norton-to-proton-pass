'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  parseCsv,
  writeCsv,
  looksLikeEmail,
  convert,
  ConversionError,
  PROTON_HEADER,
} = require('../src/converter.js');

const fixture = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');

// Finds the converted row whose Proton name matches.
const byName = (rows, name) => {
  const row = rows.find((r) => r.name === name);
  assert.ok(row, `expected a row named ${JSON.stringify(name)}`);
  return row;
};

describe('parseCsv', () => {
  test('splits simple rows and fields', () => {
    assert.deepEqual(parseCsv('a,b,c\n1,2,3\n'), [['a', 'b', 'c'], ['1', '2', '3']]);
  });

  test('handles a missing final newline', () => {
    assert.deepEqual(parseCsv('a,b\n1,2'), [['a', 'b'], ['1', '2']]);
  });

  test('keeps empty fields', () => {
    assert.deepEqual(parseCsv(',a,,\n'), [['', 'a', '', '']]);
  });

  test('handles quoted fields with commas', () => {
    assert.deepEqual(parseCsv('"a,b",c\n'), [['a,b', 'c']]);
  });

  test('handles "" escapes', () => {
    assert.deepEqual(parseCsv('"say ""hi""",x\n'), [['say "hi"', 'x']]);
  });

  test('keeps newlines inside quotes exactly', () => {
    assert.deepEqual(parseCsv('"one\ntwo\r\nthree",x\n'), [['one\ntwo\r\nthree', 'x']]);
  });

  test('handles \\r\\n line endings', () => {
    assert.deepEqual(parseCsv('a,b\r\n1,2\r\n'), [['a', 'b'], ['1', '2']]);
  });

  test('strips a leading byte-order mark', () => {
    assert.deepEqual(parseCsv('﻿a,b\n'), [['a', 'b']]);
  });

  test('returns no rows for empty input', () => {
    assert.deepEqual(parseCsv(''), []);
  });

  test('keeps non-English text', () => {
    assert.deepEqual(parseCsv('Café,東京,🔑\n'), [['Café', '東京', '🔑']]);
  });
});

describe('looksLikeEmail', () => {
  const cases = [
    ['jane@gmail.com', true],
    ['jane.doe+shopping@outlook.co.uk', true],
    ['jane@bücher.de', true],
    ['  padded@example.com  ', true],
    ['a@b.io', true],
    ['jane_doe', false],
    ['@janedoe', false],
    ['jane@localhost', false],
    ['admin@company', false],
    ['jane@gmail', false],
    ['07700 900123', false],
    ['jane @gmail.com', false],
    ['jane@example.c', false],
    ['jane@@example.com', false],
    ['jane@example.com.', false],
    ['', false],
    ['   ', false],
  ];
  for (const [value, expected] of cases) {
    test(`${JSON.stringify(value)} -> ${expected}`, () => {
      assert.equal(looksLikeEmail(value), expected);
    });
  }
});

describe('writeCsv', () => {
  test('quotes every field and uses \\r\\n after every row', () => {
    assert.equal(writeCsv([['a', ''], ['b', 'c']]), '"a",""\r\n"b","c"\r\n');
  });

  test('escapes quotes by doubling them', () => {
    assert.equal(writeCsv([['say "hi"']]), '"say ""hi"""\r\n');
  });

  test('never writes a byte-order mark', () => {
    assert.ok(!writeCsv([['x']]).startsWith('﻿'));
  });

  const roundTrips = {
    'plain values': [['a', 'b'], ['c', 'd']],
    'empty strings': [['', '', '']],
    'commas and quotes': [['a,b', '"quoted"', '""', ',']],
    'line breaks': [['one\ntwo', 'three\r\nfour', '\n']],
    'non-English text': [['Café Zürich 東京', 'F—ä😀']],
    'leading and trailing spaces': [['  padded  ', ' ']],
    'empty input': [],
  };
  for (const [label, rows] of Object.entries(roundTrips)) {
    test(`round-trips ${label}`, () => {
      assert.deepEqual(parseCsv(writeCsv(rows)), rows);
    });
  }
});

describe('norton-basic.csv', () => {
  test('converts to exactly proton-expected-basic.csv', () => {
    assert.equal(convert(fixture('norton-basic.csv')).csv, fixture('proton-expected-basic.csv'));
  });

  test('reports 3 logins and 2 skipped notes', () => {
    const { report } = convert(fixture('norton-basic.csv'));
    assert.equal(report.converted, 3);
    assert.deepEqual(report.skipped.map(({ type, count }) => ({ type, count })), [
      { type: 'notes', count: 2 },
    ]);
    assert.match(report.skipped[0].message, /^2 notes skipped: not supported by Proton's CSV import yet$/);
    assert.deepEqual(report.warnings, []);
    assert.deepEqual(report.duplicates, []);
  });
});

describe('norton-bom-crlf.csv', () => {
  test('converts to the same output as the basic fixture', () => {
    assert.equal(convert(fixture('norton-bom-crlf.csv')).csv, fixture('proton-expected-basic.csv'));
  });
});

describe('norton-edge-cases.csv', () => {
  const result = convert(fixture('norton-edge-cases.csv'));
  const { rows, report } = result;

  test('converts 19 logins, skips 1 duplicate and 2 notes', () => {
    assert.equal(report.converted, 19);
    assert.equal(rows.length, 19);
    assert.deepEqual(report.skipped.map(({ type, count }) => ({ type, count })), [
      { type: 'notes', count: 2 },
    ]);
  });

  test('routes each user name to email or username', () => {
    const expected = {
      'Email: plain': ['jane@gmail.com', ''],
      'Email: plus tag, multi-part domain': ['jane.doe+shopping@outlook.co.uk', ''],
      'Email: non-English domain': ['jane@bücher.de', ''],
      'Email: surrounding spaces (written unchanged)': ['  padded@example.com  ', ''],
      'Username: no @': ['', 'jane_doe'],
      'Username: handle': ['', '@janedoe'],
      'Username: no dot in domain': ['', 'jane@localhost'],
      'Username: no TLD': ['', 'admin@company'],
      'Username: likely typo': ['', 'jane@gmail'],
      'Username: phone number': ['', '07700 900123'],
      'Username: contains space': ['', 'jane @gmail.com'],
    };
    for (const [name, [email, username]] of Object.entries(expected)) {
      const row = byName(rows, name);
      assert.equal(row.email, email, name);
      assert.equal(row.username, username, name);
    }
  });

  test('keeps multi-line notes with commas and quotes exactly', () => {
    assert.equal(
      byName(rows, 'Multi-line note').note,
      'Line one\nLine two, with a comma\nLine three with "quotes"',
    );
  });

  test('keeps passwords and names with commas, quotes and semicolons exactly', () => {
    const row = byName(rows, 'Password with , " \' ;');
    assert.equal(row.password, 'Fa,ke"Pa\'ss;word');
  });

  test('fills an empty site name from the URL hostname without www.', () => {
    const row = byName(rows, 'example.org');
    assert.equal(row.url, 'https://www.example.org/login');
    assert.ok(report.warnings.some((w) => w.kind === 'name-from-url' && w.line === 19));
  });

  test('falls back to "Untitled login" when there is no site name or URL', () => {
    const row = byName(rows, 'Untitled login');
    assert.equal(row.password, 'Fake-N06');
    assert.equal(row.email, '');
    assert.equal(row.username, '');
  });

  test('copies a URL with no scheme exactly and warns', () => {
    assert.equal(byName(rows, 'URL without scheme').url, 'example.net/signin');
  });

  test('keeps non-English text exactly', () => {
    const row = byName(rows, 'Café Zürich 東京');
    assert.equal(row.password, 'Fäké-Pässwörd-東京-🔑');
    assert.equal(row.note, 'Ünïcödé note ✓');
    assert.equal(row.vault, 'Norton Favourites');
  });

  test('skips the exact duplicate and lists it by site name', () => {
    assert.equal(rows.filter((r) => r.name === 'Email: plain').length, 1);
    assert.deepEqual(report.duplicates.map(({ site, line }) => ({ site, line })), [
      { site: 'Email: plain', line: 24 },
    ]);
  });

  test('pads a row with missing cells, keeps it and warns', () => {
    const row = byName(rows, 'Row missing cells');
    assert.equal(row.email, 'short@example.com');
    assert.equal(row.password, 'Fake-N08');
    assert.equal(row.url, '');
    assert.equal(row.note, '');
  });

  test('produces exactly the expected warnings, each naming its row', () => {
    const warnings = report.warnings.map(({ line, site, kind }) => ({ line, site, kind }));
    assert.deepEqual(warnings, [
      { line: 19, site: 'example.org', kind: 'name-from-url' },
      { line: 20, site: 'URL without scheme', kind: 'no-scheme' },
      { line: 21, site: 'Empty password', kind: 'empty-password' },
      { line: 22, site: 'Untitled login', kind: 'missing-url' },
      { line: 22, site: 'Untitled login', kind: 'untitled' },
      { line: 25, site: 'Row missing cells', kind: 'cell-count' },
      { line: 25, site: 'Row missing cells', kind: 'missing-url' },
    ]);
    for (const w of report.warnings) {
      assert.ok(w.message.includes(`line ${w.line}`), w.message);
      assert.ok(w.message.includes(w.site), w.message);
    }
  });

  test('output CSV round-trips back to the converted rows', () => {
    const parsed = parseCsv(result.csv);
    assert.deepEqual(parsed[0], PROTON_HEADER);
    assert.deepEqual(
      parsed.slice(1),
      rows.map((r) => PROTON_HEADER.map((col) => r[col])),
    );
  });

  test('every totp is empty', () => {
    assert.ok(rows.every((r) => r.totp === ''));
  });
});

describe('norton-unknown-type.csv', () => {
  test('counts and skips the unknown item type', () => {
    const { rows, report } = convert(fixture('norton-unknown-type.csv'));
    assert.equal(rows.length, 1);
    assert.deepEqual(report.skipped.map(({ type, count }) => ({ type, count })), [
      { type: 'creditcard', count: 1 },
      { type: 'notes', count: 1 },
    ]);
    assert.match(report.skipped[0].message, /^1 "creditcard" item skipped/);
    assert.match(report.skipped[1].message, /^1 note skipped: not supported by Proton's CSV import yet$/);
  });
});

describe('not-norton.csv', () => {
  test('is rejected as not a Norton export', () => {
    assert.throws(() => convert(fixture('not-norton.csv')), (err) => {
      assert.ok(err instanceof ConversionError);
      assert.equal(err.code, 'not-norton');
      assert.equal(err.message, "This doesn't look like a Norton Password Manager export.");
      return true;
    });
  });

  test('an empty file is rejected the same way', () => {
    assert.throws(() => convert(''), { code: 'not-norton' });
  });
});

describe('norton-missing-column.csv', () => {
  test('stops with an error naming the missing column', () => {
    assert.throws(() => convert(fixture('norton-missing-column.csv')), (err) => {
      assert.ok(err instanceof ConversionError);
      assert.equal(err.code, 'missing-columns');
      assert.deepEqual(err.missing, ['Password']);
      assert.match(err.message, /Password/);
      return true;
    });
  });
});

describe('a Norton file with no logins', () => {
  test('is not an error and converts nothing', () => {
    const text = [
      'Format,Version,Product,Product Version,Exported Date',
      'X,2.0,Norton Password Manager (Extension),1,1/1/2026 00:00',
      'Item Type,Title,Information,Secure,Favorite',
      'notes,t,i,false,false',
      '',
    ].join('\n');
    const { rows, csv, report } = convert(text);
    assert.equal(rows.length, 0);
    assert.equal(report.converted, 0);
    assert.equal(csv, writeCsv([PROTON_HEADER]));
  });
});

describe('options', () => {
  const edge = fixture('norton-edge-cases.csv');
  const basic = fixture('norton-basic.csv');

  test('Always username puts every user name in username', () => {
    const { rows } = convert(edge, { userNameMode: 'username' });
    const row = byName(rows, 'Email: plain');
    assert.equal(row.email, '');
    assert.equal(row.username, 'jane@gmail.com');
  });

  test('Always email puts every user name in email', () => {
    const { rows } = convert(edge, { userNameMode: 'email' });
    const row = byName(rows, 'Username: no @');
    assert.equal(row.email, 'jane_doe');
    assert.equal(row.username, '');
  });

  test('Both puts emails in both fields and others in username only', () => {
    const { rows } = convert(edge, { userNameMode: 'both' });
    assert.equal(byName(rows, 'Email: plain').email, 'jane@gmail.com');
    assert.equal(byName(rows, 'Email: plain').username, 'jane@gmail.com');
    assert.equal(byName(rows, 'Username: no @').email, '');
    assert.equal(byName(rows, 'Username: no @').username, 'jane_doe');
  });

  test('records which field each user name went to', () => {
    const { rows } = convert(edge);
    assert.equal(byName(rows, 'Email: plain').userField, 'email');
    assert.equal(byName(rows, 'Username: no @').userField, 'username');
    assert.equal(byName(rows, 'Untitled login').userField, 'none');
    const both = convert(edge, { userNameMode: 'both' }).rows;
    assert.equal(byName(both, 'Email: plain').userField, 'both');
  });

  test('a custom vault label and favourites label are used', () => {
    const { rows } = convert(basic, { vaultLabel: 'From Norton', favouritesLabel: 'Starred' });
    assert.deepEqual(rows.map((r) => r.vault), ['From Norton', 'Starred', 'From Norton']);
  });

  test('a blank vault label is written as blank', () => {
    const { rows } = convert(basic, { vaultLabel: '' });
    assert.equal(rows[0].vault, '');
  });

  test('favourites in the same group get the normal vault label', () => {
    const { rows } = convert(basic, { favourites: 'same' });
    assert.deepEqual(rows.map((r) => r.vault), ['Norton Import', 'Norton Import', 'Norton Import']);
    assert.equal(rows[1].note, 'Recovery codes in drawer');
  });

  test('favourites can be marked in the note instead', () => {
    const { rows } = convert(fixture('norton-edge-cases.csv'), { favourites: 'note' });
    const row = byName(rows, 'Café Zürich 東京');
    assert.equal(row.vault, 'Norton Import');
    assert.equal(row.note, 'Ünïcödé note ✓\nNorton favourite');
    const basicRows = convert(basic, { favourites: 'note' }).rows;
    assert.equal(basicRows[1].note, 'Recovery codes in drawer\nNorton favourite');
    assert.equal(basicRows[0].note, '');
  });

  test('an empty note becomes just the favourite marker', () => {
    const text = [
      'Format,Version,Product,Product Version,Exported Date',
      'X,2.0,Norton Password Manager (Extension),1,1/1/2026 00:00',
      'Item Type,User Name,Password,Site Name,Login URL,Notes,Secure,Favorite',
      'login,u,p,S,https://s.example.com,,false,true',
    ].join('\n');
    assert.equal(convert(text, { favourites: 'note' }).rows[0].note, 'Norton favourite');
  });

  test('duplicates can be kept', () => {
    const { rows, report } = convert(edge, { duplicates: 'keep' });
    assert.equal(rows.length, 20);
    assert.equal(rows.filter((r) => r.name === 'Email: plain').length, 2);
    assert.deepEqual(report.duplicates, []);
  });

  test('rows that differ only in their note are not duplicates', () => {
    const text = [
      'Format,Version,Product,Product Version,Exported Date',
      'X,2.0,Norton Password Manager (Extension),1,1/1/2026 00:00',
      'Item Type,User Name,Password,Site Name,Login URL,Notes,Secure,Favorite',
      'login,u,p,S,https://s.example.com,first,false,false',
      'login,u,p,S,https://s.example.com,second,false,false',
    ].join('\n');
    assert.equal(convert(text).rows.length, 2);
  });
});

describe('sections and columns', () => {
  test('matches columns by name, not position', () => {
    const text = [
      'Format,Version,Product,Product Version,Exported Date',
      'X,2.0,Norton Password Manager (Extension),1,1/1/2026 00:00',
      'Item Type,Login URL,Password,Notes,User Name,Site Name',
      'LOGIN ,https://s.example.com,pw,n,me@example.com,Site',
    ].join('\n');
    const [row] = convert(text).rows;
    assert.deepEqual(
      { name: row.name, url: row.url, email: row.email, password: row.password, note: row.note, vault: row.vault },
      { name: 'Site', url: 'https://s.example.com', email: 'me@example.com', password: 'pw', note: 'n', vault: 'Norton Import' },
    );
  });

  test('extra cells are trimmed with a warning', () => {
    const text = [
      'Format,Version,Product,Product Version,Exported Date',
      'X,2.0,Norton Password Manager (Extension),1,1/1/2026 00:00',
      'Item Type,User Name,Password,Site Name,Login URL,Notes,Secure,Favorite',
      'login,u,p,S,https://s.example.com,,false,false,extra',
    ].join('\n');
    const { rows, report } = convert(text);
    assert.equal(rows.length, 1);
    assert.deepEqual(report.warnings.map((w) => w.kind), ['cell-count']);
  });
});
