(() => {
  const go = (href) => {
    if (window.CaseflowBoot?.go) window.CaseflowBoot.go(href);
    else window.location.href = href;
  };

  document.querySelector("[data-filter-toggle]")?.addEventListener("click", () => {
    document.querySelector(".overview-filters")?.classList.toggle("is-open");
  });

  document.addEventListener("change", (event) => {
    const el = event.target.closest("[data-auto-submit]");
    if (el?.form) el.form.requestSubmit();
  });

  const bindFormTabs = (root) => {
    const tabs = [...root.querySelectorAll("[data-form-tab]")];
    const panels = [...root.querySelectorAll("[data-form-panel]")];
    const remember = root.querySelector("[data-form-tab-value]");
    if (!tabs.length) return;
    const activate = (id) => {
      tabs.forEach((tab) => {
        const on = tab.getAttribute("data-form-tab") === id;
        tab.classList.toggle("is-active", on);
        tab.setAttribute("aria-selected", on ? "true" : "false");
        tab.tabIndex = on ? 0 : -1;
      });
      panels.forEach((panel) => {
        panel.hidden = panel.getAttribute("data-form-panel") !== id;
      });
      if (remember) remember.value = id;
    };
    tabs.forEach((tab) => {
      tab.addEventListener("click", () => activate(tab.getAttribute("data-form-tab")));
      tab.addEventListener("keydown", (event) => {
        if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
        event.preventDefault();
        const index = tabs.indexOf(tab);
        const next = event.key === "ArrowRight"
          ? tabs[index + 1] || tabs[0]
          : tabs[index - 1] || tabs[tabs.length - 1];
        next.focus();
        activate(next.getAttribute("data-form-tab"));
      });
    });
    root.addEventListener("invalid", (event) => {
      const panel = event.target.closest("[data-form-panel]");
      if (panel?.hidden) activate(panel.getAttribute("data-form-panel"));
    }, true);
    root.addEventListener("submit", () => {
      const invalid = root.querySelector(":invalid");
      if (!invalid) return;
      const panel = invalid.closest("[data-form-panel]");
      if (panel?.hidden) activate(panel.getAttribute("data-form-panel"));
    });
  };
  document.querySelectorAll("[data-form-tabs]").forEach(bindFormTabs);

  let listUiAbort = null;
  const bindListUi = () => {
    listUiAbort?.abort();
    listUiAbort = new AbortController();
    const { signal } = listUiAbort;

  const checkAll = document.querySelector("[data-check-all]");
  const checkRows = () => [...document.querySelectorAll("[data-check-row]")].filter((box) => !box.disabled);
  const bulkBar = document.querySelector("[data-bulk-bar]");
  const bulkForm = bulkBar?.closest("form");
  const bulkCount = bulkBar?.querySelector("[data-bulk-count]");
  const listCard = document.querySelector(".list-work") || document.querySelector(".list-card");

  const syncSelection = () => {
    const rows = checkRows();
    const checked = rows.filter((box) => box.checked);
    const n = checked.length;
    if (checkAll) {
      checkAll.checked = rows.length > 0 && n === rows.length;
      checkAll.indeterminate = n > 0 && n < rows.length;
    }
    rows.forEach((box) => {
      const row = box.closest(".queue-row") || box.closest("tr");
      row?.classList.toggle("is-selected", box.checked);
    });
    listCard?.classList.toggle("is-selecting", n > 0);
    if (bulkBar) {
      bulkBar.hidden = n === 0;
      const template = bulkBar.dataset.selectedTemplate || "{n}";
      if (bulkCount) bulkCount.textContent = template.replace("{n}", String(n));
    }
  };

  if (checkAll || bulkBar) {
    checkAll?.addEventListener("change", () => {
      checkRows().forEach((box) => {
        box.checked = checkAll.checked;
      });
      if (checkAll) checkAll.indeterminate = false;
      syncSelection();
    });
    checkRows().forEach((box) => box.addEventListener("change", syncSelection));
    bulkBar?.querySelector("[data-bulk-clear]")?.addEventListener("click", () => {
      checkRows().forEach((box) => {
        box.checked = false;
      });
      if (checkAll) {
        checkAll.checked = false;
        checkAll.indeterminate = false;
      }
      bulkBar.querySelectorAll("details").forEach((details) => {
        details.open = false;
      });
      syncSelection();
    });
    bulkBar?.querySelectorAll("details").forEach((details) => {
      details.addEventListener("toggle", () => {
        if (!details.open) return;
        bulkBar.querySelectorAll("details").forEach((other) => {
          if (other !== details) other.open = false;
        });
      });
    });
    bulkForm?.addEventListener("submit", (event) => {
      const n = checkRows().filter((box) => box.checked).length;
      if (!n) {
        event.preventDefault();
        return;
      }
      const submitter = event.submitter;
      if (submitter?.dataset.bulkDelete) {
        const template = bulkForm.dataset.confirmDelete || "";
        if (!confirm(template.replace("{n}", String(n)))) event.preventDefault();
      }
    });
    syncSelection();
  }

  const work = document.querySelector(".list-work");
  const pane = work?.querySelector(".list-pane");
  const split = work?.querySelector("[data-split]");
  if (work && pane && split) {
    const KEY = "caseflow.queueWidth";
    const MIN = 220;
    const MAX = 560;
    const DEFAULT = 280;
    const stacked = () => window.matchMedia("(max-width: 720px)").matches;
    const maxFor = () => {
      const peekMin = 280;
      const gutter = 9;
      return Math.max(MIN, Math.min(MAX, Math.floor(work.getBoundingClientRect().width - peekMin - gutter)));
    };
    const apply = (width) => {
      if (stacked()) {
        work.style.removeProperty("--queue-w");
        return DEFAULT;
      }
      const next = Math.round(Math.min(maxFor(), Math.max(MIN, width)));
      work.style.setProperty("--queue-w", `${next}px`);
      split.setAttribute("aria-valuenow", String(next));
      split.setAttribute("aria-valuemax", String(maxFor()));
      return next;
    };
    const persist = (width) => {
      try {
        localStorage.setItem(KEY, String(width));
      } catch {
        /* private mode */
      }
    };
    let stored = NaN;
    try {
      stored = Number(localStorage.getItem(KEY));
    } catch {
      stored = NaN;
    }
    apply(Number.isFinite(stored) && stored >= MIN ? stored : DEFAULT);
    let drag = null;
    split.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || stacked()) return;
      event.preventDefault();
      try {
        split.setPointerCapture(event.pointerId);
      } catch {
        /* synthetic pointer */
      }
      drag = { startX: event.clientX, startW: pane.getBoundingClientRect().width };
      work.classList.add("is-resizing");
    });
    split.addEventListener("pointermove", (event) => {
      if (!drag) return;
      apply(drag.startW + (event.clientX - drag.startX));
    });
    const endDrag = () => {
      if (!drag) return;
      drag = null;
      work.classList.remove("is-resizing");
      persist(pane.getBoundingClientRect().width);
    };
    split.addEventListener("pointerup", endDrag);
    split.addEventListener("pointercancel", endDrag);
    split.addEventListener("dblclick", () => {
      persist(apply(DEFAULT));
    });
    split.addEventListener("keydown", (event) => {
      if (stacked()) return;
      const step = event.shiftKey ? 40 : 16;
      const current = pane.getBoundingClientRect().width;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        persist(apply(current - step));
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        persist(apply(current + step));
      } else if (event.key === "Home") {
        event.preventDefault();
        persist(apply(MIN));
      } else if (event.key === "End") {
        event.preventDefault();
        persist(apply(maxFor()));
      }
    });
    window.addEventListener("resize", () => apply(pane.getBoundingClientRect().width));
  }

  const peekRoot = document.querySelector("[data-peek]");
  const peekForm = document.querySelector("#peek-inline");
  const peekComposing = Boolean(peekRoot?.hasAttribute("data-peek-compose"));
  const peekStakeList = peekForm?.querySelector("[data-stake-list]");
  const peekStakeHtml = peekStakeList ? peekStakeList.innerHTML : "";
  const peekCancel = document.querySelector("[data-peek-cancel]");
  const setPeekEditing = (on) => {
    if (!peekRoot) return;
    if (!on && peekComposing) {
      const href = peekCancel?.getAttribute("href");
      if (href) {
        go(href);
        return;
      }
    }
    peekRoot.classList.toggle("is-editing", on);
    if (on) {
      const title = peekForm?.querySelector("#peek-title");
      title?.focus();
      title?.select();
    } else {
      peekForm?.reset();
      if (peekStakeList) peekStakeList.innerHTML = peekStakeHtml;
    }
  };
  document.querySelector("[data-peek-edit]")?.addEventListener("click", () => setPeekEditing(true));
  peekCancel?.addEventListener("click", (event) => {
    if (peekComposing) return;
    event.preventDefault();
    setPeekEditing(false);
  });
  if (peekComposing) {
    const draftTitle = document.querySelector("[data-draft-title]");
    const titleInput = peekForm?.querySelector("#peek-title");
    const draftParts = [...(peekForm?.querySelectorAll("[data-draft-part]") || [])];
    const emptyTitle = draftTitle?.getAttribute("data-empty") || "";
    const syncDraftTitle = () => {
      if (!draftTitle) return;
      const value = draftParts.length
        ? draftParts.map((el) => el.value.trim()).filter(Boolean).join(" ")
        : (titleInput?.value.trim() || "");
      draftTitle.textContent = value || emptyTitle;
      draftTitle.closest(".queue-row")?.classList.toggle("has-title", Boolean(value));
    };
    draftParts.forEach((el) => el.addEventListener("input", syncDraftTitle));
    titleInput?.addEventListener("input", syncDraftTitle);
    setPeekEditing(true);
  }

  const peekTabs = [...(peekRoot?.querySelectorAll("[data-peek-tab]") || [])];
  const peekPanels = [...(peekRoot?.querySelectorAll("[data-peek-panel]") || [])];
  const activatePeekTab = (id) => {
    peekTabs.forEach((tab) => {
      const on = tab.getAttribute("data-peek-tab") === id;
      tab.classList.toggle("is-active", on);
      tab.setAttribute("aria-selected", on ? "true" : "false");
      tab.tabIndex = on ? 0 : -1;
    });
    peekPanels.forEach((panel) => {
      panel.hidden = panel.getAttribute("data-peek-panel") !== id;
    });
  };
  peekTabs.forEach((tab) => {
    tab.addEventListener("click", () => activatePeekTab(tab.getAttribute("data-peek-tab")));
    tab.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
      event.preventDefault();
      event.stopPropagation();
      const index = peekTabs.indexOf(tab);
      const next = event.key === "ArrowRight"
        ? peekTabs[index + 1] || peekTabs[0]
        : peekTabs[index - 1] || peekTabs[peekTabs.length - 1];
      next.focus();
      activatePeekTab(next.getAttribute("data-peek-tab"));
    });
  });

  const queueHits = [...document.querySelectorAll(".queue-hit")].filter((el) => !el.closest(".is-draft"));
  if (queueHits.length || document.querySelector(".queue-row")) {
    document.querySelectorAll(".queue-row:not(.is-draft)").forEach((row) => {
      row.addEventListener("click", (event) => {
        if (event.target.closest("input, label, a")) return;
        row.querySelector(".queue-hit")?.click();
      });
      row.addEventListener("dblclick", (event) => {
        if (event.target.closest("input, label")) return;
        const href = row.dataset.open;
        if (href) go(href);
      });
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && peekRoot?.classList.contains("is-editing")) {
        event.preventDefault();
        setPeekEditing(false);
        return;
      }
      if (peekRoot?.classList.contains("is-editing")) return;
      if (document.querySelector("dialog[open]")) return;
      if (event.target.closest("input, textarea, select, button, [data-peek-tab]")) return;
      const currentRow = document.querySelector(".queue-row.is-focused") || document.querySelector(".queue-row");
      const current = currentRow?.querySelector(".queue-hit") || queueHits[0];
      const index = queueHits.indexOf(current);
      if (event.key === "ArrowDown" || event.key === "j") {
        event.preventDefault();
        (queueHits[index + 1] || queueHits[index])?.click();
      } else if (event.key === "ArrowUp" || event.key === "k") {
        event.preventDefault();
        (queueHits[index - 1] || queueHits[index])?.click();
      } else if (event.key === "Enter" && currentRow?.dataset.open) {
        event.preventDefault();
        go(currentRow.dataset.open);
      }
    }, { signal });
  }

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
    const ymdAddDays = (value, days) => {
      const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!match) return "";
      const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
      date.setDate(date.getDate() + (Number(days) || 0));
      const y = date.getFullYear();
      const m = String(date.getMonth() + 1).padStart(2, "0");
      const d = String(date.getDate()).padStart(2, "0");
      return `${y}-${m}-${d}`;
    };
    const formatYmd = (value) => {
      const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!match) return "—";
      const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
      return date.toLocaleDateString(lang, { day: "2-digit", month: "2-digit", year: "numeric" });
    };
    const update = (fromUser) => {
      if (!start || !deadline) return;
      const lead = Number(type?.selectedOptions[0]?.dataset.lead || 0);
      if (!start.value) {
        if (out) {
          if (out.tagName === "INPUT") out.value = "";
          else out.textContent = "—";
        }
        return;
      }
      const next = ymdAddDays(start.value, lead);
      if (fromUser || !deadline.value) deadline.value = next;
      if (out) {
        const shown = deadline.value || next;
        if (out.tagName === "INPUT") out.value = shown;
        else out.textContent = formatYmd(shown);
      }
    };
    type?.addEventListener("change", () => update(true));
    start?.addEventListener("change", () => update(true));
    update(false);
  });

  document.querySelectorAll("[data-stakeholder-picker]").forEach((picker) => {
    const jsonEl = picker.querySelector("[data-stake-json]");
    const data = jsonEl ? JSON.parse(jsonEl.textContent || "{}") : { persons: [], companies: [] };
    const query = picker.querySelector("[data-stake-q]");
    const results = picker.querySelector("[data-stake-results]");
    const list = picker.querySelector("[data-stake-list]");
    const removeLabel = picker.querySelector("[data-stake-remove]")?.textContent || "Delete";
    const i18n = window.I18N || {};
    const resultsId = `stake-results-${Math.random().toString(36).slice(2, 8)}`;
    let activeIndex = -1;
    if (results) results.id = resultsId;
    if (query && results) query.setAttribute("aria-controls", resultsId);

    const escapeHtml = (value) => String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

    const selected = () => new Set(
      [...picker.querySelectorAll("input[name='persoonIds'], input[name='bedrijfIds']")].map((el) => el.value)
    );

    const haystack = (item) => `${item.name} ${item.email || ""} ${item.meta || ""} ${item.extra || ""}`.toLowerCase();

    const rank = (item, q) => {
      const name = String(item.name || "").toLowerCase();
      if (name.startsWith(q)) return 0;
      if (name.includes(q)) return 1;
      return 2;
    };

    const filterKind = (items, kind, q) => {
      const taken = selected();
      return (items || [])
        .filter((item) => !taken.has(item.id) && haystack(item).includes(q))
        .map((item) => ({ ...item, kind }))
        .sort((a, b) => rank(a, q) - rank(b, q) || String(a.name).localeCompare(String(b.name)))
        .slice(0, 8);
    };

    const optionNodes = () => [...(results?.querySelectorAll("[data-stake-option]") || [])];

    const setActive = (index) => {
      const options = optionNodes();
      activeIndex = options.length ? Math.max(0, Math.min(index, options.length - 1)) : -1;
      options.forEach((option, i) => {
        const on = i === activeIndex;
        option.classList.toggle("is-active", on);
        option.id = `${resultsId}-opt-${i}`;
        if (on) {
          query?.setAttribute("aria-activedescendant", option.id);
          option.scrollIntoView({ block: "nearest" });
        }
      });
      if (activeIndex < 0) query?.removeAttribute("aria-activedescendant");
    };

    const closeResults = () => {
      if (!results) return;
      results.hidden = true;
      results.innerHTML = "";
      activeIndex = -1;
      query?.setAttribute("aria-expanded", "false");
      query?.removeAttribute("aria-activedescendant");
    };

    const renderGroup = (label, items) => {
      if (!items.length) return "";
      return `<p class="stake-results-group">${escapeHtml(label)}</p>` + items.map((item) => {
        const initials = String(item.name || "?")
          .split(/\s+/)
          .map((part) => part[0])
          .filter(Boolean)
          .slice(0, 2)
          .join("")
          .toUpperCase();
        const tone = String(item.id || "a").charCodeAt(0) % 4;
        const meta = item.meta || item.extra || "";
        return `<button type="button" class="stake-result" role="option" data-stake-option data-kind="${item.kind}" data-id="${escapeHtml(item.id)}">
          <span class="who-avatar assignee-av tone-${tone}" aria-hidden="true">${escapeHtml(initials)}</span>
          <span><strong>${escapeHtml(item.name)}</strong>${meta ? `<small>${escapeHtml(meta)}</small>` : ""}</span>
        </button>`;
      }).join("");
    };

    const refreshResults = () => {
      if (!results || !query) return;
      const q = query.value.trim().toLowerCase();
      if (!q) {
        closeResults();
        return;
      }
      const persons = filterKind(data.persons, "person", q);
      const companies = filterKind(data.companies, "company", q);
      if (!persons.length && !companies.length) {
        results.hidden = false;
        results.innerHTML = `<p class="stake-results-empty">${escapeHtml(i18n.stakeNoMatch || i18n.nothing || "Nothing found")}</p>`;
        query.setAttribute("aria-expanded", "true");
        activeIndex = -1;
        return;
      }
      results.hidden = false;
      results.innerHTML = renderGroup(i18n.persons || "Persons", persons) + renderGroup(i18n.companies || "Companies", companies);
      query.setAttribute("aria-expanded", "true");
      setActive(0);
    };

    const addItem = (kind, id) => {
      if (!id || !list) return;
      const source = kind === "company" ? data.companies : data.persons;
      const item = (source || []).find((row) => row.id === id);
      if (!item || selected().has(id)) return;
      const isCompany = kind === "company";
      const details = document.createElement("details");
      details.className = "holder";
      details.dataset.kind = isCompany ? "company" : "person";
      details.dataset.id = id;
      details.innerHTML = `
        <summary>
          ${document.getElementById("icon-chevron-down")?.innerHTML || ""}
          ${escapeHtml(item.name)}
        </summary>
        <div class="holder-body">
          ${item.meta ? `<p>${escapeHtml(item.meta)}</p>` : ""}
          <button type="button" class="linkish danger-text" data-stake-remove>${escapeHtml(removeLabel)}</button>
        </div>`;
      const hidden = document.createElement("input");
      hidden.type = "hidden";
      hidden.name = isCompany ? "bedrijfIds" : "persoonIds";
      hidden.value = id;
      list.append(details, hidden);
      if (query) query.value = "";
      closeResults();
      query?.focus();
    };

    picker.addEventListener("click", (event) => {
      const remove = event.target.closest("[data-stake-remove]");
      if (!remove) return;
      const holder = remove.closest(".holder");
      const id = holder?.dataset.id;
      holder?.remove();
      picker.querySelectorAll(`input[name='persoonIds'][value='${id}'], input[name='bedrijfIds'][value='${id}']`).forEach((el) => el.remove());
    });

    results?.addEventListener("mousedown", (event) => event.preventDefault());
    results?.addEventListener("click", (event) => {
      const option = event.target.closest("[data-stake-option]");
      if (option) addItem(option.dataset.kind, option.dataset.id);
    });

    query?.addEventListener("input", refreshResults);
    query?.addEventListener("focus", () => {
      if (query.value.trim()) refreshResults();
    });
    query?.addEventListener("keydown", (event) => {
      const open = results && !results.hidden;
      if (event.key === "Escape") {
        if (open) {
          event.preventDefault();
          event.stopPropagation();
          closeResults();
        }
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        if (!open) {
          if (query.value.trim()) refreshResults();
          else return;
        }
        event.preventDefault();
        event.stopPropagation();
        const options = optionNodes();
        if (!options.length) return;
        const delta = event.key === "ArrowDown" ? 1 : -1;
        setActive(activeIndex < 0 ? 0 : activeIndex + delta);
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        const options = optionNodes();
        if (!open || !options.length) return;
        const option = options[activeIndex] || options[0];
        addItem(option.dataset.kind, option.dataset.id);
      }
    });

    document.addEventListener("mousedown", (event) => {
      if (!picker.contains(event.target)) closeResults();
    }, { signal });
    picker.closest("form")?.addEventListener("reset", closeResults);
  });

  document.querySelectorAll("[data-bulk-stake-q]").forEach((search) => {
    const items = [...search.closest("details")?.querySelectorAll("[data-bulk-stake-item]") || []];
    search.addEventListener("input", () => {
      const q = search.value.trim().toLowerCase();
      items.forEach((item) => {
        item.hidden = Boolean(q) && !item.textContent.toLowerCase().includes(q);
      });
    });
    search.addEventListener("keydown", (event) => event.stopPropagation());
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

  document.querySelectorAll("[data-process-builder]").forEach((root) => {
    const stepsBox = root.querySelector("[data-process-steps]");
    const empty = root.querySelector("[data-process-empty]");
    const stepTpl = root.querySelector("[data-process-step-tpl]");
    const decisionTpl = root.querySelector("[data-process-decision-tpl]");
    if (!stepsBox || !stepTpl || !decisionTpl) return;

    const escapeHtml = (value) => String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/"/g, "&quot;");

    const stepEls = () => [...stepsBox.querySelectorAll("[data-process-step]")];

    const fillDestinations = (select, index, selected) => {
      const nextLabel = root.getAttribute("data-i18n-next") || "Next step";
      const endLabel = root.getAttribute("data-i18n-end") || "Finish process";
      const current = selected || select.value || "__next__";
      const options = [
        `<option value="__next__">${escapeHtml(nextLabel)}</option>`,
        `<option value="__end__">${escapeHtml(endLabel)}</option>`,
      ];
      stepEls().forEach((step, i) => {
        if (i === index) return;
        const name = step.querySelector("[data-step-name]")?.value.trim() || String(i + 1);
        options.push(`<option value="${i}">${escapeHtml(name)}</option>`);
      });
      select.innerHTML = options.join("");
      if ([...select.options].some((option) => option.value === current)) select.value = current;
      else select.value = "__next__";
    };

    const reindex = () => {
      const steps = stepEls();
      if (empty) empty.hidden = steps.length > 0;
      steps.forEach((step, i) => {
        const title = step.querySelector(".process-step-head strong");
        if (title) {
          const label = title.getAttribute("data-step-label") || title.textContent.replace(/\s+\d+$/, "").trim();
          title.textContent = `${label} ${i + 1}`;
        }
        const idInput = step.querySelector("[data-step-id]");
        const nameInput = step.querySelector("[data-step-name]");
        const tasksInput = step.querySelector("[data-step-tasks]");
        if (idInput) idInput.name = `steps[${i}][id]`;
        if (nameInput) nameInput.name = `steps[${i}][name]`;
        if (tasksInput) tasksInput.name = `steps[${i}][tasks]`;
        [...step.querySelectorAll("[data-process-decision]")].forEach((row, j) => {
          const decId = row.querySelector("[data-dec-id]");
          const decLabel = row.querySelector("[data-dec-label]");
          const decTo = row.querySelector("[data-dec-to]");
          if (decId) decId.name = `steps[${i}][decisions][${j}][id]`;
          if (decLabel) decLabel.name = `steps[${i}][decisions][${j}][label]`;
          if (decTo) {
            decTo.name = `steps[${i}][decisions][${j}][to]`;
            fillDestinations(decTo, i, decTo.value);
          }
        });
      });
    };

    root.addEventListener("click", (event) => {
      const addStep = event.target.closest("[data-process-add-step]");
      if (addStep) {
        const node = stepTpl.content.firstElementChild.cloneNode(true);
        stepsBox.append(node);
        reindex();
        node.querySelector("[data-step-name]")?.focus();
        return;
      }
      const addDecision = event.target.closest("[data-process-add-decision]");
      if (addDecision) {
        const step = addDecision.closest("[data-process-step]");
        const box = step?.querySelector("[data-process-decisions]");
        if (!box) return;
        box.append(decisionTpl.content.firstElementChild.cloneNode(true));
        reindex();
        return;
      }
      const removeStep = event.target.closest("[data-process-remove-step]");
      if (removeStep) {
        removeStep.closest("[data-process-step]")?.remove();
        reindex();
        return;
      }
      const removeDecision = event.target.closest("[data-process-remove-decision]");
      if (removeDecision) {
        removeDecision.closest("[data-process-decision]")?.remove();
        reindex();
        return;
      }
      const up = event.target.closest("[data-process-up]");
      if (up) {
        const step = up.closest("[data-process-step]");
        const prev = step?.previousElementSibling;
        if (step && prev) stepsBox.insertBefore(step, prev);
        reindex();
        return;
      }
      const down = event.target.closest("[data-process-down]");
      if (down) {
        const step = down.closest("[data-process-step]");
        const next = step?.nextElementSibling;
        if (step && next) stepsBox.insertBefore(next, step);
        reindex();
      }
    });

    root.addEventListener("input", (event) => {
      if (event.target.matches("[data-step-name]")) reindex();
    });

    reindex();
  });

  const generateModal = document.getElementById("generate-modal");
  if (generateModal) {
    const generateFilter = generateModal.querySelector("[data-generate-filter]");
    const generateItems = [...generateModal.querySelectorAll("[data-generate-picker] .check-item")];
    generateFilter?.addEventListener("input", () => {
      const q = generateFilter.value.trim().toLowerCase();
      generateItems.forEach((item) => {
        item.classList.toggle("is-hidden", Boolean(q) && !item.textContent.toLowerCase().includes(q));
      });
    });
    const generateForm = generateModal.querySelector("[data-generate-form]");
    const modeInput = generateModal.querySelector("[data-generate-mode]");
    const title = generateModal.querySelector("[data-generate-title]");
    const submit = generateModal.querySelector("[data-generate-submit]");
    const batchHints = [...generateModal.querySelectorAll("[data-generate-hint]")];

    const generateLabel = (mode) => {
      const i18n = window.I18N || {};
      return mode === "interactive"
        ? (i18n.generateInteractive || "Generate interactively")
        : (i18n.generateDoc || "Generate document");
    };

    const syncBatchHint = () => {
      const interactive = modeInput?.value === "interactive";
      batchHints.forEach((el) => {
        el.hidden = interactive ? el.dataset.generateHint !== "interactive" : el.dataset.generateHint !== "batch";
      });
    };

    const setGenerateBusy = (busy) => {
      const i18n = window.I18N || {};
      generateModal.dataset.busy = busy ? "1" : "";
      generateModal.querySelectorAll("button").forEach((btn) => {
        btn.disabled = busy;
      });
      if (!submit) return;
      submit.classList.toggle("is-busy", busy);
      submit.textContent = busy
        ? (i18n.generating || "Generating…")
        : generateLabel(modeInput?.value);
    };

    const openCreateTab = (label) => {
      const tab = window.open("about:blank", "_blank");
      if (!tab) return null;
      try {
        tab.document.title = label;
        if (tab.document.body) tab.document.body.textContent = label;
      } catch {
        // Cross-origin or empty tab; location is set after the request.
      }
      return tab;
    };

    generateModal.addEventListener("cancel", (event) => {
      if (generateModal.dataset.busy === "1") event.preventDefault();
    }, { signal });

    document.querySelectorAll("[data-generate-open]").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (btn.disabled) return;
        const mode = btn.dataset.generateOpen;
        const label = generateLabel(mode);
        if (modeInput) modeInput.value = mode;
        if (title) title.textContent = label;
        if (submit && generateModal.dataset.busy !== "1") submit.textContent = label;
        syncBatchHint();
        generateModal.showModal();
      }, { signal });
    });

    generateForm?.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (generateModal.dataset.busy === "1") return;
      const i18n = window.I18N || {};
      const label = i18n.generating || "Generating…";
      setGenerateBusy(true);
      const tab = openCreateTab(label);
      try {
        const body = new URLSearchParams();
        new FormData(generateForm).forEach((value, key) => {
          if (typeof value === "string") body.append(key, value);
        });
        const res = await fetch(generateForm.action, {
          method: "POST",
          body,
          credentials: "same-origin",
          headers: { Accept: "application/json" },
        });
        const data = await res.json().catch(() => ({}));
        if (data.open) {
          if (tab) tab.location.replace(data.open);
          else window.open(data.open, "_blank");
        } else if (tab) {
          tab.close();
        }
        const here = new URL(window.location.href);
        let toast = data.toast || "";
        if (!toast && data.next) {
          try {
            toast = new URL(data.next, window.location.origin).searchParams.get("toast") || "";
          } catch {
            toast = "";
          }
        }
        if (toast) here.searchParams.set("toast", toast);
        if (generateForm.querySelector('input[name="from"]')?.value === "list") {
          here.searchParams.set("peekTab", "docs");
        }
        go(here.pathname + here.search);
      } catch {
        if (tab) tab.close();
        setGenerateBusy(false);
      }
    }, { signal });
  }
  };

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
        [i18n.cases || "Cases", data.zaken.map((z) => [`/zaken?focus=${encodeURIComponent(z.id)}`, `${z.zaaknummer} · ${z.titel}`])],
        [i18n.companies || "Companies", data.bedrijven.map((b) => [`/bedrijven?focus=${encodeURIComponent(b.id)}`, b.handelsnaam])],
        [i18n.persons || "Persons", data.personen.map((p) => [`/personen?focus=${encodeURIComponent(p.id)}`, p.naam])],
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

  const initLazyList = (work) => {
    const queueSlot = () => work.querySelector("[data-list-slot='queue']");
    const peekSlot = () => work.querySelector("[data-list-slot='peek']");
    const queueSkel = queueSlot()?.innerHTML || "";
    const peekSkel = peekSlot()?.innerHTML || "";
    let abort = null;
    let seq = 0;

    const status = (busy, revealing) => {
      work.classList.toggle("is-loading", busy);
      work.classList.toggle("is-revealing", revealing);
      work.setAttribute("aria-busy", busy ? "true" : "false");
    };

    const paintSkeleton = () => {
      const queue = queueSlot();
      const peek = peekSlot();
      if (queue && queueSkel) queue.innerHTML = queueSkel;
      if (peek && peekSkel) peek.innerHTML = peekSkel;
    };

    const fragmentUrl = (href) => {
      const url = new URL(href, location.origin);
      url.searchParams.delete("full");
      url.searchParams.set("fragment", "1");
      return url;
    };

    const displayUrl = (href) => {
      const url = new URL(href, location.origin);
      url.searchParams.delete("fragment");
      url.searchParams.delete("full");
      return `${url.pathname}${url.search}`;
    };

    const sameFilters = (href) => {
      const next = new URL(href, location.href);
      const keys = ["q", "status", "zaaktypeId", "prioriteit", "group", "page", "pageSize", "nieuw", "sort"];
      return keys.every((key) => (next.searchParams.get(key) || "") === (new URL(location.href).searchParams.get(key) || ""));
    };

    const loadList = async (href, { push = true, initial = false } = {}) => {
      const current = seq += 1;
      abort?.abort();
      abort = new AbortController();
      status(true, false);
      if (!initial) {
        if (sameFilters(href)) {
          const peek = peekSlot();
          if (peek && peekSkel) peek.innerHTML = peekSkel;
        } else {
          paintSkeleton();
        }
      }
      try {
        const res = await fetch(fragmentUrl(href), {
          headers: { Accept: "text/html", "X-Requested-With": "list" },
          signal: abort.signal,
        });
        if (!res.ok) throw new Error(String(res.status));
        const html = await res.text();
        if (current !== seq) return;
        const doc = new DOMParser().parseFromString(html, "text/html");
        const nextQueue = doc.querySelector("[data-list-slot='queue']");
        const nextPeek = doc.querySelector("[data-list-slot='peek']");
        if (!nextQueue || !nextPeek) throw new Error("fragment");
        const queue = queueSlot();
        const peek = peekSlot();
        if (queue) queue.innerHTML = nextQueue.innerHTML;
        if (peek) peek.innerHTML = nextPeek.innerHTML;
        work.removeAttribute("data-list-pending");
        const focusInput = work.querySelector(".list-toolbar input[name='focus']");
        const focused = work.querySelector(".queue-hit[aria-current='true']");
        if (focusInput) {
          focusInput.value = focused
            ? (new URL(focused.href, location.origin).searchParams.get("focus") || "")
            : "";
        }
        const shown = displayUrl(href);
        if (push && shown !== `${location.pathname}${location.search}`) {
          history.pushState({ list: true }, "", shown);
        }
        bindListUi();
        status(false, true);
        window.setTimeout(() => work.classList.remove("is-revealing"), 320);
      } catch (err) {
        if (err.name === "AbortError") return;
        const queue = queueSlot();
        if (queue) {
          const message = window.I18N?.loadError || "Could not load this list.";
          queue.innerHTML = `<div class="empty list-empty">${message}</div>`;
        }
        status(false, false);
      }
    };

    work.addEventListener("click", (event) => {
      if (event.defaultPrevented) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button) return;
      const link = event.target.closest("a[href]");
      if (!link || link.target === "_blank" || link.hasAttribute("download")) return;
      if (link.hasAttribute("data-pdf-preview")) return;
      const href = link.getAttribute("href");
      if (!href || href === "#") return;
      const url = new URL(href, location.href);
      if (url.origin !== location.origin || url.pathname !== location.pathname) return;
      event.preventDefault();
      loadList(url.href);
    });

    work.addEventListener("submit", (event) => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement)) return;
      if ((form.getAttribute("method") || "get").toLowerCase() !== "get") return;
      event.preventDefault();
      const url = new URL(form.getAttribute("action") || location.href, location.origin);
      const data = new FormData(form);
      url.search = "";
      data.forEach((value, key) => {
        if (value) url.searchParams.append(key, String(value));
      });
      loadList(url.href);
    });

    window.addEventListener("popstate", () => {
      loadList(location.href, { push: false });
    });

    if (work.hasAttribute("data-list-pending")) {
      loadList(location.href, { push: false, initial: true });
    } else {
      bindListUi();
    }
  };

  const listWork = document.querySelector("[data-list-lazy]");
  if (listWork) initLazyList(listWork);
  else bindListUi();
})();
