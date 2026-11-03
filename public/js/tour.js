(() => {
  const tour = window.TOUR;
  if (!tour?.steps?.length) return;

  const root = document.getElementById("tour");
  if (!root) return;

  const scrim = root.querySelector("[data-tour-scrim]");
  const spot = root.querySelector("[data-tour-spot]");
  const card = root.querySelector("[data-tour-card]");
  const titleEl = root.querySelector("[data-tour-title]");
  const bodyEl = root.querySelector("[data-tour-body]");
  const progressEl = root.querySelector("[data-tour-progress]");
  const skipBtn = root.querySelector("[data-tour-skip]");
  const backBtn = root.querySelector("[data-tour-back]");
  const nextBtn = root.querySelector("[data-tour-next]");
  if (!scrim || !spot || !card || !titleEl || !bodyEl || !progressEl || !skipBtn || !backBtn || !nextBtn) return;

  const pad = 8;
  let index = 0;
  let target = null;

  const usable = () => tour.steps.filter((step) => document.querySelector(step.target));

  let steps = usable();
  if (!steps.length) return;

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  const placeCard = (rect, hint) => {
    const gap = 14;
    const width = Math.min(328, window.innerWidth - 24);
    const height = card.offsetHeight || 180;
    let left = rect.left;
    let top = rect.bottom + gap;
    if (hint === "right") {
      left = rect.right + gap;
      top = rect.top;
    } else if (hint === "left") {
      left = rect.left - width - gap;
      top = rect.top;
    } else if (hint === "top") {
      left = rect.left;
      top = rect.top - height - gap;
    }
    if (window.innerWidth <= 720) {
      left = 12;
      top = window.innerHeight - height - 16;
      card.style.width = `${window.innerWidth - 24}px`;
    } else {
      card.style.width = `${width}px`;
      if (left + width > window.innerWidth - 12) left = window.innerWidth - width - 12;
      if (left < 12) left = 12;
      if (top + height > window.innerHeight - 12) top = Math.max(12, rect.top - height - gap);
      if (top < 12) top = 12;
    }
    card.style.left = `${Math.round(left)}px`;
    card.style.top = `${Math.round(top)}px`;
  };

  const paint = () => {
    const step = steps[index];
    if (!step) return finish();
    target?.classList.remove("is-tour-target");
    const el = document.querySelector(step.target);
    if (!el) {
      index += 1;
      if (index >= steps.length) return finish();
      return paint();
    }
    target = el;
    el.classList.add("is-tour-target");
    el.scrollIntoView({ block: "nearest", inline: "nearest" });
    const rect = el.getBoundingClientRect();
    const left = clamp(rect.left - pad, 8, window.innerWidth - 24);
    const top = clamp(rect.top - pad, 8, window.innerHeight - 24);
    spot.style.left = `${Math.round(left)}px`;
    spot.style.top = `${Math.round(top)}px`;
    spot.style.width = `${Math.round(rect.width + pad * 2)}px`;
    spot.style.height = `${Math.round(rect.height + pad * 2)}px`;
    titleEl.textContent = step.title;
    bodyEl.textContent = step.body;
    const template = tour.step && tour.step.includes("{n}") ? tour.step : "{n} / {total}";
    progressEl.textContent = template
      .replace("{n}", String(index + 1))
      .replace("{total}", String(steps.length));
    skipBtn.textContent = tour.skip;
    backBtn.textContent = tour.back;
    backBtn.hidden = index === 0;
    backBtn.setAttribute("aria-hidden", index === 0 ? "true" : "false");
    nextBtn.textContent = index === steps.length - 1 ? tour.done : tour.next;
    placeCard(rect, step.place);
    nextBtn.focus();
  };

  const finish = () => {
    target?.classList.remove("is-tour-target");
    root.hidden = true;
    document.body.classList.remove("has-tour");
    window.removeEventListener("resize", paint);
    window.removeEventListener("keydown", onKey);
    fetch("/api/tour", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ done: true }),
    }).catch(() => {});
  };

  const onKey = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      finish();
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      nextBtn.click();
    }
    if (event.key === "ArrowLeft" && index > 0) {
      event.preventDefault();
      backBtn.click();
    }
  };

  skipBtn.addEventListener("click", finish);
  backBtn.addEventListener("click", () => {
    if (index === 0) return;
    index -= 1;
    paint();
  });
  nextBtn.addEventListener("click", () => {
    if (index >= steps.length - 1) return finish();
    index += 1;
    paint();
  });

  root.hidden = false;
  document.body.classList.add("has-tour");
  window.addEventListener("resize", paint);
  window.addEventListener("keydown", onKey);
  paint();
})();
