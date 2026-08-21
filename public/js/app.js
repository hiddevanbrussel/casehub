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

  document.querySelectorAll("form[data-case-form]").forEach((form) => {
    const type = form.querySelector("select[name='zaaktypeId']");
    const start = form.querySelector("[data-lead-start]");
    const deadline = form.querySelector("[data-deadline]");
    const out = form.querySelector("[data-planned-end]");
    const lang = document.documentElement.lang || "en-GB";
    const update = () => {
      if (!start || !deadline) return;
      const lead = Number(type?.selectedOptions[0]?.dataset.lead || 0);
      if (!start.value) {
        if (out) out.textContent = "—";
        return;
      }
      const date = new Date(`${start.value}T00:00:00`);
      if (lead) date.setDate(date.getDate() + lead);
      deadline.value = date.toISOString().slice(0, 10);
      if (out) out.textContent = date.toLocaleDateString(lang, { day: "2-digit", month: "2-digit", year: "numeric" });
    };
    type?.addEventListener("change", update);
    start?.addEventListener("change", update);
    update();
  });

  document.querySelectorAll("[data-stakeholder-picker]").forEach((picker) => {
    const jsonEl = picker.querySelector("[data-stake-json]");
    const data = jsonEl ? JSON.parse(jsonEl.textContent || "{}") : { persons: [], companies: [] };
    const kind = picker.querySelector("[data-stake-kind]");
    const query = picker.querySelector("[data-stake-q]");
    const pick = picker.querySelector("[data-stake-pick]");
    const list = picker.querySelector("[data-stake-list]");
    const noneLabel = pick?.options[0]?.textContent || "None";
    const removeLabel = picker.querySelector("[data-stake-remove]")?.textContent || "Delete";

    const selected = () => new Set(
      [...picker.querySelectorAll("input[name='persoonIds'], input[name='bedrijfIds']")].map((el) => el.value)
    );

    const itemsForKind = () => (kind.value === "company" ? data.companies : data.persons) || [];

    const refreshPick = () => {
      if (!pick) return;
      const q = (query?.value || "").trim().toLowerCase();
      const taken = selected();
      const matches = itemsForKind().filter((item) => {
        if (taken.has(item.id)) return false;
        if (!q) return true;
        return `${item.name} ${item.email || ""} ${item.meta || ""}`.toLowerCase().includes(q);
      }).slice(0, 20);
      pick.innerHTML = `<option value="">${noneLabel}</option>` + matches
        .map((item) => `<option value="${item.id}">${item.name}${item.meta ? " · " + item.meta : ""}</option>`)
        .join("");
    };

    const addItem = () => {
      const id = pick?.value;
      if (!id) return;
      const item = itemsForKind().find((row) => row.id === id);
      if (!item || selected().has(id)) return;
      const isCompany = kind.value === "company";
      const field = isCompany ? "bedrijfIds" : "persoonIds";
      const details = document.createElement("details");
      details.className = "holder";
      details.dataset.kind = isCompany ? "company" : "person";
      details.dataset.id = id;
      details.innerHTML = `
        <summary>
          <svg viewBox="0 0 24 24"><path d="M7 10l5 5 5-5z"/></svg>
          ${item.name}
        </summary>
        <div class="holder-body">
          ${item.meta ? `<p>${item.meta}</p>` : ""}
          <button type="button" class="linkish danger-text" data-stake-remove>${removeLabel}</button>
        </div>`;
      const hidden = document.createElement("input");
      hidden.type = "hidden";
      hidden.name = field;
      hidden.value = id;
      list.append(details, hidden);
      pick.value = "";
      if (query) query.value = "";
      refreshPick();
    };

    picker.addEventListener("click", (event) => {
      const remove = event.target.closest("[data-stake-remove]");
      if (!remove) return;
      const holder = remove.closest(".holder");
      const id = holder?.dataset.id;
      holder?.remove();
      picker.querySelectorAll(`input[name='persoonIds'][value='${id}'], input[name='bedrijfIds'][value='${id}']`).forEach((el) => el.remove());
      refreshPick();
    });
    kind?.addEventListener("change", refreshPick);
    query?.addEventListener("input", refreshPick);
    picker.querySelector("[data-stake-add]")?.addEventListener("click", addItem);
    refreshPick();
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

  const generateModal = document.getElementById("generate-modal");
  if (generateModal) {
    const generateFilter = generateModal.querySelector("[data-generate-filter]");
    const generateItems = [...generateModal.querySelectorAll(".check-item")];
    generateFilter?.addEventListener("input", () => {
      const q = generateFilter.value.trim().toLowerCase();
      generateItems.forEach((item) => {
        item.classList.toggle("is-hidden", Boolean(q) && !item.textContent.toLowerCase().includes(q));
      });
    });
    document.querySelectorAll("[data-generate-open]").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (btn.disabled) return;
        const mode = btn.dataset.generateOpen;
        const i18n = window.I18N || {};
        const label = mode === "interactive"
          ? (i18n.generateInteractive || "Generate interactively")
          : (i18n.generateDoc || "Generate document");
        const modeInput = generateModal.querySelector("[data-generate-mode]");
        const title = generateModal.querySelector("[data-generate-title]");
        const submit = generateModal.querySelector("[data-generate-submit]");
        if (modeInput) modeInput.value = mode;
        if (title) title.textContent = label;
        if (submit) submit.textContent = label;
        generateModal.showModal();
      });
    });
  }

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
    }
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
