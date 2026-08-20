(() => {
  document.querySelector("[data-filter-toggle]")?.addEventListener("click", () => {
    document.querySelector(".overview-filters")?.classList.toggle("is-open");
  });

  document.querySelectorAll("[data-expand]").forEach((row) => {
    row.addEventListener("click", (event) => {
      if (event.target.closest("a")) return;
      row.classList.toggle("is-open");
      row.nextElementSibling?.classList.toggle("is-open");
    });
  });

  document.querySelectorAll("form[data-confirm]").forEach((form) => {
    form.addEventListener("submit", (event) => {
      if (!confirm(form.dataset.confirm)) event.preventDefault();
    });
  });

  document.addEventListener("change", (event) => {
    const select = event.target.closest("select[name='zaaktypeId']");
    if (!select) return;
    const lead = Number(select.selectedOptions[0]?.dataset.lead || 0);
    const deadline = select.form?.querySelector("[data-deadline]");
    if (!lead || !deadline || deadline.value) return;
    const date = new Date();
    date.setDate(date.getDate() + lead);
    deadline.value = date.toISOString().slice(0, 10);
  });

  document.querySelectorAll("[data-template-picker]").forEach((picker) => {
    const items = [...picker.querySelectorAll(".check-item")];
    const search = picker.querySelector("[data-tpl-filter]");
    const count = picker.querySelector("[data-tpl-count]");
    const updateCount = () => {
      const n = items.filter((item) => item.querySelector("input")?.checked).length;
      if (count) {
        const selected = (window.I18N?.selected || "{n} selected").replace("{n}", String(n));
        count.textContent = n ? selected : window.I18N?.allAllowed || "All allowed";
      }
    };
    search?.addEventListener("input", () => {
      const q = search.value.trim().toLowerCase();
      items.forEach((item) => {
        item.classList.toggle("is-hidden", Boolean(q) && !item.textContent.toLowerCase().includes(q));
      });
    });
    picker.querySelector("[data-tpl-all]")?.addEventListener("click", () => {
      items.forEach((item) => {
        if (!item.classList.contains("is-hidden") && item.querySelector("input")) item.querySelector("input").checked = true;
      });
      updateCount();
    });
    picker.querySelector("[data-tpl-none]")?.addEventListener("click", () => {
      items.forEach((item) => {
        if (item.querySelector("input")) item.querySelector("input").checked = false;
      });
      updateCount();
    });
    picker.addEventListener("change", updateCount);
    updateCount();
  });

  const editModal = document.getElementById("edit-modal");
  const pdfModal = document.getElementById("pdf-modal");
  const pdfFrame = document.getElementById("pdf-modal-frame");
  const pdfTitle = document.getElementById("pdf-modal-title");
  const pdfDownload = document.getElementById("pdf-modal-download");

  function closeDialog(dialog) {
    if (!dialog) return;
    dialog.close();
    if (dialog === pdfModal && pdfFrame) pdfFrame.src = "";
  }

  function openPdfModal(href, name) {
    if (!pdfModal || !pdfFrame) return;
    const url = new URL(href, window.location.origin);
    if (pdfTitle) pdfTitle.textContent = name || "PDF";
    pdfFrame.src = url.pathname;
    if (pdfDownload) {
      pdfDownload.href = `${url.pathname}?download=1`;
      pdfDownload.setAttribute("download", name || "document.pdf");
    }
    pdfModal.showModal();
  }

  pdfModal?.addEventListener("close", () => {
    if (pdfFrame) pdfFrame.src = "";
  });

  async function openEditModal(href) {
    if (!editModal) return;
    const url = new URL(href, window.location.origin);
    url.searchParams.set("modal", "1");
    const html = await fetch(url).then((r) => r.text());
    editModal.innerHTML = html;
    editModal.showModal();
    editModal.querySelector("input, select, textarea, button")?.focus();
  }

  document.addEventListener("click", (event) => {
    if (event.target.closest("[data-modal-close]")) {
      event.preventDefault();
      closeDialog(event.target.closest("dialog") || editModal || pdfModal);
      return;
    }
    const pdfLink = event.target.closest("a[data-pdf-preview]");
    if (pdfLink && !event.metaKey && !event.ctrlKey && !event.shiftKey) {
      event.preventDefault();
      openPdfModal(pdfLink.getAttribute("href"), pdfLink.dataset.pdfName || pdfLink.textContent.trim());
      return;
    }
    const link = event.target.closest("a[href]");
    if (!link || event.metaKey || event.ctrlKey || event.shiftKey) return;
    const path = new URL(link.getAttribute("href"), window.location.origin).pathname;
    const isEdit = /\/bewerken$/.test(path);
    const isNew = /^\/(zaken|personen|bedrijven|werknemers)\/nieuw$/.test(path);
    if (!isEdit && !isNew) return;
    event.preventDefault();
    openEditModal(link.href);
  });
  const palette = document.getElementById("palette");
  const input = document.getElementById("palette-q");
  const results = document.getElementById("palette-results");
  const openers = document.querySelectorAll("[data-palette-open]");

  function openPalette() {
    if (!palette) return;
    palette.showModal();
    input.value = "";
    results.innerHTML = "";
    input.focus();
  }

  openers.forEach((el) => el.addEventListener("click", openPalette));
  document.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      openPalette();
    }
  });

  let timer;
  input?.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const q = input.value.trim();
      if (q.length < 2) {
        results.innerHTML = "";
        return;
      }
      const data = await fetch(`/api/search?q=${encodeURIComponent(q)}`).then((r) => r.json());
      const i18n = window.I18N || {};
      const blocks = [
        [i18n.cases || "Cases", data.zaken.map((z) => [`/zaken/${z.id}`, `${z.zaaknummer} · ${z.titel}`])],
        [i18n.companies || "Companies", data.bedrijven.map((b) => [`/bedrijven/${b.id}`, b.handelsnaam])],
        [i18n.persons || "Persons", data.personen.map((p) => [`/personen/${p.id}`, p.naam])],
        [i18n.employees || "Employees", data.werknemers.map((w) => [`/werknemers/${w.id}`, w.naam])],
      ];
      results.innerHTML = blocks
        .filter(([, items]) => items.length)
        .map(
          ([label, items]) =>
            `<p class="muted" style="padding:8px 16px 0">${label}</p>` +
            items.map(([href, text]) => `<a href="${href}">${text}</a>`).join("")
        )
        .join("") || `<p class="muted" style="padding:12px 16px">${i18n.nothing || "Nothing found"}</p>`;
    }, 160);
  });
})();
