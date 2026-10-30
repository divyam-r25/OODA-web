// Runs before first paint (kept external so the CSP can stay script-src 'self').
try {
  var t = localStorage.getItem('ooda-theme');
  if (t === 'dark' || t === 'light') document.documentElement.setAttribute('data-theme', t);
} catch (e) {}
