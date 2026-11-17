// Harvested benchmark runs, kept in localStorage.
//
// A commit sweep measures one build per page session but spans many sessions
// (and many checkouts), so the numbers have to outlive both. localStorage is
// per-origin and survives reloads, rebuilds and branch switches; the download
// helpers below are how a sweep leaves the browser as a file.

const KEY = 'gcode-preview-devtools:bench-history';

export function loadHistory() {
  try {
    const raw = localStorage.getItem(KEY);
    const entries = raw ? JSON.parse(raw) : [];
    return Array.isArray(entries) ? entries : [];
  } catch (error) {
    console.warn('Could not read benchmark history', error);
    return [];
  }
}

function save(entries) {
  try {
    localStorage.setItem(KEY, JSON.stringify(entries));
  } catch (error) {
    console.warn('Could not write benchmark history', error);
  }
  return entries;
}

// One measurement per (version, file, geometry, runs): re-running a commit
// replaces its row instead of stacking near-duplicates.
export const runKey = (entry) => [entry.version, entry.preset, entry.renderMode, entry.runCount].join('|');

export function upsertRun(entry) {
  const entries = loadHistory().filter((existing) => runKey(existing) !== runKey(entry));
  entries.push(entry);
  return save(entries);
}

export function removeRun(key) {
  return save(loadHistory().filter((entry) => runKey(entry) !== key));
}

export function clearHistory() {
  return save([]);
}

// Groups are what's actually comparable: same file, same geometry, same run
// count. Within a group, commit builds come first in commit order (the sweep's
// history order), then anything else by when it was measured.
export function groupHistory(entries) {
  const groups = new Map();
  for (const entry of entries) {
    const key = [entry.preset, entry.renderMode, entry.runCount].join('|');
    if (!groups.has(key)) {
      groups.set(key, { key, preset: entry.preset, renderMode: entry.renderMode, runCount: entry.runCount, runs: [] });
    }
    groups.get(key).runs.push(entry);
  }
  for (const group of groups.values()) {
    group.runs.sort((a, b) => {
      if (a.date && b.date && a.date !== b.date) return a.date < b.date ? -1 : 1;
      if (Boolean(a.date) !== Boolean(b.date)) return a.date ? -1 : 1;
      return (a.at ?? '') < (b.at ?? '') ? -1 : 1;
    });
  }
  return [...groups.values()];
}

export function downloadFile(filename, text, mime) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoking immediately can beat the download in some browsers; one turn of
  // the event loop is enough for the click to have been handed off.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export const timestampSlug = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
