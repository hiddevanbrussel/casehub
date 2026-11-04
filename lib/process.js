const crypto = require("crypto");

const TO_NEXT = "__next__";
const TO_END = "__end__";
const DEMO_KEYS = new Set(["omgevings", "bezwaar", "kappen"]);
const DEMO_NAMES = {
  Omgevingsvergunning: "omgevings",
  "Bezwaar en beroep": "bezwaar",
  Bezwaar: "bezwaar",
  "Het kappen van bomen": "kappen",
  Kapvergunning: "kappen",
  "Planning permission": "omgevings",
  Objection: "bezwaar",
  "Tree-felling permit": "kappen",
  Miljøtilladelse: "omgevings",
  Klage: "bezwaar",
  Fældningstilladelse: "kappen",
  Umweltgenehmigung: "omgevings",
  Widerspruch: "bezwaar",
  Fällgenehmigung: "kappen",
};

const DEMO_COPY = {
  nl: {
    intake: "Intake",
    review: "Beoordeling",
    decision: "Besluit",
    checkApp: "Aanvraag controleren",
    checkFiles: "Bijlagen nakijken",
    complete: "Volledig",
    checkData: "Gegevens controleren",
    checkPolicy: "Toetsen aan beleid",
    approve: "Akkoord",
    moreInfo: "Aanvulling nodig",
    writeDecision: "Beschikking opstellen",
    finish: "Afronden",
  },
  en: {
    intake: "Intake",
    review: "Assessment",
    decision: "Decision",
    checkApp: "Check the application",
    checkFiles: "Review attachments",
    complete: "Complete",
    checkData: "Check the details",
    checkPolicy: "Assess against policy",
    approve: "Approve",
    moreInfo: "More information needed",
    writeDecision: "Draft the decision",
    finish: "Finish",
  },
  da: {
    intake: "Modtagelse",
    review: "Vurdering",
    decision: "Afgørelse",
    checkApp: "Kontrollér ansøgningen",
    checkFiles: "Gennemgå bilag",
    complete: "Fuldstændig",
    checkData: "Kontrollér oplysningerne",
    checkPolicy: "Vurdér efter politik",
    approve: "Godkend",
    moreInfo: "Der mangler oplysninger",
    writeDecision: "Udarbejd afgørelsen",
    finish: "Afslut",
  },
  de: {
    intake: "Eingang",
    review: "Prüfung",
    decision: "Bescheid",
    checkApp: "Antrag prüfen",
    checkFiles: "Anlagen prüfen",
    complete: "Vollständig",
    checkData: "Angaben prüfen",
    checkPolicy: "An der Richtlinie prüfen",
    approve: "Zustimmen",
    moreInfo: "Nachreichung nötig",
    writeDecision: "Bescheid erstellen",
    finish: "Abschließen",
  },
};

function newId() {
  return crypto.randomUUID();
}

function slugId(prefix, value) {
  const slug = String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `${prefix}-${slug || newId().slice(0, 8)}`;
}

