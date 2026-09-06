// Runs a tool-specific runner script inside a sandboxed iframe with its own
// import map, so each gcode-preview version loads in isolation.
//
// Protocol (runner → parent):
//   { type: 'ready' }                — runner loaded; parent replies { type: 'run', ...payload }
//   { type: 'phase', phase }         — coarse progress, forwarded to onPhase
//   { type: 'progress', ...data }    — streaming data points, forwarded to onProgress
//   { type: 'result', result }       — resolves the returned promise with `result`
//   { type: 'error', message }       — rejects the returned promise

export function runInIframe({ holder, importMap, runnerUrl, payload, onPhase, onProgress, timeoutMs = 180_000 }) {
  return new Promise((resolve, reject) => {
    holder.replaceChildren();
    const iframe = document.createElement('iframe');
    let settled = false;

    const timeout = setTimeout(() => {
      finish(() => reject(new Error('run timed out')));
    }, timeoutMs);

    const finish = (settle) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      window.removeEventListener('message', onMessage);
      settle();
    };

    const onMessage = (event) => {
      if (event.source !== iframe.contentWindow) return;
      const message = event.data;
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
          finish(() => reject(new Error(message.message)));
          break;
      }
    };

    window.addEventListener('message', onMessage);
    iframe.srcdoc = `<!DOCTYPE html>
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
    holder.appendChild(iframe);
  });
}
