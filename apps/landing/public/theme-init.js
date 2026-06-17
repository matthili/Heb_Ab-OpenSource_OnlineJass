// Theme VOR dem ersten Paint anwenden — gleicher Key wie die Spiel-SPA.
// Ausgelagert aus Base.astro (war inline), damit die strenge CSP
// (script-src 'self', ohne 'unsafe-inline') es nicht blockt.
(function () {
  try {
    var t = localStorage.getItem("jass-theme");
    if (t === "dark" || t === "hi-contrast") {
      document.documentElement.setAttribute("data-theme", t);
    }
  } catch (e) {
    /* localStorage gesperrt (Privacy-Modus) → Default hell */
  }
})();
