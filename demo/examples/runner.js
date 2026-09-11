/**
 * Shared page chrome for the examples.
 *
 * Every example page shows its own code in an editable panel and runs it on
 * demand. The code runs inside an iframe the runner rebuilds from scratch on
 * every Run: a fresh document is a complete teardown, so an example never has
 * to dispose of a WebGL context, cancel an animation loop or undo its own
 * event listeners just to be re-runnable.
 *
 * A page supplies three things and nothing else:
 *
 *   <script type="importmap">              the bare specifiers the code imports
 *   <template id="output">                 markup (and styles) the code runs against
 *   <script type="text/plain" id="code">   the example itself
 *
 * The runner is page furniture, not part of any example: what you copy is the
 * code in the editor plus the page setup shown underneath it.
 */

const codeEl = document.querySelector('#code');
const outputEl = document.querySelector('#output');
const importmapEl = document.querySelector('script[type="importmap"]');

const editor = document.querySelector('textarea');
const frame = document.querySelector('iframe');
const status = document.querySelector('#status');

/** Left-trims a block of indented HTML-embedded source back to column zero. */
function dedent(source) {
  const lines = source.replace(/^\n/, '').trimEnd().split('\n');
  const indent = Math.min(...lines.filter((line) => line.trim()).map((line) => line.match(/^ */)[0].length));

  return lines.map((line) => line.slice(indent)).join('\n');
}

const original = dedent(codeEl.textContent);
const markup = dedent(outputEl.innerHTML);
const importmap = dedent(importmapEl.textContent);

/**
 * Assembles the document for one run.
 *
 * The iframe is a srcdoc frame, so it inherits this page's base URL and the
 * `../dist` and `../lib` paths in the importmap resolve exactly as they would
 * in a standalone page next to this one.
 */
function documentFor(code) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<style>body { margin: 0; background: #eee; color: #222; font: 14px/1.5 system-ui, sans-serif; }</style>
<script type="importmap">${importmap}</script>
<script>
  const post = (message) => parent.postMessage({ example: message }, '*');
  addEventListener('error', (event) => post({ error: event.message }));
  addEventListener('unhandledrejection', (event) => post({ error: String(event.reason?.message ?? event.reason) }));
</script>
</head>
<body>
${markup}
<script type="module">
${code.replaceAll('</script', '<\\/script')}
// Reported from inside the example's own module, not a later one: a module
// that follows this one is not held up by its top-level await.
;post({ done: true });
</script>
</body>
</html>`;
}

let failed = false;

function report(text, isError) {
  status.textContent = text;
  status.classList.toggle('error', Boolean(isError));
}

function run() {
  failed = false;
  report('Running…');
  // Assigning srcdoc discards the previous document: its WebGL context,
  // timers and listeners go with it.
  frame.srcdoc = documentFor(editor.value);
}

// An example reports through the preamble the runner injects, so a run that
// throws says so here rather than only in the console.
addEventListener('message', (event) => {
  if (event.source !== frame.contentWindow || !event.data?.example) return;
  const { error, done } = event.data.example;
  if (error) {
    failed = true;
    report(error, true);
  } else if (done && !failed) {
    report(`Ran at ${new Date().toLocaleTimeString()}`);
  }
});

editor.value = original;
document.querySelector('#run').addEventListener('click', run);
document.querySelector('#reset').addEventListener('click', () => {
  editor.value = original;
  run();
});

editor.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    run();
  }
  // A textarea would otherwise move focus out of the editor on Tab.
  if (event.key === 'Tab') {
    event.preventDefault();
    const { selectionStart: start, selectionEnd: end, value } = editor;
    editor.value = `${value.slice(0, start)}  ${value.slice(end)}`;
    editor.selectionStart = editor.selectionEnd = start + 2;
  }
});

// The rest of the page a copy of the editor's code needs to run.
document.querySelector('#setup').textContent =
  `<script type="importmap">${importmap}</script>\n\n${markup}\n\n<script type="module">\n  …the code above…\n</script>`;

run();
