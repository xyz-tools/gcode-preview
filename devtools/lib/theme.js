// Shared devtools theme switcher. Loaded as a SYNCHRONOUS classic script in
// <head> (not a module) so data-theme lands on <html> before first paint —
// no flash of the wrong theme. Persists the choice under one key, treats
// storage as hostile (bad value → dark), and announces changes on document
// as 'devtools-themechange' for pages that draw with theme colors (the
// memory-leak heap chart).
(() => {
  const KEY = 'gcode-preview-devtools:theme';

  // The pages link /style.css, which is the demo's stylesheet only when the
  // demo is the server root; under a repo-root server it lives at /demo/.
  // Both are linked and whichever isn't there 404s harmlessly — a probe would
  // have to be async, and a stylesheet arriving late is a flash of unstyled
  // page. This script is classic and synchronous, so currentScript is us.
  //
  // It goes in NEXT TO the existing link, not here at the script: theme.css is
  // linked between the two and must keep winning over the demo's stylesheet
  // (its whole contract is "linked AFTER /style.css").
  const here = document.currentScript?.src;
  const demoStylesheet = document.querySelector('link[rel="stylesheet"][href="/style.css"]');
  if (here && demoStylesheet) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = new URL('../../demo/style.css', here).href;
    demoStylesheet.parentNode.insertBefore(link, demoStylesheet.nextSibling);
  }

  const readStored = () => {
    try {
      const value = localStorage.getItem(KEY);
      return value === 'light' || value === 'dark' ? value : 'dark';
    } catch {
      return 'dark';
    }
  };

  const apply = (theme) => {
    document.documentElement.dataset.theme = theme;
    const button = document.getElementById('theme-toggle');
    // the label names the mode the button switches TO
    if (button) button.textContent = theme === 'dark' ? 'Light' : 'Dark';
    document.dispatchEvent(new CustomEvent('devtools-themechange', { detail: { theme } }));
  };

  apply(readStored());

  document.addEventListener('DOMContentLoaded', () => {
    apply(readStored()); // sets the button label now that the button exists
    document.getElementById('theme-toggle')?.addEventListener('click', () => {
      const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      try {
        localStorage.setItem(KEY, next);
      } catch {
        // storage unavailable — the toggle still works for this page view
      }
      apply(next);
    });
  });
})();
