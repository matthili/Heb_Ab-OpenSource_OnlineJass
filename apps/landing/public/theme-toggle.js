// Theme-Toggle: hell → dunkel → hoher Kontrast → hell.
// Labels folgen der Seitensprache (<html lang>). Ausgelagert aus Base.astro
// (war inline), damit die strenge CSP (script-src 'self') es nicht blockt.
(function () {
  var btn = document.getElementById("theme-toggle");
  if (!btn) return;
  var NEXT = { default: "dark", dark: "hi-contrast", "hi-contrast": "default" };
  var LABELS = {
    de: {
      default: "Dunkles Design aktivieren",
      dark: "Hohen Kontrast aktivieren",
      "hi-contrast": "Helles Design aktivieren",
    },
    en: {
      default: "Switch to dark theme",
      dark: "Switch to high contrast",
      "hi-contrast": "Switch to light theme",
    },
  };
  var lang = document.documentElement.lang === "en" ? "en" : "de";
  function current() {
    var t = document.documentElement.getAttribute("data-theme");
    return t === "dark" || t === "hi-contrast" ? t : "default";
  }
  function refreshTitle() {
    btn.title = LABELS[lang][current()];
  }
  btn.addEventListener("click", function () {
    var next = NEXT[current()];
    try {
      if (next === "default") localStorage.removeItem("jass-theme");
      else localStorage.setItem("jass-theme", next);
    } catch (e) {
      /* Privacy-Modus: Theme gilt dann nur für diese Seite */
    }
    if (next === "default") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", next);
    refreshTitle();
  });
  refreshTitle();
})();
