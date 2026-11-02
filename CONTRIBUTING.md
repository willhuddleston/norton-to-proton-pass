# Contributing

Thanks for helping. Bug reports, fixes and samples of new Norton item types are all welcome.

## Never share a real export

**Never attach a real Norton or Proton export to an issue, pull request or discussion, not even a partial or "anonymised" one.** These files contain your passwords unencrypted, and anything posted on GitHub should be treated as public forever.

To show a problem, make a small **synthetic** file with obviously fake data instead (`example.com` addresses, passwords like `Fake-Pass-001`). Copy the structure of the files in [`test/fixtures/`](test/fixtures/).

If you accidentally post real data, delete it straight away and change the affected passwords.

## Reporting a bug

Open an issue and include:

- what you expected and what happened
- the summary line and any warnings the tool showed (check that they contain no real site names or user names you'd rather keep private)
- your browser and version, and the Norton product and version from the second line of your export (for example `Norton Password Manager (Extension), 8.3.1.1559`)
- if a file is needed, a synthetic one as described above

For security problems, follow [SECURITY.md](SECURITY.md) instead of opening an issue.

## Adding a new item type

Version 1 converts logins only. To add cards, addresses or other types, we need each section's **header row**: the line that starts with `Item Type`. For example:

```
Item Type,Card Name,Card Number,Secure,Favorite
```

The header row contains only column names, so it's safe to share. **Don't include the rows below it.** Open an issue with the header row and the Item Type value used in those rows (for example `creditcard`).

## Development

You need [Node.js](https://nodejs.org/) (current LTS). There are no dependencies to install.

```sh
npm test         # run all tests
npm run build    # creates dist/norton-to-proton-pass.html
```

During development, open `src/index.html` directly in a browser.

### How the code is organised

| Path | What it does |
| --- | --- |
| `src/converter.js` | All conversion logic: CSV parser, sections, item-type mappers, CSV writer and report. A pure module with no access to the page, network or storage. Works as a browser global and as a Node module. |
| `src/app.js` | Connects the page to the converter. |
| `src/index.html` | The page and its styles. |
| `scripts/build.js` | Inlines both scripts and adds the Content-Security-Policy, producing the single release file. |
| `test/converter.test.js` | Converter tests (`node:test`). |
| `test/security.test.js` | Static checks of the security rules, and of the built file's CSP. |
| `test/fixtures/` | Synthetic Norton exports and the expected Proton output. |

New item types are added as a mapper in the `MAPPERS` table in `src/converter.js`.

### Rules for changes

- **No runtime dependencies,** and no ES modules (they don't load from `file://`).
- **No network, storage or logging.** No `fetch`, `XMLHttpRequest`, `localStorage`, cookies or `console` calls. `test/security.test.js` enforces this.
- **Put file data on the page with `textContent` only,** never `innerHTML`.
- **Behaviour changes come with tests.** Converter changes need tests in `test/converter.test.js`, and new cases go in a synthetic fixture where it makes sense.
- **Don't let anything rewrite the fixtures.** They are byte-exact: some have a byte-order mark and Windows (CRLF) line endings on purpose. `.gitattributes` stops Git converting them, so don't let your editor change them either.

### Pull requests

1. Fork the repository and create a branch.
2. Make your change, with tests.
3. Run `npm test` and `npm run build`. Both must pass, and CI checks them on Ubuntu and Windows.
4. Open a pull request that explains what changed and why.

By contributing, you agree that your contribution is licensed under the [MIT License](LICENSE).
