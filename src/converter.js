/*
 * Norton Password Manager CSV -> Proton Pass Generic CSV.
 *
 * Pure logic: no DOM, no network, no storage, no logging. Text in, rows + report out.
 * Loaded as a classic script in the browser (global `NortonToProton`) and with
 * require() in Node, so it works from file:// without ES modules.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.NortonToProton = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const PROTON_HEADER = ['name', 'url', 'email', 'username', 'password', 'note', 'totp', 'vault'];
  const REQUIRED_LOGIN_COLUMNS = ['User Name', 'Password', 'Site Name', 'Login URL', 'Notes'];
  const NOT_NORTON_MESSAGE = "This doesn't look like a Norton Password Manager export.";
  const UNTITLED = 'Untitled login';
  const FAVOURITE_NOTE = 'Norton favourite';
  const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@.]{2,}$/u;
  const SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:\/\//i;

  const DEFAULT_OPTIONS = Object.freeze({
    userNameMode: 'auto', // 'auto' | 'username' | 'email' | 'both'
    vaultLabel: 'Norton Import',
    favourites: 'own', // 'own' | 'same' | 'note'
    favouritesLabel: 'Norton Favourites',
    duplicates: 'skip', // 'skip' | 'keep'
  });

  class ConversionError extends Error {
    constructor(code, message, details) {
      super(message);
      this.name = 'ConversionError';
      this.code = code;
      Object.assign(this, details);
    }
  }

  // ---------------------------------------------------------------- CSV parser

  // RFC 4180 parser. Returns [{ cells, line }], where line is the 1-based
  // physical line the record starts on. Newlines inside quotes are kept as-is.
  function parseRecords(text) {
    const records = [];
    let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
    let line = 1;
    let cells = [];
    let field = '';
    let recordLine = 1;
    let inQuotes = false;
    let rowHasContent = false;

    const endField = () => {
      cells.push(field);
      field = '';
    };
    const endRecord = () => {
      endField();
      records.push({ cells, line: recordLine });
      cells = [];
      rowHasContent = false;
    };

    while (i < text.length) {
      const ch = text[i];
      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i += 2;
            continue;
          }
          inQuotes = false;
        } else {
          if (ch === '\n') line++;
          field += ch;
        }
        i++;
        continue;
      }
      if (ch === '"' && field === '') {
        inQuotes = true;
        rowHasContent = true;
      } else if (ch === ',') {
        endField();
        rowHasContent = true;
      } else if (ch === '\r' || ch === '\n') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        endRecord();
        line++;
        recordLine = line;
      } else {
        field += ch;
        rowHasContent = true;
      }
      i++;
    }
    if (rowHasContent || field !== '' || cells.length > 0) endRecord();
    return records;
  }

  function parseCsv(text) {
    return parseRecords(text).map((r) => r.cells);
  }

  // ---------------------------------------------------------------- CSV writer

  function writeCsv(rows) {
    return rows
      .map((row) => row.map((v) => '"' + String(v).replace(/"/g, '""') + '"').join(',') + '\r\n')
      .join('');
  }

  function toProtonCsv(rows) {
    return writeCsv([PROTON_HEADER].concat(rows.map((r) => PROTON_HEADER.map((col) => r[col]))));
  }

  // ---------------------------------------------------------------- helpers

  function looksLikeEmail(value) {
    return EMAIL_PATTERN.test(String(value).trim());
  }

  function hasScheme(url) {
    return SCHEME_PATTERN.test(url.trim());
  }

  // Extracted by hand rather than with URL(), which would turn non-English
  // domains into punycode and can't parse URLs without a scheme.
  function hostnameOf(url) {
    let host = url.trim().replace(SCHEME_PATTERN, '');
    host = host.split(/[/?#\\]/)[0];
    host = host.slice(host.lastIndexOf('@') + 1);
    host = host.replace(/:\d*$/, '').toLowerCase();
    return host.replace(/^www\./, '');
  }

  const isBlankRecord = (cells) => cells.every((c) => c.trim() === '');
  const isHeaderRecord = (cells) => cells[0].trim().toLowerCase() === 'item type';

  function isNortonHeader(cells) {
    const expected = ['format', 'version', 'product'];
    return cells && expected.every((name, i) => (cells[i] || '').trim().toLowerCase() === name);
  }

  function skippedMessage(type, count) {
    if (type === 'notes') {
      return `${count} ${count === 1 ? 'note' : 'notes'} skipped: not supported by Proton's CSV import yet`;
    }
    return `${count} "${type}" ${count === 1 ? 'item' : 'items'} skipped: not supported in V1`;
  }

  // ---------------------------------------------------------------- mappers

  function mapLogin(get, ctx, options) {
    const warnings = [];
    const userName = get('User Name');
    const password = get('Password');
    const siteName = get('Site Name');
    const url = get('Login URL');
    const notes = get('Notes');
    const favourite = get('Favorite').trim().toLowerCase() === 'true';

    let name = siteName;
    let nameWarning = null;
    if (siteName.trim() === '') {
      name = url.trim() === '' ? '' : hostnameOf(url);
      if (name !== '') {
        nameWarning = 'name-from-url';
      } else {
        name = UNTITLED;
        nameWarning = 'untitled';
      }
    }

    const warn = (kind, text) => warnings.push({ kind, line: ctx.line, site: name, text });
    if (ctx.cellCountMismatch) {
      warn('cell-count', `has ${ctx.cellCount} cells but its header has ${ctx.headerCount}; it was ${ctx.cellCount < ctx.headerCount ? 'padded' : 'trimmed'} to fit`);
    }
    if (nameWarning === 'name-from-url') warn('name-from-url', 'had no site name, so the name was taken from its URL');
    if (url.trim() === '') warn('missing-url', 'has no URL');
    else if (!hasScheme(url)) warn('no-scheme', `URL "${url}" has no scheme (such as https://)`);
    if (password === '') warn('empty-password', 'has an empty password');
    if (nameWarning === 'untitled') warn('untitled', `had no site name or URL, so it was named "${UNTITLED}"`);

    let email = '';
    let username = '';
    let userField = 'none';
    if (userName !== '') {
      const isEmail = looksLikeEmail(userName);
      const mode = options.userNameMode;
      if (mode === 'email' || (mode === 'auto' && isEmail)) {
        email = userName;
        userField = 'email';
      } else if (mode === 'both' && isEmail) {
        email = userName;
        username = userName;
        userField = 'both';
      } else {
        username = userName;
        userField = 'username';
      }
    }

    let note = notes;
    let vault = options.vaultLabel;
    if (favourite && options.favourites === 'own') vault = options.favouritesLabel;
    if (favourite && options.favourites === 'note') {
      note = note === '' ? FAVOURITE_NOTE : note + '\n' + FAVOURITE_NOTE;
    }

    return {
      row: { name, url, email, username, password, note, totp: '', vault, line: ctx.line, userField, favourite },
      duplicateKey: JSON.stringify([name, url, userName, password, notes]),
      warnings,
    };
  }

  // One table of mappers, keyed by lower-case Item Type.
  const MAPPERS = {
    login: { map: mapLogin, required: REQUIRED_LOGIN_COLUMNS },
  };

  // ---------------------------------------------------------------- convert

  function convert(text, userOptions) {
    const options = Object.assign({}, DEFAULT_OPTIONS, userOptions);
    const records = parseRecords(String(text));

    if (records.length === 0 || !isNortonHeader(records[0].cells)) {
      throw new ConversionError('not-norton', NOT_NORTON_MESSAGE);
    }

    // Split into sections: each "Item Type" header row starts a new one.
    const sections = [];
    let current = null;
    for (const record of records.slice(1)) {
      if (isBlankRecord(record.cells)) continue;
      if (isHeaderRecord(record.cells)) {
        current = { columns: record.cells.map((c) => c.trim()), records: [] };
        sections.push(current);
      } else if (current) {
        current.records.push(record);
      }
      // Rows before the first header (the metadata row) are ignored.
    }

    // Check required columns in every section that holds rows of a mapped type.
    for (const section of sections) {
      for (const [type, mapper] of Object.entries(MAPPERS)) {
        const used = section.records.some((r) => r.cells[0].trim().toLowerCase() === type);
        if (!used) continue;
        const missing = mapper.required.filter((col) => !section.columns.includes(col));
        if (missing.length > 0) {
          throw new ConversionError(
            'missing-columns',
            `The ${type} section is missing ${missing.length === 1 ? 'this column' : 'these columns'}: ${missing.join(', ')}.`,
            { missing, itemType: type },
          );
        }
      }
    }

    const rows = [];
    const warnings = [];
    const duplicates = [];
    const skippedCounts = new Map();
    const seen = new Map();

    for (const section of sections) {
      const index = new Map(section.columns.map((name, i) => [name, i]));
      const headerCount = section.columns.length;

      for (const record of section.records) {
        const type = record.cells[0].trim().toLowerCase() || '(no type)';
        const mapper = MAPPERS[type];
        if (!mapper) {
          skippedCounts.set(type, (skippedCounts.get(type) || 0) + 1);
          continue;
        }

        const cells = record.cells.slice(0, headerCount);
        while (cells.length < headerCount) cells.push('');
        const get = (name) => (index.has(name) ? cells[index.get(name)] : '');
        const ctx = {
          line: record.line,
          cellCount: record.cells.length,
          headerCount,
          cellCountMismatch: record.cells.length !== headerCount,
        };

        const result = mapper.map(get, ctx, options);
        if (options.duplicates === 'skip') {
          const firstLine = seen.get(result.duplicateKey);
          if (firstLine !== undefined) {
            duplicates.push({
              line: record.line,
              site: result.row.name,
              firstLine,
              message: `"${result.row.name}" (line ${record.line}) is an exact duplicate of line ${firstLine}`,
            });
            continue;
          }
          seen.set(result.duplicateKey, record.line);
        }

        rows.push(result.row);
        for (const w of result.warnings) {
          warnings.push({ line: w.line, site: w.site, kind: w.kind, message: `"${w.site}" (line ${w.line}) ${w.text}` });
        }
      }
    }

    const skipped = Array.from(skippedCounts, ([type, count]) => ({
      type,
      count,
      message: skippedMessage(type, count),
    }));

    return {
      rows,
      csv: toProtonCsv(rows),
      report: { converted: rows.length, skipped, duplicates, warnings },
    };
  }

  return {
    PROTON_HEADER,
    DEFAULT_OPTIONS,
    ConversionError,
    parseCsv,
    writeCsv,
    toProtonCsv,
    looksLikeEmail,
    convert,
  };
});
