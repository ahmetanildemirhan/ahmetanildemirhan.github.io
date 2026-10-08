// Shared behaviour for every page: language toggle, theme toggle,
// video player, scroll reveal and footer year.
// A page can define `window.TR` (Turkish strings keyed by data-i18n) before
// loading this file, and listen for the "langchange" event to re-render.
(function () {
  const BASE_TR = {
    "nav.work": "İşler",
    "nav.process": "AI Süreci",
    "nav.services": "Hizmetler",
    "nav.experience": "Deneyim",
    "nav.contact": "İletişim",
    "nav.back": "← Tüm işler",
    "footer.loc": "İstanbul, Türkiye",
    "player.close": "Kapat ✕",
    "cv": "CV'yi indir"
  };
  const TR = Object.assign({}, BASE_TR, window.TR || {});
  const root = document.documentElement;

  const site = window.site = {
    lang: "en",
    thumbUrl: (src, id) => src === "yt"
      ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg`
      : `https://drive.google.com/thumbnail?id=${id}&sz=w640`,
    playerUrl: (src, id) => src === "yt"
      ? `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0`
      : `https://drive.google.com/file/d/${id}/preview`
  };

  // ---------- Language ----------
  const i18nEls = document.querySelectorAll("[data-i18n]");
  i18nEls.forEach(el => { el.dataset.en = el.innerHTML; });
  const langBtn = document.getElementById("langBtn");

  site.setLang = function (next) {
    site.lang = next;
    root.lang = next;
    i18nEls.forEach(el => {
      const tr = TR[el.dataset.i18n];
      el.innerHTML = next === "tr" && tr ? tr : el.dataset.en;
    });
    if (langBtn) langBtn.textContent = next === "tr" ? "EN" : "TR";
    try { localStorage.setItem("lang", next); } catch (e) {}
    document.dispatchEvent(new CustomEvent("langchange", { detail: next }));
  };
  if (langBtn) langBtn.addEventListener("click", () => site.setLang(site.lang === "tr" ? "en" : "tr"));

  let saved = null;
  try { saved = localStorage.getItem("lang"); } catch (e) {}
  const initial = saved || ((navigator.language || "").toLowerCase().startsWith("tr") ? "tr" : "en");
  if (initial === "tr") site.setLang("tr");

  // ---------- Theme ----------
  const themeBtn = document.getElementById("themeBtn");
  if (themeBtn) themeBtn.addEventListener("click", () => {
    const next = root.dataset.theme === "light" ? "dark" : "light";
    root.dataset.theme = next;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = next === "light" ? "#f5f3ee" : "#0c0c0d";
    try { localStorage.setItem("theme", next); } catch (e) {}
  });

  // ---------- Player ----------
  // Any .card with data-src and data-id opens the shared player dialog.
  const dialog = document.getElementById("player");
  const frame = document.getElementById("frame");
  if (dialog && frame) {
    document.addEventListener("click", e => {
      const c = e.target.closest(".card[data-id]");
      if (!c) return;
      dialog.classList.toggle("vertical", c.dataset.vertical === "true");
      frame.innerHTML = `<iframe src="${site.playerUrl(c.dataset.src, c.dataset.id)}"
        allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen title="Video"></iframe>`;
      dialog.showModal();
    });
    document.getElementById("close").addEventListener("click", () => dialog.close());
    dialog.addEventListener("click", e => { if (e.target === dialog) dialog.close(); });
    dialog.addEventListener("close", () => { frame.innerHTML = ""; });
  }

  // ---------- Scroll reveal ----------
  const revealEls = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver(entries => entries.forEach(en => {
      if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); }
    }), { rootMargin: "0px 0px -8% 0px" });
    revealEls.forEach(el => io.observe(el));
  } else {
    revealEls.forEach(el => el.classList.add("in"));
  }

  // ---------- Footer ----------
  const year = document.getElementById("year");
  if (year) year.textContent = new Date().getFullYear();
})();
