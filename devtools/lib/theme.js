// Shared devtools theme switcher. Loaded as a SYNCHRONOUS classic script in
// <head> (not a module) so data-theme lands on <html> before first paint —
// no flash of the wrong theme. Persists the choice under one key, treats
// storage as hostile (bad value → dark), and announces changes on document
// as 'devtools-themechange' for pages that draw with theme colors (the
// memory-leak heap chart).
(() => {
  const KEY = 'gcode-preview-devtools:theme';

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
