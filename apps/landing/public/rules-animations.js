// Demo-Animationen der Jass-Schule: starten beim Hereinscrollen, ↻ spielt
// erneut ab. Ausgelagert aus RulesPage.astro (war inline), damit die strenge
// CSP (script-src 'self', ohne 'unsafe-inline') es nicht blockt.
(function () {
  var els = document.querySelectorAll(".anim");
  if (!("IntersectionObserver" in window)) {
    els.forEach(function (e) {
      e.classList.add("play");
    });
  } else {
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting) {
            en.target.classList.add("play");
            io.unobserve(en.target);
          }
        });
      },
      { threshold: 0.35 }
    );
    els.forEach(function (e) {
      io.observe(e);
    });
  }
  document.addEventListener("click", function (ev) {
    var btn = ev.target && ev.target.closest ? ev.target.closest(".replay") : null;
    if (!btn) return;
    var anim = btn.closest(".anim");
    if (!anim) return;
    anim.classList.remove("play");
    void anim.offsetWidth; // Reflow erzwingen → Animationen starten neu
    anim.classList.add("play");
  });
})();
