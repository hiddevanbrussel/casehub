(() => {
  const root = document.documentElement;

  function currentTheme() {
    return root.getAttribute("data-theme") === "dark" ? "dark" : "light";
  }

  function applyTheme(theme) {
    const next = theme === "dark" ? "dark" : "light";
    if (next === "dark") root.setAttribute("data-theme", "dark");
    else root.removeAttribute("data-theme");
    document.cookie = `theme=${next};path=/;max-age=31536000;samesite=lax`;
    document.querySelectorAll("[data-theme-toggle]").forEach((btn) => {
      const label = next === "dark" ? btn.dataset.labelLight : btn.dataset.labelDark;
      if (label) {
        btn.setAttribute("aria-label", label);
        btn.setAttribute("title", label);
      }
    });
  }

  document.querySelectorAll("[data-theme-toggle]").forEach((btn) => {
    btn.addEventListener("click", () => {
      applyTheme(currentTheme() === "dark" ? "light" : "dark");
    });
  });

  const DELAY = 180;
  let bootTimer = 0;

  function bootEl() {
    return document.getElementById("boot");
  }

  function hideBoot() {
    window.clearTimeout(bootTimer);
    bootTimer = 0;
    const el = bootEl();
    if (!el) return;
    el.classList.remove("is-on");
    el.hidden = true;
    el.setAttribute("aria-hidden", "true");
  }

  function showBootSoon() {
    const el = bootEl();
    if (!el) return;
    window.clearTimeout(bootTimer);
    bootTimer = window.setTimeout(() => {
      el.hidden = false;
      el.setAttribute("aria-hidden", "false");
      window.requestAnimationFrame(() => el.classList.add("is-on"));
    }, DELAY);
  }

  function isFullLeave(anchor) {
    if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return false;
    if (anchor.hasAttribute("data-pdf-preview")) return false;
    const href = anchor.getAttribute("href");
    if (!href || href === "#" || href.startsWith("javascript:")) return false;
    let url;
    try {
      url = new URL(anchor.href, location.href);
    } catch {
      return false;
    }
    if (url.origin !== location.origin) return false;
    if (url.pathname === location.pathname && url.search === location.search) return false;
    return true;
  }

  window.CaseflowBoot = {
    showSoon: showBootSoon,
    hide: hideBoot,
    go(href) {
      showBootSoon();
      window.location.href = href;
    },
  };

  document.addEventListener("click", (event) => {
    if (event.button) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target.closest("a[href]");
    if (!isFullLeave(link)) return;
    queueMicrotask(() => {
      if (event.defaultPrevented) return;
      showBootSoon();
    });
  });

  document.addEventListener("submit", (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    queueMicrotask(() => {
      if (event.defaultPrevented) return;
      showBootSoon();
    });
  });

  window.addEventListener("pageshow", hideBoot);
})();
