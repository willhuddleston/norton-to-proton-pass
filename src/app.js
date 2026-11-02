/*
 * UI wiring. All conversion logic lives in converter.js.
 * Security rules: no network, no storage, no console output, and file data only
 * reaches the page through textContent (never innerHTML).
 */
(function () {
  'use strict';

  const { convert } = window.NortonToProton;
  const DOWNLOAD_NAME = 'proton-pass-import.csv';
  const MASK = '••••••••';

  const $ = (id) => document.getElementById(id);
  const el = {
    clear: $('clear'),
    dropZone: $('drop-zone'),
    browse: $('browse'),
    fileInput: $('file-input'),
    fileName: $('file-name'),
    error: $('error'),
    review: $('review'),
    summary: $('summary'),
    skippedList: $('skipped-list'),
    warningsPanel: $('warnings-panel'),
    warningsSummary: $('warnings-summary'),
    warningsList: $('warnings-list'),
    duplicatesPanel: $('duplicates-panel'),
    duplicatesSummary: $('duplicates-summary'),
    duplicatesList: $('duplicates-list'),
    filter: $('filter'),
    filterAll: $('filter-all'),
    filterEmail: $('filter-email'),
    filterUsername: $('filter-username'),
    reveal: $('reveal'),
    previewBody: $('preview-body'),
    noRows: $('no-rows'),
    optionsStep: $('options-step'),
    advanced: $('advanced'),
    options: $('options'),
    favLabel: $('opt-fav-label'),
    downloadStep: $('download-step'),
    download: $('download'),
    downloadEmpty: $('download-empty'),
    checklist: $('checklist'),
    groupNames: $('group-names'),
  };

  // The only place file data is held. "Clear everything" sets it back to null.
  let state = null; // { text, fileName, result }
  let revealed = false;
  let loadCounter = 0;

  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

  // ------------------------------------------------------------ options

  function readOptions() {
    const form = el.options.elements;
    return {
      userNameMode: form.userNameMode.value,
      vaultLabel: form.vaultLabel.value,
      favourites: form.favourites.value,
      favouritesLabel: form.favouritesLabel.value,
      duplicates: form.duplicates.value,
    };
  }

  function resetOptions() {
    el.options.reset(); // back to the defaults written in index.html
    syncFavouriteLabel();
  }

  function syncFavouriteLabel() {
    el.favLabel.disabled = el.options.elements.favourites.value !== 'own';
  }

  // ------------------------------------------------------------ loading

  async function loadFile(file) {
    if (!file) return;
    const id = ++loadCounter;
    let text;
    try {
      text = await file.text();
    } catch (_) {
      if (id === loadCounter) showError("This file couldn't be read.");
      return;
    }
    if (id !== loadCounter) return; // a newer file was chosen meanwhile
    state = { text, fileName: file.name, result: null };
    el.fileName.textContent = file.name;
    el.fileName.hidden = false;
    el.clear.hidden = false;
    run();
  }

  function run() {
    if (!state) return;
    try {
      state.result = convert(state.text, readOptions());
    } catch (err) {
      state.result = null;
      showError(err && err.name === 'ConversionError' ? err.message : "Something went wrong while reading this file.");
      return;
    }
    el.error.hidden = true;
    el.error.textContent = '';
    render();
  }

  function showError(message) {
    el.error.textContent = message;
    el.error.hidden = false;
    setResultsVisible(false);
  }

  function setResultsVisible(visible) {
    el.review.hidden = !visible;
    el.optionsStep.hidden = !visible;
    el.downloadStep.hidden = !visible;
  }

  // ------------------------------------------------------------ rendering

  function render() {
    const { rows, report } = state.result;
    setResultsVisible(true);
    renderSummary(report);
    renderList(el.warningsPanel, el.warningsSummary, el.warningsList, report.warnings, (n) => plural(n, 'warning', 'warnings'));
    renderList(el.duplicatesPanel, el.duplicatesSummary, el.duplicatesList, report.duplicates, (n) => plural(n, 'duplicate skipped', 'duplicates skipped'));
    renderFilterCounts(rows);
    renderTable();
    renderDownload(rows);
  }

  function renderSummary(report) {
    const parts = [plural(report.converted, 'login ready', 'logins ready')];
    for (const s of report.skipped) {
      parts.push(s.type === 'notes' ? `${plural(s.count, 'note', 'notes')} skipped` : `${plural(s.count, `“${s.type}” item`, `“${s.type}” items`)} skipped`);
    }
    if (report.duplicates.length) parts.push(plural(report.duplicates.length, 'duplicate skipped', 'duplicates skipped'));
    if (report.warnings.length) parts.push(plural(report.warnings.length, 'warning', 'warnings'));
    el.summary.textContent = parts.join(' · ');

    el.skippedList.replaceChildren(...report.skipped.map((s) => li(s.message)));
    el.skippedList.hidden = report.skipped.length === 0;
  }

  function renderList(panel, summary, list, items, label) {
    panel.hidden = items.length === 0;
    summary.textContent = label(items.length);
    list.replaceChildren(...items.map((item) => li(item.message)));
  }

  function renderFilterCounts(rows) {
    const email = rows.filter((r) => r.userField === 'email' || r.userField === 'both').length;
    const username = rows.filter((r) => r.userField === 'username' || r.userField === 'both').length;
    el.filterAll.textContent = `All (${rows.length})`;
    el.filterEmail.textContent = `Email (${email})`;
    el.filterUsername.textContent = `Username (${username})`;
  }

  function currentFilter() {
    return el.filter.querySelector('input[name="filter"]:checked').value;
  }

  function renderTable() {
    if (!state || !state.result) return;
    const filter = currentFilter();
    const rows = state.result.rows.filter((r) =>
      filter === 'all' ||
      r.userField === filter ||
      r.userField === 'both');

    const fragment = document.createDocumentFragment();
    for (const r of rows) {
      const tr = document.createElement('tr');
      tr.append(
        td(r.name),
        td(r.url),
        td(r.email),
        td(r.username),
        passwordCell(r.password),
        td(r.vault),
      );
      fragment.append(tr);
    }
    el.previewBody.replaceChildren(fragment);
    el.noRows.hidden = rows.length > 0;
  }

  function renderDownload(rows) {
    el.download.disabled = rows.length === 0;
    el.downloadEmpty.hidden = rows.length > 0;
    const groups = [...new Set(rows.map((r) => r.vault))].map((v) => (v === '' ? '(no label)' : `“${v}”`));
    el.groupNames.textContent = groups.length > 1
      ? `${groups.slice(0, -1).join(', ')} and ${groups[groups.length - 1]}`
      : groups.join('');
  }

  function td(text) {
    const cell = document.createElement('td');
    cell.textContent = text;
    return cell;
  }

  function passwordCell(password) {
    const cell = document.createElement('td');
    cell.className = 'password';
    if (password === '') {
      const span = document.createElement('span');
      span.className = 'empty';
      span.textContent = '(empty)';
      cell.append(span);
    } else {
      cell.textContent = revealed ? password : MASK;
    }
    return cell;
  }

  function li(text) {
    const item = document.createElement('li');
    item.textContent = text;
    return item;
  }

  function setRevealed(value) {
    revealed = value;
    el.reveal.setAttribute('aria-pressed', String(value));
    el.reveal.textContent = value ? 'Hide passwords' : 'Show passwords';
  }

  // ------------------------------------------------------------ download

  function download() {
    if (!state || !state.result || state.result.rows.length === 0) return;
    const blob = new Blob([state.result.csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = DOWNLOAD_NAME;
    document.body.append(link);
    link.click();
    link.remove();
    // Revoked on the next tick: revoking in the same tick can cancel the
    // download in some browsers.
    setTimeout(() => URL.revokeObjectURL(url), 0);
    el.checklist.hidden = false;
  }

  // ------------------------------------------------------------ clear

  function clearEverything() {
    loadCounter++; // ignore any file still being read
    state = null;
    el.fileInput.value = '';
    el.fileName.textContent = '';
    el.fileName.hidden = true;
    el.error.textContent = '';
    el.error.hidden = true;
    el.summary.textContent = '';
    el.groupNames.textContent = '';
    for (const node of [el.skippedList, el.warningsList, el.duplicatesList, el.previewBody]) {
      node.replaceChildren();
    }
    el.warningsPanel.open = false;
    el.duplicatesPanel.open = false;
    el.filter.querySelector('input[value="all"]').checked = true;
    setRevealed(false);
    resetOptions();
    el.advanced.open = false;
    el.checklist.hidden = true;
    setResultsVisible(false);
    el.clear.hidden = true;
    el.browse.focus();
  }

  // ------------------------------------------------------------ events

  el.browse.addEventListener('click', () => el.fileInput.click());
  el.fileInput.addEventListener('change', () => loadFile(el.fileInput.files[0]));

  // Stop a file dropped outside the drop zone from opening in the browser.
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());

  let dragDepth = 0;
  el.dropZone.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragDepth++;
    el.dropZone.classList.add('dragging');
  });
  el.dropZone.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) el.dropZone.classList.remove('dragging');
  });
  el.dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0;
    el.dropZone.classList.remove('dragging');
    const file = e.dataTransfer && e.dataTransfer.files[0];
    loadFile(file);
  });

  el.reveal.addEventListener('click', () => {
    setRevealed(!revealed);
    renderTable();
  });
  el.filter.addEventListener('change', renderTable);

  el.options.addEventListener('input', () => {
    syncFavouriteLabel();
    run();
  });
  el.options.addEventListener('change', () => {
    syncFavouriteLabel();
    run();
  });
  el.options.addEventListener('submit', (e) => e.preventDefault());

  el.download.addEventListener('click', download);
  el.clear.addEventListener('click', clearEverything);

  syncFavouriteLabel();
})();
