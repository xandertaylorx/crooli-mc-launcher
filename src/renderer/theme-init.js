// Runs before the page paints so there is no flash of the wrong theme.
// Light mode is switched off for now: set this to true (and remove `hidden` from #theme-toggle in index.html) to bring it back.
var CROOLI_LIGHT_MODE = false;
try { if (CROOLI_LIGHT_MODE && localStorage.getItem('crooli-mc.theme') === 'light') document.documentElement.dataset.theme = 'light'; } catch (e) {}