function asList(value) {
  if (value == null || value === "") return [];
  if (Array.isArray(value)) return value;
  if (typeof value === "object") {
    return Object.keys(value)
      .sort((a, b) => Number(a) - Number(b))
      .map((key) => value[key]);
  }
  return [value];
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeTasks(raw, previous = []) {
  const prev = asList(previous).map((task) => ({
    id: String(task?.id || "").trim(),
    name: cleanText(task?.name),
  })).filter((task) => task.name);
  const used = new Set();
  const names = Array.isArray(raw)
    ? raw.map((task) => (typeof task === "string" ? task : task?.name))
    : String(raw || "").split(/\r?\n/);
  return names
    .map((name) => cleanText(name))
    .filter(Boolean)
    .map((name) => {
      const match = prev.find((task) => task.name === name && task.id && !used.has(task.id));
      if (match) {
        used.add(match.id);
        return { id: match.id, name };
      }
      const byOrder = prev.find((task) => task.id && !used.has(task.id));
      if (byOrder && !Array.isArray(raw)) {
        used.add(byOrder.id);
        return { id: byOrder.id, name };
      }
      return { id: newId(), name };
    });
}

function normalizeDecisions(raw, previous = []) {
  const prev = asList(previous);
  return asList(raw)
    .map((row, index) => {
      const label = cleanText(row?.label || row?.name);
      if (!label) return null;
      const prevRow = prev[index] || {};
      const id = String(row?.id || prevRow.id || "").trim() || newId();
      let toStepId = row?.toStepId;
      if (toStepId === undefined) toStepId = row?.to;
      if (toStepId === TO_NEXT) toStepId = undefined;
      if (toStepId === TO_END) toStepId = "";
      if (toStepId == null) return { id, label, toStepId: null };
      return { id, label, toStepId: String(toStepId) };
    })
    .filter(Boolean);
}

function normalizeSteps(raw) {
  const seen = new Set();
  return asList(raw)
    .map((row, index) => {
      const name = cleanText(row?.name);
      if (!name) return null;
      let id = String(row?.id || "").trim();
      if (!id || seen.has(id)) id = newId();
      seen.add(id);
      return {
        id,
        name,
        tasks: normalizeTasks(row?.tasks, row?.tasks),
        decisions: normalizeDecisions(row?.decisions, row?.decisions).map((decision) => ({
          id: decision.id,
          label: decision.label,
          toStepId: decision.toStepId == null ? "" : String(decision.toStepId),
        })),
      };
    })
    .filter(Boolean);
}

function resolveToStepId(raw, steps, index) {
  if (raw === TO_END || raw === "end") return "";
  if (raw === TO_NEXT || raw == null || raw === "") {
    return steps[index + 1]?.id || "";
  }
  if (/^\d+$/.test(String(raw))) {
    const target = steps[Number(raw)];
    return target ? target.id : "";
  }
  if (steps.some((step) => step.id === raw)) return raw;
  const byName = steps.find((step) => step.name === cleanText(raw));
  return byName ? byName.id : "";
}

function parseForm(body, existingSteps = []) {
  const previous = normalizeSteps(existingSteps);
  const rows = asList(body?.steps);
  const drafted = rows
    .map((row, index) => {
      const name = cleanText(row?.name);
      if (!name) return null;
      const prev = previous[index] || previous.find((step) => step.id && step.id === String(row?.id || "").trim()) || {};
      const id = String(row?.id || prev.id || "").trim() || newId();
      return {
        id,
        name,
        tasks: normalizeTasks(row?.tasks, prev.tasks),
        decisions: asList(row?.decisions)
          .map((decision, dIndex) => {
            const label = cleanText(decision?.label);
            if (!label) return null;
            const prevDecision = (prev.decisions || [])[dIndex] || {};
            return {
              id: String(decision?.id || prevDecision.id || "").trim() || newId(),
              label,
              toRaw: decision?.to,
            };
          })
          .filter(Boolean),
      };
    })
    .filter(Boolean);

  return drafted.map((step, index) => ({
    id: step.id,
    name: step.name,
    tasks: step.tasks,
    decisions: step.decisions.map((decision) => ({
      id: decision.id,
      label: decision.label,
      toStepId: resolveToStepId(decision.toRaw, drafted, index),
    })),
  }));
}

function currentIndex(steps, zaak) {
  if (!steps.length) return -1;
  if (zaak?.processDone) return steps.length - 1;
  const index = steps.findIndex((step) => step.id === zaak?.processStepId);
  return index === -1 ? 0 : index;
}

function implicitDecisions(steps, index) {
  const next = steps[index + 1];
  if (next) return [{ id: TO_NEXT, label: "", toStepId: next.id, implicit: true, kind: "next" }];
  return [{ id: TO_END, label: "", toStepId: "", implicit: true, kind: "end" }];
}

function viewForCase(zaak, type) {
  const steps = normalizeSteps(type?.processSteps);
  if (!steps.length) {
    return {
      enabled: false,
      done: false,
      currentIndex: -1,
      currentName: "",
      steps: [],
      tasks: [],
      decisions: [],
    };
  }
  const index = currentIndex(steps, zaak);
  const current = steps[index] || steps[0];
  const doneIds = new Set(Array.isArray(zaak?.processDoneTasks) ? zaak.processDoneTasks : []);
  const configured = (current.decisions || []).filter((decision) => decision.label);
  const decisions = configured.length
    ? configured.map((decision) => ({
        id: decision.id,
        label: decision.label,
        toStepId: decision.toStepId,
        implicit: false,
        kind: decision.toStepId ? "goto" : "end",
      }))
    : implicitDecisions(steps, index);
  return {
    enabled: true,
    done: Boolean(zaak?.processDone),
    currentIndex: index,
    currentName: current.name,
    steps: steps.map((step, stepIndex) => ({
      id: step.id,
      name: step.name,
      state: zaak?.processDone || stepIndex < index ? "done" : stepIndex === index ? "current" : "todo",
    })),
    tasks: (current.tasks || []).map((task) => ({
      id: task.id,
      name: task.name,
      done: doneIds.has(task.id),
    })),
    decisions,
  };
}

function syncCase(zaak, type) {
  const steps = normalizeSteps(type?.processSteps);
  if (!steps.length) {
    zaak.processStepId = "";
    zaak.processDoneTasks = [];
    zaak.processDone = false;
    return zaak;
  }
  if (zaak.processDone) {
    zaak.processStepId = steps[steps.length - 1].id;
    zaak.processDoneTasks = Array.isArray(zaak.processDoneTasks) ? zaak.processDoneTasks : [];
    zaak.processDone = true;
    return zaak;
  }
  if (!steps.some((step) => step.id === zaak.processStepId)) {
    zaak.processStepId = steps[0].id;
    zaak.processDoneTasks = [];
  }
  const current = steps.find((step) => step.id === zaak.processStepId) || steps[0];
  const valid = new Set((current.tasks || []).map((task) => task.id));
  zaak.processDoneTasks = (Array.isArray(zaak.processDoneTasks) ? zaak.processDoneTasks : []).filter((id) => valid.has(id));
  zaak.processDone = false;
  return zaak;
}

function seedCaseStep(zaak, type) {
  const steps = normalizeSteps(type?.processSteps);
  if (!steps.length) return syncCase(zaak, type);
  if (zaak.processStepId && steps.some((step) => step.id === zaak.processStepId)) {
    return syncCase(zaak, type);
  }
  if (zaak.processDone || ["afgerond", "geannuleerd"].includes(zaak.status)) {
    zaak.processStepId = steps[steps.length - 1].id;
    zaak.processDone = true;
    zaak.processDoneTasks = [];
    return zaak;
  }
  if (zaak.status === "wacht_op_info" || zaak.status === "in_behandeling") {
    zaak.processStepId = (steps[1] || steps[0]).id;
    zaak.processDoneTasks = [];
    zaak.processDone = false;
    return zaak;
  }
  zaak.processStepId = steps[0].id;
  zaak.processDoneTasks = [];
  zaak.processDone = false;
  return zaak;
}

function applyTask(zaak, type, taskId, done) {
  const steps = normalizeSteps(type?.processSteps);
  const index = currentIndex(steps, zaak);
  const current = steps[index];
  if (!current || zaak.processDone) return { ok: false, reason: "no-step" };
  const task = (current.tasks || []).find((item) => item.id === taskId);
  if (!task) return { ok: false, reason: "unknown-task" };
  const nextDone = done == null ? undefined : Boolean(done);
  const has = (zaak.processDoneTasks || []).includes(task.id);
  const shouldHave = nextDone == null ? !has : nextDone;
  zaak.processDoneTasks = shouldHave
    ? [...new Set([...(zaak.processDoneTasks || []), task.id])]
    : (zaak.processDoneTasks || []).filter((id) => id !== task.id);
  return { ok: true, task, done: shouldHave };
}

function applyDecision(zaak, type, decisionId) {
  const steps = normalizeSteps(type?.processSteps);
  const index = currentIndex(steps, zaak);
  const current = steps[index];
  if (!current || zaak.processDone) return { ok: false, reason: "no-step" };
  let targetId = null;
  let label = "";
  if (decisionId === TO_NEXT) {
    targetId = steps[index + 1]?.id || "";
    label = steps[index + 1]?.name || "";
  } else if (decisionId === TO_END) {
    targetId = "";
    label = current.name;
  } else {
    const decision = (current.decisions || []).find((item) => item.id === decisionId);
    if (!decision) return { ok: false, reason: "unknown-decision" };
    targetId = decision.toStepId == null ? steps[index + 1]?.id || "" : decision.toStepId;
    label = decision.label;
  }
  if (!targetId) {
    zaak.processDone = true;
    zaak.processStepId = current.id;
    zaak.processDoneTasks = [];
    return { ok: true, finished: true, label, from: current, to: null };
  }
  const target = steps.find((step) => step.id === targetId);
  if (!target) return { ok: false, reason: "unknown-step" };
  zaak.processStepId = target.id;
  zaak.processDoneTasks = [];
  zaak.processDone = false;
  return { ok: true, finished: false, label, from: current, to: target };
}

function municipalSteps(copy) {
  const intake = slugId("step", "intake");
  const review = slugId("step", "review");
  const decision = slugId("step", "decision");
  return [
    {
      id: intake,
      name: copy.intake,
      tasks: [
        { id: slugId("task", "check-app"), name: copy.checkApp },
        { id: slugId("task", "check-files"), name: copy.checkFiles },
      ],
      decisions: [{ id: slugId("dec", "complete"), label: copy.complete, toStepId: review }],
    },
    {
      id: review,
      name: copy.review,
      tasks: [
        { id: slugId("task", "check-data"), name: copy.checkData },
        { id: slugId("task", "check-policy"), name: copy.checkPolicy },
      ],
      decisions: [
        { id: slugId("dec", "approve"), label: copy.approve, toStepId: decision },
        { id: slugId("dec", "more-info"), label: copy.moreInfo, toStepId: intake },
      ],
    },
    {
      id: decision,
      name: copy.decision,
      tasks: [{ id: slugId("task", "write-decision"), name: copy.writeDecision }],
      decisions: [{ id: slugId("dec", "finish"), label: copy.finish, toStepId: "" }],
    },
  ];
}

function demoSteps(lang, key) {
  if (!DEMO_KEYS.has(key)) return [];
  return municipalSteps(DEMO_COPY[lang] || DEMO_COPY.nl);
}

const NAME_LANG = {
  Omgevingsvergunning: "nl",
  "Bezwaar en beroep": "nl",
  Bezwaar: "nl",
  "Het kappen van bomen": "nl",
  Kapvergunning: "nl",
  "Planning permission": "en",
  Objection: "en",
  "Tree-felling permit": "en",
  Miljøtilladelse: "da",
  Klage: "da",
  Fældningstilladelse: "da",
  Umweltgenehmigung: "de",
  Widerspruch: "de",
  Fällgenehmigung: "de",
};

function demoStepsForName(naam, lang) {
  const name = String(naam || "").trim();
  const key = DEMO_NAMES[name];
  return key ? demoSteps(lang || NAME_LANG[name] || "nl", key) : [];
}

function destinationValue(step, decision, steps, index) {
  if (!decision) return TO_NEXT;
  if (decision.toStepId === "") return TO_END;
  const targetIndex = steps.findIndex((item) => item.id === decision.toStepId);
  if (targetIndex === -1) return TO_NEXT;
  if (targetIndex === index + 1) return TO_NEXT;
  return String(targetIndex);
}

module.exports = {
  TO_NEXT,
  TO_END,
  normalizeSteps,
  parseForm,
  viewForCase,
  syncCase,
  seedCaseStep,
  applyTask,
  applyDecision,
  demoSteps,
  demoStepsForName,
  destinationValue,
};
