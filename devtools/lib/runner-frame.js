// Runs a tool-specific runner script inside a sandboxed iframe with its own
// import map, so each gcode-preview version loads in isolation.
//
// Protocol (runner → parent):
//   { type: 'ready' }                — runner loaded; parent replies { type: 'run', ...payload }
//   { type: 'phase', phase }         — coarse progress, forwarded to onPhase
//   { type: 'progress', ...data }    — streaming data points, forwarded to onProgress
//   { type: 'result', result }       — resolves the returned promise with `result`
//   { type: 'error', message }       — rejects the returned promise

// The srcdoc scaffold every runner iframe boots from: an import map pinning
// this run's library versions, a dark full-bleed canvas, and the runner module.
export function frameSrcdoc(importMap, runnerUrl) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <script type="importmap">${JSON.stringify(importMap)}</script>
  <style>html, body { margin: 0; height: 100%; overflow: hidden; background: #0a0a0a; } canvas { width: 100%; height: 100%; display: block; }</style>
</head>
<body>
  <canvas id="canvas"></canvas>
  <script type="module" src="${runnerUrl}"></script>
</body>
</html>`;
}

export function runInIframe({ holder, importMap, runnerUrl, payload, onPhase, onProgress, timeoutMs = 180_000 }) {
  return new Promise((resolve, reject) => {
    holder.replaceChildren();
    const iframe = document.createElement('iframe');
    let settled = false;

    const timeout = setTimeout(() => {
      fail(new Error('run timed out'));
    }, timeoutMs);

    const finish = (settle) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      window.removeEventListener('message', onMessage);
      settle();
    };

    // On failure the iframe is torn down too: a runner that hung or threw may
    // still be running the library's perpetual rAF render loop, which would
    // keep stealing GPU time from every later run. On success the iframe
    // stays — the finished model remaining visible in the panel is a feature
    // (runners dispose their previews, which leaves the last frame on screen).
    const fail = (error) => {
      finish(() => {
        iframe.remove();
        reject(error);
      });
    };

    const onMessage = (event) => {
      if (event.source !== iframe.contentWindow) return;
      const message = event.data;
      // A null/primitive/shapeless message must not throw here: this listener
      // runs outside the promise chain, so an exception would strand the run
      // until the timeout fires with a misleading "run timed out".
      if (!message || typeof message.type !== 'string') return;
      switch (message.type) {
        case 'ready':
          iframe.contentWindow.postMessage({ type: 'run', ...payload }, '*');
          break;
        case 'phase':
          onPhase?.(message.phase);
          break;
        case 'progress':
          onProgress?.(message);
          break;
        case 'result':
          finish(() => resolve(message.result));
          break;
        case 'error':
          fail(new Error(message.message));
          break;
      }
    };

    window.addEventListener('message', onMessage);
    iframe.srcdoc = frameSrcdoc(importMap, runnerUrl);
    holder.appendChild(iframe);
  });
}
