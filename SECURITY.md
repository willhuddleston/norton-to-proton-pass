# Security policy

This tool handles password exports, so security reports are taken seriously.

## Supported versions

Only the [latest release](https://github.com/willhuddleston/norton-to-proton-pass/releases/latest) gets security fixes.

## Reporting a vulnerability

**Please don't open a public issue for a security problem.** Report it privately using GitHub's [private vulnerability reporting](https://github.com/willhuddleston/norton-to-proton-pass/security/advisories/new): open the repository's **Security** tab and click **Report a vulnerability**.

Please include:

- what the problem is and what an attacker could do with it
- the steps to reproduce it, including browser and version
- if a file is needed, a **synthetic** Norton export that shows the problem

**Never send a real password export,** not even a partial or "anonymised" one. Build a small file with fake data instead. See the files in [`test/fixtures/`](test/fixtures/) for the format.

This is a personal open-source project, so fixes are made on a best-effort basis. You'll get an acknowledgement, and you'll be kept updated until the issue is resolved. Credit will be given in the release notes if you'd like it.

## In scope

- Any way password data could leave the browser: network requests, Content-Security-Policy bypasses, links or downloads that leak data
- Data being stored or left behind: browser storage, cookies, console output, or data that survives **Clear everything**
- Script injection through crafted export content (for example, a site name or note that runs as code)
- A released file whose checksum doesn't match, or that differs from what the source builds
- Conversion bugs that silently lose or change a password, user name or URL

## Out of scope

- Attacks that need control of your computer or browser already (malware, malicious browser extensions)
- The security of Norton Password Manager or Proton Pass themselves. Report those to Norton or Proton.
- The unencrypted export file left on your disk after you finish. The README tells you to delete it.

## How the tool protects your data

See the [Security section of the README](README.md#security).
