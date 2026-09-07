// Shared scaffolding for the devtools entry scripts: tiny DOM helpers, HTML
// escaping, the median used for aggregate rows, and the run-button wrapper.

export const el = (id) => document.getElementById(id);

// Every tool page has one #status line; errors also flip its .error class.
export function setStatus(message, isError = false) {
  const status = el('status');
  status.textContent = message;
  status.classList.toggle('error', isError);
}

export const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// Median of the finite values; undefined when none are (e.g. heap metrics in
// browsers without performance.memory), which renders as "n/a".
export function median(values) {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (sorted.length === 0) return undefined;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// Wires a run button to its async action: disabled while running, and a
// failure lands in the console and the status line as "<label> failed: …".
export function runWithButton(button, label, action) {
  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      await action();
    } catch (error) {
      console.error(error);
      setStatus(`${label} failed: ${error.message}`, true);
    } finally {
      button.disabled = false;
    }
  });
}
