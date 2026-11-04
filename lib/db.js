const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { AsyncLocalStorage } = require("async_hooks");
const low = require("lowdb");
const FileSync = require("lowdb/adapters/FileSync");
const config = require("../config");
const { encrypt, decrypt, hashPassword, maskBsn, readSession } = require("./crypto");
const { nowIso, includesQ, fullName, monthLabel, parseStreet, STATUSSEN, PRIORITEITEN, ROLLEN, labelOf, overviewGroup, progressOf, OVERVIEW_GROUPS, ymdAddDays, ymdToday } = require("./format");
const { demoPack } = require("./demo-data");
const processLib = require("./process");

function createStore(dataDir, slug) {
fs.mkdirSync(path.join(dataDir, "uploads"), { recursive: true });

const dbPath = path.join(dataDir, "db.json");
const db = low(new FileSync(dbPath));

db.defaults({
  meta: {
    orgName: config.orgName,
    zaakPrefix: "ZH",
    nextZaakSeq: 1,
    nextPersoonSeq: 1,
    nextBedrijfSeq: 1,
    personeelPrefix: "P",
    nextPersoneelSeq: 1,
    appProfile: "cases",
    chrome: "paper",
  },
  werknemers: [],
  bedrijven: [],
  personen: [],
  zaken: [],
  bijlagen: [],
  recipes: [],
  documentJobs: [],
  zaaktypen: [],
  audit: [],
}).write();

const state = db.getState();
["werknemers", "bedrijven", "personen", "zaken", "bijlagen", "recipes", "documentJobs", "zaaktypen", "audit"].forEach((key) => {
  if (!Array.isArray(state[key])) db.set(key, []).write();
});
if (!state.meta || typeof state.meta !== "object") {
  db.set("meta", {
    orgName: config.orgName,
    zaakPrefix: "ZH",
    nextZaakSeq: 1,
    nextPersoonSeq: 1,
    nextBedrijfSeq: 1,
    personeelPrefix: "P",
    nextPersoneelSeq: 1,
    appProfile: "cases",
    chrome: "paper",
  }).write();
}

db.get("zaken")
  .forEach((z) => {
    if (z.zaaktype == null) z.zaaktype = "";
    if (z.referentie == null) z.referentie = "";
    if (z.voortgang == null) z.voortgang = progressOf(z);
  })
  .write();

db.get("personen")
  .forEach((p) => {
    if (!p.nummer) p.nummer = nextCode("persoon");
  })
  .write();
db.get("bedrijven")
  .forEach((b) => {
    if (!b.nummer) b.nummer = nextCode("bedrijf");
  })
  .write();

function nextCode(kind) {
  const meta = db.get("meta").value();
  if (kind === "persoon") {
    const n = meta.nextPersoonSeq || 1;
    db.set("meta.nextPersoonSeq", n + 1).write();
    return `PERS-${n}`;
  }
  const n = meta.nextBedrijfSeq || 1;
  db.set("meta.nextBedrijfSeq", n + 1).write();
  return `ORG-${n}`;
}

function caseCountForBedrijf(bid) {
  return db.get("zaken").filter((z) => (z.bedrijfIds || []).includes(bid)).size().value();
}

function caseCountForPersoon(pid) {
  return db.get("zaken").filter((z) => (z.persoonIds || []).includes(pid)).size().value();
}

function hydrateBedrijf(bedrijf) {
  if (!bedrijf) return null;
  const caseCount = caseCountForBedrijf(bedrijf.id);
  return {
    ...bedrijf,
    caseCount,
    group: caseCount ? "linked" : "idle",
    groupLabel: caseCount ? "With cases" : "No cases",
  };
}

function id() {
  return crypto.randomUUID();
}

function actorName(actor) {
  return actor ? fullName(actor) : "systeem";
}

function audit(actor, action, entity, entityId, detail, payload) {
  db.get("audit")
    .unshift({
      id: id(),
      at: nowIso(),
      actorId: actor?.id || null,
      actor: actorName(actor),
      action,
      entity,
      entityId,
      detail: detail || "",
      payload: payload || null,
    })
    .write();
  const extra = db.get("audit").value().length - 500;
  if (extra > 0) db.get("audit").splice(500, extra).write();
}

function nextZaaknummer() {
  const meta = db.get("meta").value();
  const year = new Date().getFullYear();
  const seq = String(meta.nextZaakSeq || 1).padStart(4, "0");
  db.set("meta.nextZaakSeq", (meta.nextZaakSeq || 1) + 1).write();
  return `${meta.zaakPrefix || "ZH"}-${year}-${seq}`;
}

function nextPersoneelnummer() {
  const meta = db.get("meta").value();
  const n = meta.nextPersoneelSeq || 1;
  db.set("meta.nextPersoneelSeq", n + 1).write();
  return `${meta.personeelPrefix || "P"}-${String(n).padStart(5, "0")}`;
}

function hydrateZaak(zaak) {
  if (!zaak) return null;
  const bedrijven = (zaak.bedrijfIds || []).map((bid) => db.get("bedrijven").find({ id: bid }).value()).filter(Boolean);
  const personen = (zaak.persoonIds || []).map((pid) => publicPersoon(db.get("personen").find({ id: pid }).value())).filter(Boolean);
  const behandelaar = zaak.behandelaarId
    ? db.get("werknemers").find({ id: zaak.behandelaarId }).value()
    : null;
  const bijlagen = db.get("bijlagen").filter({ zaakId: zaak.id }).value();
  const today = new Date().toISOString().slice(0, 10);
  const overdue = Boolean(
    zaak.deadline && zaak.deadline < today && !["afgerond", "geannuleerd"].includes(zaak.status)
  );
  const contact = personen[0];
  const zaaktypeRow = zaak.zaaktypeId
    ? db.get("zaaktypen").find({ id: zaak.zaaktypeId }).value()
    : null;
  const process = processLib.viewForCase(zaak, zaaktypeRow);
  return {
    ...zaak,
    zaaktype: (zaaktypeRow && zaaktypeRow.naam) || zaak.zaaktype || "",
    zaaktypeId: zaak.zaaktypeId || "",
    referentie: zaak.referentie || "",
    startdatum: (zaak.startdatum || zaak.createdAt || "").slice(0, 10),
    voortgang: progressOf(zaak),
    process,
    processStepName: process.currentName,
    statusLabel: labelOf(STATUSSEN, zaak.status),
    overviewGroup: overviewGroup(zaak.status),
    overviewLabel: OVERVIEW_GROUPS.find((g) => g.id === overviewGroup(zaak.status))?.label || zaak.status,
    prioriteitLabel: labelOf(PRIORITEITEN, zaak.prioriteit),
    overdue,
    bedrijven,
    personen,
    contactNaam: contact ? fullName(contact) : "—",
    behandelaar,
    behandelaarNaam: fullName(behandelaar),
    behandelaarInitials: behandelaar
      ? [behandelaar.voornaam, behandelaar.achternaam].filter(Boolean).map((part) => part[0]).slice(0, 2).join("").toUpperCase()
      : "",
    bijlagen,
    documentJobs: db.get("documentJobs").filter({ zaakId: zaak.id }).value(),
  };
}

function publicPersoon(persoon, { showBsn = false } = {}) {
  if (!persoon) return null;
  const bsn = decrypt(persoon.bsnEnc);
  const parsed = parseStreet(persoon.adres);
  return {
    ...persoon,
    naam: fullName(persoon),
    tussenvoegsel: persoon.tussenvoegsel || "",
    geslacht: persoon.geslacht || "",
    straat: persoon.straat || parsed.straat,
    huisnummer: persoon.huisnummer || parsed.huisnummer,
    land: persoon.land || "",
    bsnMasked: maskBsn(bsn),
    bsn: showBsn ? bsn : "",
    bedrijf: persoon.bedrijfId ? db.get("bedrijven").find({ id: persoon.bedrijfId }).value() : null,
    caseCount: caseCountForPersoon(persoon.id),
    group: persoon.anoniem ? "anon" : "active",
    groupLabel: persoon.anoniem ? "Anonymised" : "Active",
  };
}

function publicWerknemer(w) {
  if (!w) return null;
  const { wachtwoord, ...rest } = w;
  return {
    ...rest,
    naam: fullName(w),
    rolLabel: labelOf(ROLLEN, w.rol),
    personeelsnummer: w.personeelsnummer || "",
    aanhef: w.aanhef || "",
    geboortedatum: w.geboortedatum || "",
    straat: w.straat || "",
    huisnummer: w.huisnummer || "",
    postcode: w.postcode || "",
    plaats: w.plaats || "",
    datumIndiensttreding: w.datumIndiensttreding || "",
    functiebenaming: w.functiebenaming || "",
    inschaling: w.inschaling || "",
    salaris: w.salaris || "",
    leaseauto: Boolean(w.leaseauto),
    vestiging: w.vestiging || w.afdeling || "",
  };
}

function hydrateWerknemer(w) {
  if (!w) return null;
  const row = publicWerknemer(w);
  return {
    ...row,
    bijlagen: db.get("bijlagen").filter({ werknemerId: w.id }).value(),
    documentJobs: db.get("documentJobs").filter({ werknemerId: w.id }).value(),
  };
}

function hydrateZaaktype(row) {
  if (!row) return null;
  const recipes = db.get("recipes").value() || [];
  const recipeIds = row.recipeIds || [];
  const linked = recipeIds.map((rid) => recipes.find((r) => r.itemId === rid)).filter(Boolean);
  const processSteps = processLib.normalizeSteps(row.processSteps);
  return {
    ...row,
    leadTimeDays: Number(row.leadTimeDays) || 0,
    recipeIds,
    processSteps,
    processStepCount: processSteps.length,
    templateNames: linked.map((r) => r.name),
    templateCount: recipeIds.length,
    caseCount: db.get("zaken").filter((z) => z.zaaktypeId === row.id).size().value(),
  };
}

function linkCasesToZaaktypen() {
  const types = db.get("zaaktypen").value() || [];
  if (!types.length) return;
  db.get("zaken")
    .forEach((z) => {
      if (z.zaaktypeId && types.some((t) => t.id === z.zaaktypeId)) return;
      const match = types.find((t) => t.naam === z.zaaktype);
      if (match) z.zaaktypeId = match.id;
      else if (z.zaaktypeId == null) z.zaaktypeId = "";
    })
    .write();
}

function migrateZaaktypen() {
  if (!Array.isArray(db.getState().zaaktypen)) db.set("zaaktypen", []).write();
  if (db.get("zaaktypen").size().value() === 0) {
    const names = [...new Set(db.get("zaken").map((z) => String(z.zaaktype || "").trim()).value().filter(Boolean))];
    names.forEach((naam) => {
      db.get("zaaktypen")
        .push({
          id: crypto.randomUUID(),
          naam,
          leadTimeDays: 28,
          recipeIds: [],
          createdAt: nowIso(),
          updatedAt: nowIso(),
        })
        .write();
    });
  }
  linkCasesToZaaktypen();
}

const store = {
  db,
  slug,
  dataDir,
  meta() {
    return db.get("meta").value();
  },
  saveMeta(patch, actor) {
    db.get("meta").assign(patch).write();
    audit(actor, "gewijzigd", "instellingen", "meta", "Algemene instellingen bijgewerkt");
  },
  patchCreate(patch, actor, detail) {
    const current = db.get("meta.create").value() || {};
    db.set("meta.create", { ...current, ...patch }).write();
    if (actor) audit(actor, "gewijzigd", "instellingen", "create", detail || "Create-instellingen bijgewerkt");
  },
  patchAzure(patch, actor, detail) {
    const current = db.get("meta.azure").value() || {};
    db.set("meta.azure", { ...current, ...patch }).write();
    if (actor) audit(actor, "gewijzigd", "instellingen", "azure", detail || "Azure-instellingen bijgewerkt");
  },
  patchStuf(patch, actor, detail) {
    const current = db.get("meta.stufDcr").value() || {};
    db.set("meta.stufDcr", { ...current, ...patch }).write();
    if (actor) audit(actor, "gewijzigd", "instellingen", "stuf-dcr", detail || "StUF-DCR-instellingen bijgewerkt");
  },
  needsOnboarding() {
    return !db.get("meta.onboarded").value();
  },
  setupStep() {
    const meta = db.get("meta").value() || {};
    if (meta.onboarded) return "";
    if (!meta.setupOrgDone) return "org";
    if (!meta.setupProfileDone) return "profile";
    if (!db.get("werknemers").size().value()) return "admin";
    if (!meta.setupCreateDone) return "create";
    if (!meta.setupAzureDone) return "azure";
    return "azure";
  },
  completeOnboarding(actor) {
    db.get("meta")
      .assign({
        onboarded: true,
        setupOrgDone: true,
        setupProfileDone: true,
        setupCreateDone: true,
        setupAzureDone: true,
        onboardedAt: nowIso(),
      })
      .write();
    audit(actor, "afgerond", "instellingen", "onboarding", "Eerste installatie afgerond");
  },
  counts() {
    const zaken = db.get("zaken").value() || [];
    const byStatus = {
      nieuw: zaken.filter((z) => z.status === "nieuw").length,
      in_behandeling: zaken.filter((z) => z.status === "in_behandeling").length,
      wacht_op_info: zaken.filter((z) => z.status === "wacht_op_info").length,
      afgerond: zaken.filter((z) => z.status === "afgerond").length,
      geannuleerd: zaken.filter((z) => z.status === "geannuleerd").length,
    };
    return {
      zaken: zaken.length,
      open: byStatus.nieuw + byStatus.wacht_op_info,
      inProgress: byStatus.in_behandeling,
      closed: byStatus.afgerond,
      byStatus,
      bedrijven: db.get("bedrijven").size().value(),
      personen: db.get("personen").size().value(),
      werknemers: db.get("werknemers").size().value(),
    };
  },
  dashboardInsights(lang = "en") {
    const zaken = db.get("zaken").value() || [];
    const now = new Date();
    const startThis = new Date(now.getFullYear(), now.getMonth(), 1);
    const startPrev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const startNext = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const inRange = (iso, start, end) => {
      const t = new Date(iso).getTime();
      return Number.isFinite(t) && t >= start.getTime() && t < end.getTime();
    };
    const deltaPct = (current, previous) => {
      if (!previous || current === previous) return null;
      return Math.round(((current - previous) / previous) * 100);
    };
    const closedThis = zaken.filter((z) => z.status === "afgerond" && inRange(z.updatedAt, startThis, startNext)).length;
    const closedPrev = zaken.filter((z) => z.status === "afgerond" && inRange(z.updatedAt, startPrev, startThis)).length;
    const newThis = zaken.filter((z) => inRange(z.createdAt, startThis, startNext)).length;
    const newPrev = zaken.filter((z) => inRange(z.createdAt, startPrev, startThis)).length;
    const openNow = store.counts().open;
    const openPrev = Math.max(0, openNow - newThis + closedThis);
    const series = [];
    for (let i = 5; i >= 0; i -= 1) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const start = new Date(d.getFullYear(), d.getMonth(), 1);
      const end = new Date(d.getFullYear(), d.getMonth() + 1, 1);
      const closed = zaken.filter((z) => z.status === "afgerond" && inRange(z.updatedAt, start, end));
      const totalDays = closed.reduce((sum, z) => {
        const created = new Date(z.createdAt).getTime();
        const done = new Date(z.updatedAt).getTime();
        if (!Number.isFinite(created) || !Number.isFinite(done) || done < created) return sum;
        return sum + (done - created) / 86400000;
      }, 0);
      series.push({
        year: d.getFullYear(),
        month: d.getMonth(),
        label: monthLabel(d.getFullYear(), d.getMonth(), lang),
        days: closed.length ? Math.round(totalDays / closed.length) : null,
        count: closed.length,
      });
    }
    const withDays = series.filter((p) => p.days != null);
    const currentLead = withDays.length ? withDays[withDays.length - 1].days : null;
    const prevLead = withDays.length > 1 ? withDays[withDays.length - 2].days : null;
    const width = 520;
    const height = 176;
    const padLeft = 36;
    const padRight = 14;
    const padY = 22;
    const max = Math.max(40, ...series.map((p) => p.days || 0));
    const yOf = (days) => height - padY - (days / max) * (height - padY * 2);
    const pts = series.map((p, i) => {
      const x = padLeft + (i / Math.max(series.length - 1, 1)) * (width - padLeft - padRight);
      const y = p.days == null ? null : yOf(p.days);
      return { ...p, x, y };
    });
    const drawn = pts.filter((p) => p.y != null);
    if (drawn.length) drawn[drawn.length - 1].last = true;
    const line = drawn.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
    const area = drawn.length
      ? `${line} L${drawn[drawn.length - 1].x.toFixed(1)} ${height - padY} L${drawn[0].x.toFixed(1)} ${height - padY} Z`
      : "";
    const step = max <= 40 ? 10 : max <= 80 ? 20 : 25;
    const ticks = [];
    for (let n = 0; n <= max; n += step) ticks.push({ days: n, y: yOf(n) });
    return {
      closedThis,
      closedDelta: deltaPct(closedThis, closedPrev),
      newThis,
      newDelta: deltaPct(newThis, newPrev),
      openDelta: deltaPct(openNow, openPrev),
      overdue: store.overdueZaken().length,
      leadTime: {
        series: pts,
        ticks,
        line,
        area,
        width,
        height,
        padLeft,
        padRight,
        padY,
        current: currentLead,
        delta: currentLead != null && prevLead ? deltaPct(currentLead, prevLead) : null,
      },
    };
  },
  overdueZaken() {
    return store.zaken({}).filter((z) => z.overdue);
  },
  recentZaken(limit = 8) {
    return (db.get("zaken").take(limit).value() || []).map(hydrateZaak).filter(Boolean);
  },
  recentBijlagen(limit = 6) {
    return (db.get("bijlagen").take(limit).value() || [])
      .map((b) => {
        const zaak = b.zaakId ? db.get("zaken").find({ id: b.zaakId }).value() : null;
        const wn = b.werknemerId ? db.get("werknemers").find({ id: b.werknemerId }).value() : null;
        return {
          ...b,
          zaaknummer: zaak?.zaaknummer || (wn ? wn.personeelsnummer : ""),
          zaakTitel: zaak?.titel || (wn ? fullName(wn) : ""),
          zaakId: b.zaakId || "",
          werknemerId: b.werknemerId || "",
        };
      })
      .filter(Boolean);
  },
  auditLog(limit = 80) {
    return db.get("audit").take(limit).value() || [];
  },
  zaakActivity(zaak, limit = 40) {
    if (!zaak) return [];
    const jobIds = new Set((zaak.documentJobs || []).map((job) => job.id));
    const fileIds = new Set((zaak.bijlagen || []).map((file) => file.id));
    return db
      .get("audit")
      .filter((ev) => {
        if (ev.entity === "zaak" && ev.entityId === zaak.id) return true;
        if (fileIds.has(ev.entityId) || jobIds.has(ev.entityId)) return true;
        return false;
      })
      .take(limit)
      .value();
  },

  werknemers() {
    return (db.get("werknemers").value() || []).map(publicWerknemer).filter(Boolean);
  },
  rawWerknemers() {
    return db.get("werknemers").value();
  },
  rawWerknemer(wid) {
    return db.get("werknemers").find({ id: wid }).value() || null;
  },
  werknemer(wid) {
    return hydrateWerknemer(db.get("werknemers").find({ id: wid }).value());
  },
  werknemerByEmail(email) {
    return db.get("werknemers").find({ email: String(email || "").toLowerCase().trim() }).value();
  },
  saveWerknemer(input, actor) {
    const existing = input.id ? db.get("werknemers").find({ id: input.id }).value() : null;
    const email = String(input.email || "").toLowerCase().trim();
    const leaseVal = Array.isArray(input.leaseauto) ? input.leaseauto[input.leaseauto.length - 1] : input.leaseauto;
    const rol = input.rol === "global_admin" ? "admin" : (input.rol || existing?.rol || "medewerker");
    const record = {
      id: existing?.id || input.id || id(),
      personeelsnummer: existing?.personeelsnummer || input.personeelsnummer || nextPersoneelnummer(),
      voornaam: String(input.voornaam || "").trim(),
      achternaam: String(input.achternaam || "").trim(),
      email,
      rol,
      afdeling: String(input.afdeling || input.vestiging || existing?.afdeling || "").trim(),
      aanhef: String(input.aanhef || existing?.aanhef || "").trim(),
      geboortedatum: String(input.geboortedatum || existing?.geboortedatum || "").trim(),
      straat: String(input.straat || existing?.straat || "").trim(),
      huisnummer: String(input.huisnummer || existing?.huisnummer || "").trim(),
      postcode: String(input.postcode || existing?.postcode || "").trim(),
      plaats: String(input.plaats || existing?.plaats || "").trim(),
      datumIndiensttreding: String(input.datumIndiensttreding || existing?.datumIndiensttreding || "").trim(),
      functiebenaming: String(input.functiebenaming || existing?.functiebenaming || "").trim(),
      inschaling: String(input.inschaling || existing?.inschaling || "").trim(),
      salaris: String(input.salaris || existing?.salaris || "").trim(),
      leaseauto: leaseVal === undefined && existing
        ? Boolean(existing.leaseauto)
        : leaseVal === true || leaseVal === "1" || leaseVal === "on" || leaseVal === "ja",
      vestiging: String(input.vestiging || existing?.vestiging || "").trim(),
      authSource: input.authSource || existing?.authSource || "local",
      azureOid: input.azureOid || existing?.azureOid || "",
      tourDone: Boolean(existing?.tourDone),
      wachtwoord: input.wachtwoord
        ? hashPassword(input.wachtwoord)
        : (input.wachtwoordHash || existing?.wachtwoord || ""),
      createdAt: existing?.createdAt || nowIso(),
      updatedAt: nowIso(),
    };
    if (!record.voornaam) throw new Error("Name is required.");
    if (!record.wachtwoord && record.authSource !== "azure" && record.authSource !== "hr") {
      throw new Error("A password is required for a new employee.");
    }
    if (existing) db.get("werknemers").find({ id: existing.id }).assign(record).write();
    else db.get("werknemers").unshift(record).write();
    audit(actor, existing ? "gewijzigd" : "aangemaakt", "werknemer", record.id, fullName(record));
    return publicWerknemer(record);
  },
  deleteWerknemer(wid, actor) {
    const row = db.get("werknemers").find({ id: wid }).value();
    if (!row) return;
    db.get("werknemers").remove({ id: wid }).write();
    audit(actor, "verwijderd", "werknemer", wid, fullName(row));
  },
  markTourDone(wid) {
    const row = db.get("werknemers").find({ id: wid }).value();
    if (!row) return;
    db.get("werknemers").find({ id: wid }).assign({ tourDone: true }).write();
  },

  bedrijven(q, group) {
    return db
      .get("bedrijven")
      .filter((b) => {
        const text = `${b.handelsnaam} ${b.kvk} ${b.plaats} ${b.nummer || ""}`;
        const g = caseCountForBedrijf(b.id) ? "linked" : "idle";
        return includesQ(text, q) && (!group || g === group);
      })
      .value()
      .map(hydrateBedrijf);
  },
  bedrijf(bid) {
    return hydrateBedrijf(db.get("bedrijven").find({ id: bid }).value());
  },
  personenForBedrijf(bid) {
    if (!bid) return [];
    return db
      .get("personen")
      .filter((p) => p.bedrijfId === bid)
      .value()
      .map((p) => publicPersoon(p));
  },
  saveBedrijf(input, actor) {
    const existing = input.id ? db.get("bedrijven").find({ id: input.id }).value() : null;
    const record = {
      id: existing?.id || id(),
      nummer: existing?.nummer || nextCode("bedrijf"),
      handelsnaam: input.handelsnaam.trim(),
      kvk: input.kvk?.trim() || "",
      adres: input.adres?.trim() || "",
      postcode: input.postcode?.trim() || "",
      plaats: input.plaats?.trim() || "",
      email: input.email?.trim() || "",
      telefoon: input.telefoon?.trim() || "",
      notities: input.notities?.trim() || "",
      createdAt: existing?.createdAt || nowIso(),
      updatedAt: nowIso(),
    };
    if (existing) db.get("bedrijven").find({ id: existing.id }).assign(record).write();
    else db.get("bedrijven").unshift(record).write();
    audit(actor, existing ? "gewijzigd" : "aangemaakt", "bedrijf", record.id, record.handelsnaam);
    return record;
  },
  deleteBedrijf(bid, actor) {
    const row = db.get("bedrijven").find({ id: bid }).value();
    if (!row) return;
    db.get("bedrijven").remove({ id: bid }).write();
    db.get("zaken").forEach((z) => {
      z.bedrijfIds = (z.bedrijfIds || []).filter((id) => id !== bid);
    }).write();
    audit(actor, "verwijderd", "bedrijf", bid, row.handelsnaam);
  },

  personen(q, group) {
    return db
      .get("personen")
      .filter((p) => {
        const text = `${p.voornaam} ${p.achternaam} ${p.email} ${p.nummer || ""}`;
        const g = p.anoniem ? "anon" : "active";
        return includesQ(text, q) && (!group || g === group);
      })
      .value()
      .map((p) => publicPersoon(p));
  },
  persoon(pid, opts) {
    return publicPersoon(db.get("personen").find({ id: pid }).value(), opts);
  },
  savePersoon(input, actor) {
    const existing = input.id ? db.get("personen").find({ id: input.id }).value() : null;
    const bsn = (input.bsn || "").replace(/\D/g, "");
    const straat = input.straat?.trim() || "";
    const huisnummer = input.huisnummer?.trim() || "";
    const record = {
      id: existing?.id || id(),
      nummer: existing?.nummer || nextCode("persoon"),
      voornaam: input.voornaam.trim(),
      tussenvoegsel: input.tussenvoegsel?.trim() || "",
      achternaam: input.achternaam.trim(),
      geslacht: input.geslacht || "",
      email: input.email?.trim() || "",
      telefoon: input.telefoon?.trim() || "",
      straat,
      huisnummer,
      adres: [straat, huisnummer].filter(Boolean).join(" ") || input.adres?.trim() || existing?.adres || "",
      postcode: input.postcode?.trim() || "",
      plaats: input.plaats?.trim() || "",
      land: input.land?.trim() || "",
      geboortedatum: input.geboortedatum || "",
      bedrijfId: input.bedrijfId || "",
      bsnEnc: bsn ? encrypt(bsn) : existing?.bsnEnc || "",
      anoniem: false,
      createdAt: existing?.createdAt || nowIso(),
      updatedAt: nowIso(),
    };
    if (existing) db.get("personen").find({ id: existing.id }).assign(record).write();
    else db.get("personen").unshift(record).write();
    audit(actor, existing ? "gewijzigd" : "aangemaakt", "persoon", record.id, fullName(record));
    return publicPersoon(record);
  },
  anonymizePersoon(pid, actor) {
    const row = db.get("personen").find({ id: pid }).value();
    if (!row) return;
    db.get("personen")
      .find({ id: pid })
      .assign({
        voornaam: "Geanonimiseerd",
        tussenvoegsel: "",
        achternaam: "",
        geslacht: "",
        email: "",
        telefoon: "",
        straat: "",
        huisnummer: "",
        adres: "",
        postcode: "",
        plaats: "",
        land: "",
        geboortedatum: "",
        bsnEnc: "",
        anoniem: true,
        updatedAt: nowIso(),
      })
      .write();
    audit(actor, "geanonimiseerd", "persoon", pid, "AVG recht op vergetelheid");
  },
  deletePersoon(pid, actor) {
    const row = db.get("personen").find({ id: pid }).value();
    if (!row) return;
    db.get("personen").remove({ id: pid }).write();
    db.get("zaken").forEach((z) => {
      z.persoonIds = (z.persoonIds || []).filter((id) => id !== pid);
    }).write();
    audit(actor, "verwijderd", "persoon", pid, fullName(row));
  },

  importDemoRegistry(lang, actor) {
    const pack = demoPack(lang);
    const companyIds = {};
    const personIds = {};
    let companies = 0;
    let persons = 0;
    let cases = 0;
    pack.companies.forEach((item) => {
      const email = String(item.email || "").toLowerCase();
      const existing =
        db.get("bedrijven").find((b) => String(b.email || "").toLowerCase() === email).value() ||
        db.get("bedrijven").find({ kvk: item.kvk }).value() ||
        db.get("bedrijven").find({ handelsnaam: item.handelsnaam }).value();
      if (existing) {
        companyIds[item.key] = existing.id;
        return;
      }
      const row = store.saveBedrijf(item, actor);
      companyIds[item.key] = row.id;
      companies += 1;
    });
    pack.persons.forEach((item) => {
      const email = String(item.email || "").toLowerCase();
      const existing = db.get("personen").find((p) => String(p.email || "").toLowerCase() === email).value();
      if (existing) {
        if (item.key) personIds[item.key] = existing.id;
        return;
      }
      const row = store.savePersoon(
        {
          ...item,
          bedrijfId: item.companyKey ? companyIds[item.companyKey] || "" : "",
        },
        actor
      );
      if (item.key) personIds[item.key] = row.id;
      persons += 1;
    });
    let types = 0;
    const typeIds = {};
    (pack.caseTypes || []).forEach((item) => {
      const existing = db.get("zaaktypen").find({ naam: item.naam }).value();
      if (existing) {
        typeIds[item.key] = existing.id;
        if (!processLib.normalizeSteps(existing.processSteps).length) {
          const steps = processLib.demoSteps(lang, item.key);
          if (steps.length) {
            store.saveZaaktype(
              {
                id: existing.id,
                naam: existing.naam,
                leadTimeDays: existing.leadTimeDays,
                recipeIds: existing.recipeIds,
                processSteps: steps,
              },
              actor
            );
          }
        }
        return;
      }
      const row = store.saveZaaktype(
        {
          naam: item.naam,
          leadTimeDays: item.leadTimeDays,
          recipeIds: [],
          processSteps: processLib.demoSteps(lang, item.key),
        },
        actor
      );
      typeIds[item.key] = row.id;
      types += 1;
    });
    const behandelaar =
      db.get("werknemers").find({ rol: "zaakmanager" }).value() ||
      db.get("werknemers").find({ rol: "admin" }).value();
    (pack.cases || []).forEach((item) => {
      const typeId = typeIds[item.zaaktypeHint];
      const type = typeId ? db.get("zaaktypen").find({ id: typeId }).value() : null;
      const existing = db.get("zaken").find({ titel: item.titel }).value();
      if (existing) {
        if (type && !existing.zaaktypeId) {
          db.get("zaken")
            .find({ id: existing.id })
            .assign({ zaaktypeId: type.id, zaaktype: type.naam, updatedAt: nowIso() })
            .write();
        }
        return;
      }
      store.saveZaak(
        {
          titel: item.titel,
          omschrijving: item.omschrijving,
          zaaktypeId: type?.id || "",
          zaaktype: type?.naam || "",
          referentie: item.referentie || "",
          status: item.status || "nieuw",
          prioriteit: item.prioriteit || "normaal",
          voortgang: item.voortgang,
          startdatum: ymdAddDays(ymdToday(), item.startDays || 0),
          deadline: ymdAddDays(ymdToday(), item.deadlineDays || 14),
          behandelaarId: behandelaar?.id || "",
          bedrijfIds: item.companyKey && companyIds[item.companyKey] ? [companyIds[item.companyKey]] : [],
          persoonIds: item.personKey && personIds[item.personKey] ? [personIds[item.personKey]] : [],
        },
        actor
      );
      cases += 1;
    });
    return { companies, persons, cases, types };
  },

  zaken({ q, status, zaaktypeId, prioriteit } = {}) {
    return db
      .get("zaken")
      .filter((z) => {
        const personen = (z.persoonIds || [])
          .map((pid) => db.get("personen").find({ id: pid }).value())
          .filter(Boolean);
        const names = personen.map((p) => `${p.voornaam} ${p.achternaam}`).join(" ");
        const text = `${z.zaaknummer} ${z.titel} ${z.omschrijving} ${z.zaaktype || ""} ${z.referentie || ""} ${names}`;
        const group = overviewGroup(z.status);
        const statusOk = !status || z.status === status || group === status;
        const typeOk = !zaaktypeId || z.zaaktypeId === zaaktypeId;
        const prioOk = !prioriteit || z.prioriteit === prioriteit;
        return includesQ(text, q) && statusOk && typeOk && prioOk;
      })
      .value()
      .map(hydrateZaak);
  },
  zaak(zid) {
    return hydrateZaak(db.get("zaken").find({ id: zid }).value());
  },
  saveZaak(input, actor) {
    const existing = input.id ? db.get("zaken").find({ id: input.id }).value() : null;
    const record = {
      id: existing?.id || id(),
      zaaknummer: existing?.zaaknummer || nextZaaknummer(),
      titel: input.titel.trim(),
      omschrijving: input.omschrijving?.trim() || "",
      zaaktypeId: input.zaaktypeId || existing?.zaaktypeId || "",
      zaaktype: input.zaaktype?.trim() || existing?.zaaktype || "",
      referentie: input.referentie?.trim() || existing?.referentie || "",
      startdatum: String(input.startdatum || existing?.startdatum || existing?.createdAt || nowIso()).slice(0, 10),
      voortgang: input.voortgang === undefined || input.voortgang === ""
        ? existing?.voortgang ?? progressOf({ status: input.status || existing?.status || "nieuw" })
        : Math.max(0, Math.min(100, Number(input.voortgang) || 0)),
      status: input.status || "nieuw",
      prioriteit: input.prioriteit || "normaal",
      deadline: input.deadline || "",
      behandelaarId: input.behandelaarId || "",
      bedrijfIds: [].concat(input.bedrijfIds || []).filter(Boolean),
      persoonIds: [].concat(input.persoonIds || []).filter(Boolean),
      createdAt: existing?.createdAt || nowIso(),
      updatedAt: nowIso(),
      createdBy: existing?.createdBy || actorName(actor),
    };
    const type = record.zaaktypeId ? db.get("zaaktypen").find({ id: record.zaaktypeId }).value() : null;
    if (type) {
      record.zaaktype = type.naam;
    }
    const typeChanged = Boolean(existing && existing.zaaktypeId && existing.zaaktypeId !== record.zaaktypeId);
    if (typeChanged) {
      record.processStepId = "";
      record.processDoneTasks = [];
      record.processDone = false;
      processLib.seedCaseStep(record, type);
    } else {
      record.processStepId = input.processStepId !== undefined ? input.processStepId : existing?.processStepId || "";
      record.processDoneTasks = Array.isArray(input.processDoneTasks)
        ? input.processDoneTasks
        : existing?.processDoneTasks || [];
      record.processDone = input.processDone !== undefined ? Boolean(input.processDone) : Boolean(existing?.processDone);
      if (!existing || !record.processStepId) processLib.seedCaseStep(record, type);
      else processLib.syncCase(record, type);
    }
    if (!record.deadline && record.startdatum) {
      record.deadline = ymdAddDays(record.startdatum, type?.leadTimeDays || 0);
    }
    if (!record.deadline) record.deadline = existing?.deadline || "";
    if (existing) db.get("zaken").find({ id: existing.id }).assign(record).write();
    else db.get("zaken").unshift(record).write();
    audit(actor, existing ? "gewijzigd" : "aangemaakt", "zaak", record.id, record.zaaknummer);
    return hydrateZaak(record);
  },
  saveCaseProcess(zid, patch, actor, detail) {
    const existing = db.get("zaken").find({ id: zid }).value();
    if (!existing) return null;
    const type = existing.zaaktypeId ? db.get("zaaktypen").find({ id: existing.zaaktypeId }).value() : null;
    const next = {
      ...existing,
      processStepId: patch.processStepId !== undefined ? patch.processStepId : existing.processStepId,
      processDoneTasks: Array.isArray(patch.processDoneTasks) ? patch.processDoneTasks : existing.processDoneTasks || [],
      processDone: patch.processDone !== undefined ? Boolean(patch.processDone) : Boolean(existing.processDone),
      updatedAt: nowIso(),
    };
    processLib.syncCase(next, type);
    db.get("zaken")
      .find({ id: zid })
      .assign({
        processStepId: next.processStepId,
        processDoneTasks: next.processDoneTasks,
        processDone: next.processDone,
        updatedAt: next.updatedAt,
      })
      .write();
    audit(actor, "proces", "zaak", zid, detail || existing.zaaknummer);
    return hydrateZaak(db.get("zaken").find({ id: zid }).value());
  },
  deleteZaak(zid, actor) {
    const row = db.get("zaken").find({ id: zid }).value();
    if (!row) return;
    db.get("zaken").remove({ id: zid }).write();
    db.get("bijlagen")
      .filter({ zaakId: zid })
      .value()
      .forEach((b) => {
        try {
          fs.unlinkSync(path.join(dataDir, "uploads", b.stored));
        } catch {
          /* ignore */
        }
      });
    db.get("bijlagen").remove({ zaakId: zid }).write();
    db.get("documentJobs").remove({ zaakId: zid }).write();
    audit(actor, "verwijderd", "zaak", zid, row.zaaknummer);
  },
  addBijlage(owner, file, actor) {
    const zaakId = typeof owner === "string" ? owner : owner?.zaakId || "";
    const werknemerId = typeof owner === "object" ? owner?.werknemerId || "" : "";
    const record = {
      id: id(),
      zaakId,
      werknemerId,
      naam: file.originalname,
      stored: file.filename,
      size: file.size,
      mime: file.mimetype,
      at: nowIso(),
      by: actorName(actor),
    };
    db.get("bijlagen").unshift(record).write();
    audit(actor, "bijlage", zaakId ? "zaak" : "werknemer", zaakId || werknemerId, file.originalname);
    return record;
  },
  bijlage(bid) {
    return db.get("bijlagen").find({ id: bid }).value();
  },
  deleteBijlage(bid, actor) {
    const row = db.get("bijlagen").find({ id: bid }).value();
    if (!row) return;
    try {
      fs.unlinkSync(path.join(dataDir, "uploads", row.stored));
    } catch {
      /* ignore */
    }
    db.get("bijlagen").remove({ id: bid }).write();
    db.get("documentJobs")
      .filter({ bijlageId: bid })
      .value()
      .forEach((job) => {
        db.get("documentJobs").remove({ id: job.id }).write();
      });
    audit(actor, "verwijderd", "document", bid, row.naam);
  },
  log(actor, action, entity, entityId, detail, payload) {
    audit(actor, action, entity, entityId, detail, payload);
  },
  recipes() {
    return db.get("recipes").value();
  },
  recipe(itemId) {
    return db.get("recipes").find({ itemId }).value();
  },
  replaceRecipes(list, actor) {
    db.set("recipes", list).write();
    audit(actor, "gesynchroniseerd", "recipe", "create", `${list.length} templates`);
    return list;
  },
  documentJob(jobId) {
    return db.get("documentJobs").find({ id: jobId }).value();
  },
  addDocumentJob(input, actor) {
    const record = {
      id: id(),
      zaakId: input.zaakId || "",
      werknemerId: input.werknemerId || "",
      recipeId: input.recipeId,
      recipeName: input.recipeName || "",
      persoonId: input.persoonId || "",
      bedrijfId: input.bedrijfId || "",
      stakeholderName: input.stakeholderName || "",
      mode: input.mode || "",
      request: input.request || null,
      status: input.status || "prepared",
      token: input.token || crypto.randomBytes(24).toString("hex"),
      finalizeUrl: input.finalizeUrl || "",
      expiresAtUtc: input.expiresAtUtc || "",
      returnUrl: input.returnUrl || "",
      webhookUrl: input.webhookUrl || "",
      webhookAt: input.webhookAt || "",
      webhookStatus: input.webhookStatus || "",
      webhookDetail: input.webhookDetail || "",
      documentGenerationId: "",
      channel: input.channel || "",
      stufReferentienummer: input.stufReferentienummer || "",
      documentUrl: "",
      bijlageId: "",
      error: "",
      createdAt: nowIso(),
      updatedAt: nowIso(),
      createdBy: actorName(actor),
    };
    db.get("documentJobs").unshift(record).write();
    return record;
  },
  updateDocumentJob(jobId, patch, actor) {
    const row = db.get("documentJobs").find({ id: jobId });
    if (!row.value()) return null;
    row.assign({ ...patch, updatedAt: nowIso() }).write();
    if (actor || patch.status) {
      audit(actor, patch.status || "gewijzigd", "document", jobId, patch.error || patch.recipeName || "");
    }
    return row.value();
  },
  deleteDocumentJob(jobId, actor) {
    const row = db.get("documentJobs").find({ id: jobId }).value();
    if (!row) return;
    if (row.bijlageId) this.deleteBijlage(row.bijlageId, actor);
    db.get("documentJobs").remove({ id: jobId }).write();
    audit(actor, "verwijderd", "document", jobId, row.recipeName || "");
  },
  zaaktypen() {
    return db.get("zaaktypen").sortBy("naam").value().map(hydrateZaaktype);
  },
  zaaktype(tid) {
    return hydrateZaaktype(db.get("zaaktypen").find({ id: tid }).value());
  },
  saveZaaktype(input, actor) {
    const existing = input.id ? db.get("zaaktypen").find({ id: input.id }).value() : null;
    const record = {
      id: existing?.id || id(),
      naam: String(input.naam || "").trim(),
      leadTimeDays: Math.max(0, Number.parseInt(input.leadTimeDays, 10) || 0),
      recipeIds: [].concat(input.recipeIds || []).filter(Boolean),
      processSteps: processLib.normalizeSteps(
        input.processSteps !== undefined ? input.processSteps : existing?.processSteps
      ),
      createdAt: existing?.createdAt || nowIso(),
      updatedAt: nowIso(),
    };
    if (!record.naam) throw new Error("Name is required.");
    if (existing) db.get("zaaktypen").find({ id: existing.id }).assign(record).write();
    else db.get("zaaktypen").unshift(record).write();
    db.get("zaken")
      .filter({ zaaktypeId: record.id })
      .forEach((z) => {
        z.zaaktype = record.naam;
        processLib.syncCase(z, record);
      })
      .write();
    audit(actor, existing ? "gewijzigd" : "aangemaakt", "zaaktype", record.id, record.naam);
    return hydrateZaaktype(record);
  },
  deleteZaaktype(tid, actor) {
    const row = db.get("zaaktypen").find({ id: tid }).value();
    if (!row) return;
    db.get("zaaktypen").remove({ id: tid }).write();
    db.get("zaken")
      .filter({ zaaktypeId: tid })
      .forEach((z) => {
        z.zaaktypeId = "";
      })
      .write();
    audit(actor, "verwijderd", "zaaktype", tid, row.naam);
  },
  search(q) {
    const query = String(q || "").trim();
    if (query.length < 2) return { zaken: [], bedrijven: [], personen: [], werknemers: [] };
    return {
      zaken: store.zaken({ q: query }).slice(0, 6),
      bedrijven: store.bedrijven(query).slice(0, 6),
      personen: store.personen(query).slice(0, 6),
      werknemers: store.werknemers().filter((w) => includesQ(`${w.naam} ${w.email} ${w.personeelsnummer} ${w.functiebenaming} ${w.vestiging}`, query)).slice(0, 6),
    };
  },
};

migrateZaaktypen();

function migrateProcess() {
  const types = db.get("zaaktypen").value() || [];
  types.forEach((row) => {
    if (Array.isArray(row.processSteps)) {
      row.processSteps = processLib.normalizeSteps(row.processSteps);
      return;
    }
    row.processSteps = processLib.demoStepsForName(row.naam);
  });
  db.set("zaaktypen", types).write();
  db.get("zaken")
    .forEach((zaak) => {
      const type = types.find((row) => row.id === zaak.zaaktypeId);
      processLib.seedCaseStep(zaak, type);
    })
    .write();
}

migrateProcess();

function migrateOnboarding() {
  const meta = db.get("meta").value() || {};
  if (!meta.personeelPrefix) db.set("meta.personeelPrefix", "P").write();
  if (!meta.nextPersoneelSeq) db.set("meta.nextPersoneelSeq", 1).write();
  if (!meta.appProfile) db.set("meta.appProfile", "cases").write();
  db.get("werknemers")
    .value()
    .forEach((w) => {
      if (w.personeelsnummer) return;
      db.get("werknemers").find({ id: w.id }).assign({ personeelsnummer: nextPersoneelnummer() }).write();
    });
  if (db.get("meta.onboarded").value()) return;
  if (db.get("werknemers").size().value() > 0) {
    db.get("meta")
      .assign({ onboarded: true, setupOrgDone: true, setupProfileDone: true, setupCreateDone: true, setupAzureDone: true, appProfile: meta.appProfile || "cases" })
      .write();
  }
}

migrateOnboarding();

function seedUsers() {
  if (db.get("werknemers").size().value() > 0) return db.get("werknemers").find({ rol: "admin" }).value();
  const admin = store.saveWerknemer(
    {
      voornaam: "Anna",
      achternaam: "Hendriks",
      email: "admin@zaakhub.local",
      rol: "admin",
      afdeling: "Beheer",
      wachtwoord: "ChangeMe!Admin",
    },
    null
  );
  const manager = store.saveWerknemer(
    {
      voornaam: "Bram",
      achternaam: "Vos",
      email: "manager@zaakhub.local",
      rol: "zaakmanager",
      afdeling: "Vergunningen",
      wachtwoord: "ChangeMe!Manager",
    },
    admin
  );
  store.saveWerknemer(
    {
      voornaam: "Sara",
      achternaam: "Klein",
      email: "medewerker@zaakhub.local",
      rol: "medewerker",
      afdeling: "Klantcontact",
      wachtwoord: "ChangeMe!User",
    },
    admin
  );
  return admin;
}

function seedIfEmpty() {
  if (db.get("werknemers").size().value() > 0) return false;
  const admin = seedUsers();
  const manager = store.werknemers().find((w) => w.rol === "zaakmanager") || admin;

  const gemeente = store.saveBedrijf(
    {
      handelsnaam: "Gemeente Voorbeeld",
      kvk: "12345678",
      adres: "Raadhuisplein 1",
      postcode: "1234 AB",
      plaats: "Voorbeeld",
      email: "info@voorbeeld.nl",
      telefoon: "030 123 4567",
    },
    admin
  );
  const aannemer = store.saveBedrijf(
    {
      handelsnaam: "Bouwbedrijf De Linden B.V.",
      kvk: "87654321",
      adres: "Industrieweg 44",
      postcode: "1234 CD",
      plaats: "Voorbeeld",
      email: "kantoor@delinden.nl",
      telefoon: "030 765 4321",
    },
    admin
  );

  const jan = store.savePersoon(
    {
      voornaam: "Jan",
      achternaam: "de Vries",
      email: "jan.devries@voorbeeld.nl",
      telefoon: "06 1234 5678",
      adres: "Brinklaan 12",
      postcode: "1234 EF",
      plaats: "Voorbeeld",
      geboortedatum: "1978-04-12",
      bsn: "123456789",
      bedrijfId: "",
    },
    admin
  );
  store.savePersoon(
    {
      voornaam: "Marieke",
      achternaam: "Bakker",
      email: "m.bakker@delinden.nl",
      telefoon: "06 8765 4321",
      adres: "Kerkstraat 8",
      postcode: "1234 GH",
      plaats: "Voorbeeld",
      geboortedatum: "1991-09-03",
      bsn: "987654321",
      bedrijfId: aannemer.id,
    },
    admin
  );

  const kappen = store.saveZaaktype(
    { naam: "Het kappen van bomen", leadTimeDays: 14, processSteps: processLib.demoSteps("nl", "kappen") },
    admin
  );
  const bezwaar = store.saveZaaktype(
    { naam: "Bezwaar en beroep", leadTimeDays: 42, processSteps: processLib.demoSteps("nl", "bezwaar") },
    admin
  );
  const melding = store.saveZaaktype({ naam: "Sagsbehandling", leadTimeDays: 7 }, admin);
  const welkom = store.saveZaaktype({ naam: "Welkomst brief voor nieuwe inwoner", leadTimeDays: 21 }, admin);
  const omgevings = store.saveZaaktype(
    { naam: "Omgevingsvergunning", leadTimeDays: 56, processSteps: processLib.demoSteps("nl", "omgevings") },
    admin
  );

  store.saveZaak(
    {
      titel: "Kapvergunning eik Brinklaan 12",
      omschrijving: "Aanvraag tot kappen van een monumentale eik in de voortuin wegens wortelschade aan de fundering.",
      zaaktypeId: kappen.id,
      referentie: "PA-1233-8765",
      voortgang: 100,
      status: "in_behandeling",
      prioriteit: "hoog",
      deadline: new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10),
      behandelaarId: manager.id,
      bedrijfIds: [gemeente.id],
      persoonIds: [jan.id],
    },
    admin
  );
  store.saveZaak(
    {
      titel: "Bezwaar WOZ-waarde 2026",
      omschrijving: "Bezwaar tegen de WOZ-beschikking. Verzoeker stelt dat de vergelijkingspanden niet representatief zijn.",
      zaaktypeId: bezwaar.id,
      referentie: "WOZ-2026-441",
      voortgang: 25,
      status: "wacht_op_info",
      prioriteit: "normaal",
      deadline: new Date(Date.now() + 28 * 86400000).toISOString().slice(0, 10),
      behandelaarId: manager.id,
      bedrijfIds: [],
      persoonIds: [jan.id],
    },
    admin
  );
  store.saveZaak(
    {
      titel: "Melding geluidshinder Industrieweg",
      omschrijving: "Omwonenden melden structurele geluidshinder buiten de vergunde tijden.",
      zaaktypeId: melding.id,
      referentie: "",
      voortgang: 0,
      status: "nieuw",
      prioriteit: "urgent",
      deadline: new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10),
      behandelaarId: manager.id,
      bedrijfIds: [aannemer.id],
      persoonIds: [],
    },
    admin
  );
  store.saveZaak(
    {
      titel: "Welkom in uw nieuwe gemeente",
      omschrijving: "Intake voor nieuwe inwoner en toekennen van basisvoorzieningen.",
      zaaktypeId: welkom.id,
      referentie: "PA-1233-8785",
      voortgang: 0,
      status: "nieuw",
      prioriteit: "normaal",
      deadline: new Date(Date.now() + 21 * 86400000).toISOString().slice(0, 10),
      behandelaarId: manager.id,
      bedrijfIds: [gemeente.id],
      persoonIds: [jan.id],
    },
    admin
  );
  store.saveZaak(
    {
      titel: "Omgevingsvergunning aanbouw",
      omschrijving: "Aanvraag voor een aanbouw aan de achtergevel.",
      zaaktypeId: omgevings.id,
      referentie: "OV-8841",
      voortgang: 0,
      status: "nieuw",
      prioriteit: "hoog",
      deadline: new Date(Date.now() + 40 * 86400000).toISOString().slice(0, 10),
      behandelaarId: manager.id,
      bedrijfIds: [aannemer.id],
      persoonIds: [],
    },
    admin
  );
  store.completeOnboarding(admin);
  return true;
}

  store.seedUsers = seedUsers;
  store.seedIfEmpty = seedIfEmpty;
  return store;
}

const als = new AsyncLocalStorage();
const cache = new Map();

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

function platformPath() {
  return path.join(config.dataDir, "platform.json");
}

function readPlatform() {
  try {
    return JSON.parse(fs.readFileSync(platformPath(), "utf8"));
  } catch {
    return { workspaces: [], users: [] };
  }
}

function needsPlatformSetup() {
  if (!platformUsers().some((item) => item.rol === "global_admin")) return true;
  if (!workspaces().length) return true;
  return readPlatform().setupAzureDone === false;
}

function platformSetupStep() {
  if (!platformUsers().some((item) => item.rol === "global_admin")) return "admin";
  if (!workspaces().length) return "firstWorkspace";
  if (readPlatform().setupAzureDone === false) return "azure";
  return "";
}

function setPlatformAzureDone(done) {
  const platform = readPlatform();
  platform.setupAzureDone = Boolean(done);
  writePlatform(platform);
}

function writePlatform(data) {
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.writeFileSync(platformPath(), `${JSON.stringify(data, null, 2)}\n`);
}

const PLATFORM_SESSION = "__platform";

function publicPlatformUser(user) {
  if (!user) return null;
  const { wachtwoord, ...rest } = user;
  return {
    ...rest,
    naam: fullName(user),
    rol: "global_admin",
    rolLabel: "Superadmin",
    global: true,
  };
}

function platformUsers() {
  return readPlatform().users || [];
}

function platformUser(id) {
  return platformUsers().find((item) => item.id === id) || null;
}

function platformUserEmails(user) {
  return [user?.email, user?.azureEmail].map((item) => String(item || "").toLowerCase().trim()).filter(Boolean);
}

function platformUserByEmail(email) {
  const needles = (Array.isArray(email) ? email : [email])
    .map((item) => String(item || "").toLowerCase().trim())
    .filter(Boolean);
  if (!needles.length) return null;
  return platformUsers().find((item) => platformUserEmails(item).some((mail) => needles.includes(mail))) || null;
}

function platformUserByAzure(oid, email) {
  const oidNeedle = String(oid || "").trim();
  if (oidNeedle) {
    const hit = platformUsers().find((item) => item.azureOid && item.azureOid === oidNeedle);
    if (hit) return hit;
  }
  return platformUserByEmail(email);
}

function isGlobalAdminEmail(email) {
  const row = platformUserByEmail(email);
  return Boolean(row && row.rol === "global_admin");
}

function savePlatformUser(input) {
  const platform = readPlatform();
  platform.users = platform.users || [];
  const email = String(input.email || "").toLowerCase().trim();
  if (!email || !email.includes("@")) throw new Error("Email is required.");
  const existing = (input.id && platform.users.find((item) => item.id === input.id)) || null;
  const emailOwner = platform.users.find((item) => item.email === email);
  if (emailOwner && (!existing || emailOwner.id !== existing.id)) {
    throw new Error("Email exists.");
  }
  const hashed = String(input.wachtwoord || "");
  if (hashed && !hashed.includes(":") && hashed.length < 8) throw new Error("Password too short.");
  const wachtwoord = hashed.includes(":")
    ? hashed
    : (hashed ? hashPassword(hashed) : existing?.wachtwoord || "");
  const record = {
    id: existing?.id || input.id || crypto.randomUUID(),
    voornaam: String(input.voornaam || existing?.voornaam || "").trim(),
    achternaam: String(input.achternaam || existing?.achternaam || "").trim(),
    email,
    rol: "global_admin",
    wachtwoord,
    azureOid: input.azureOid !== undefined ? String(input.azureOid || "").trim() : (existing?.azureOid || ""),
    azureEmail: input.azureEmail !== undefined
      ? String(input.azureEmail || "").toLowerCase().trim()
      : (existing?.azureEmail || ""),
    tourDone: Boolean(existing?.tourDone),
    createdAt: existing?.createdAt || nowIso(),
    updatedAt: nowIso(),
  };
  if (!record.voornaam || !record.achternaam) throw new Error("Name is required.");
  if (!record.wachtwoord) throw new Error("A password is required for a new employee.");
  if (existing) {
    platform.users = platform.users.map((item) => (item.id === existing.id ? record : item));
  } else {
    platform.users.push(record);
  }
  writePlatform(platform);
  return publicPlatformUser(record);
}

function markPlatformTourDone(id) {
  const platform = readPlatform();
  platform.users = (platform.users || []).map((item) =>
    item.id === id ? { ...item, tourDone: true, updatedAt: nowIso() } : item
  );
  writePlatform(platform);
}

function deletePlatformUser(id, actorId) {
  const platform = readPlatform();
  platform.users = platform.users || [];
  const row = platform.users.find((item) => item.id === id);
  if (!row) throw new Error("Admin not found.");
  const admins = platform.users.filter((item) => item.rol === "global_admin");
  if (admins.length <= 1) throw new Error("Last admin");
  if (actorId && row.id === actorId) throw new Error("Cannot delete self");
  platform.users = platform.users.filter((item) => item.id !== id);
  writePlatform(platform);
}

function migratePlatformUsers() {
  const platform = readPlatform();
  platform.workspaces = platform.workspaces || [];
  platform.users = Array.isArray(platform.users) ? platform.users : [];
  if (platform.users.some((item) => item.rol === "global_admin")) {
    writePlatform(platform);
    return;
  }
  for (const item of platform.workspaces) {
    const tenant = openTenant(item.slug);
    const raw = tenant.rawWerknemers().find((w) => w.rol === "admin")
      || tenant.rawWerknemers().find((w) => w.email === "admin@zaakhub.local");
    if (!raw || !raw.wachtwoord) continue;
    platform.users.push({
      id: raw.id,
      voornaam: raw.voornaam,
      achternaam: raw.achternaam,
      email: String(raw.email || "").toLowerCase().trim(),
      rol: "global_admin",
      wachtwoord: raw.wachtwoord,
      createdAt: raw.createdAt || nowIso(),
      updatedAt: nowIso(),
    });
    writePlatform(platform);
    return;
  }
  writePlatform(platform);
}

function relocateWerknemer(fromSlug, toSlug, wid, patch, actor) {
  const dest = openTenant(toSlug);
  if (!fromSlug || fromSlug === toSlug) {
    return dest.saveWerknemer({ ...patch, id: wid }, actor);
  }
  const src = openTenant(fromSlug);
  const raw = src.rawWerknemer(wid);
  if (!raw) throw new Error("Employee not found");
  const saved = dest.saveWerknemer(
    {
      ...raw,
      ...patch,
      id: raw.id,
      personeelsnummer: raw.personeelsnummer,
      wachtwoord: "",
      wachtwoordHash: patch.wachtwoord ? undefined : raw.wachtwoord,
    },
    actor
  );
  src.deleteWerknemer(wid, actor);
  return saved;
}

function workspaces() {
  return readPlatform().workspaces || [];
}

function workspace(slug) {
  const id = slugify(slug);
  return workspaces().find((item) => item.slug === id) || null;
}

function tenantDir(slug) {
  return path.join(config.dataDir, "tenants", slug);
}

function openTenant(slug) {
  const id = slugify(slug);
  if (!id) throw new Error("Invalid workspace");
  if (cache.has(id)) return cache.get(id);
  const tenant = createStore(tenantDir(id), id);
  cache.set(id, tenant);
  return tenant;
}

function runWithStore(tenant, fn) {
  return als.run({ store: tenant }, fn);
}

function currentStore() {
  return als.getStore()?.store || null;
}

const store = new Proxy(
  {},
  {
    get(_target, prop) {
      if (prop === "then") return undefined;
      const current = currentStore();
      if (!current) return undefined;
      const value = current[prop];
      return typeof value === "function" ? value.bind(current) : value;
    },
  }
);

function migrateLegacyWorkspace() {
  if (fs.existsSync(platformPath())) return;
  const legacyDb = path.join(config.dataDir, "db.json");
  const items = [];
  if (fs.existsSync(legacyDb)) {
    let name = config.orgName;
    try {
      name = JSON.parse(fs.readFileSync(legacyDb, "utf8")).meta?.orgName || name;
    } catch {
      /* ignore */
    }
    const slug = slugify(name) || "demo";
    const dest = tenantDir(slug);
    fs.mkdirSync(dest, { recursive: true });
    const destDb = path.join(dest, "db.json");
    if (!fs.existsSync(destDb)) fs.renameSync(legacyDb, destDb);
    const legacyUploads = path.join(config.dataDir, "uploads");
    const destUploads = path.join(dest, "uploads");
    if (fs.existsSync(legacyUploads) && !fs.existsSync(destUploads)) {
      fs.renameSync(legacyUploads, destUploads);
    }
    items.push({
      slug,
      name,
      defaultLang: "nl",
      createdAt: new Date().toISOString(),
    });
  }
  writePlatform({ workspaces: items });
}

function hostSlug(host) {
  const hostname = String(host || "").split(":")[0].toLowerCase();
  if (!hostname || hostname === "localhost" || /^\d+\.\d+\.\d+\.\d+$/.test(hostname)) return "";
  const matches = workspacesByHost(hostname);
  if (matches.length === 1) return matches[0].slug;
  if (matches.length > 1) return "";
  const first = hostname.split(".")[0];
  return workspace(first) ? first : "";
}

function resolveSlug(req) {
  const session = readSession(req.cookies?.[config.cookieName]);
  if (session?.tenant && session.tenant !== PLATFORM_SESSION && workspace(session.tenant)) {
    return session.tenant;
  }
  const hostname = req.get("host");
  const hostMatches = workspacesByHost(hostname);
  const fromCookie = slugify(req.cookies?.[config.workspaceCookie] || "");
  if (hostMatches.length === 1) return hostMatches[0].slug;
  if (hostMatches.length > 1) {
    if (fromCookie && hostMatches.some((item) => item.slug === fromCookie)) return fromCookie;
    return "";
  }
  const fromHost = hostSlug(hostname);
  if (fromHost) return fromHost;
  if (fromCookie && workspace(fromCookie)) return fromCookie;
  const list = workspaces();
  if (list.length === 1) return list[0].slug;
  if (session?.tenant === PLATFORM_SESSION && list.length) return list[0].slug;
  return "";
}

function setWorkspaceCookie(res, slug) {
  res.cookie(config.workspaceCookie, slug, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.COOKIE_SECURE === "true",
    maxAge: 365 * 86400000,
    path: "/",
  });
}

function normalizeDomain(value) {
  let raw = String(value || "").trim().toLowerCase();
  raw = raw.replace(/^https?:\/\//, "").replace(/^@/, "");
  raw = raw.split("/")[0].split(":")[0].replace(/^\*\./, "").replace(/\.$/, "");
  if (!raw || raw === "localhost" || /^\d+\.\d+\.\d+\.\d+$/.test(raw)) return "";
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(raw)) return "";
  return raw;
}

function parseDomains(value) {
  const parts = Array.isArray(value)
    ? value
    : String(value || "").split(/[,;\s]+/).filter(Boolean);
  const unique = [];
  for (const part of parts) {
    const domain = normalizeDomain(part);
    if (!domain) throw new Error("Invalid domain.");
    if (!unique.includes(domain)) unique.push(domain);
  }
  return unique;
}

function hostMatchesDomain(hostname, domain) {
  const host = String(hostname || "").split(":")[0].toLowerCase();
  return host === domain || host.endsWith(`.${domain}`);
}

function emailMatchesDomain(email, domain) {
  const host = String(email || "").toLowerCase().trim().split("@")[1] || "";
  return hostMatchesDomain(host, domain);
}

function workspaceAllowsEmail(item, email) {
  const domains = item?.domains || [];
  if (!domains.length) return true;
  return domains.some((domain) => emailMatchesDomain(email, domain));
}

function setWorkspaceDomains(slug, raw) {
  const id = slugify(slug);
  if (!workspace(id)) throw new Error("Workspace not found.");
  return updateWorkspace(id, { domains: parseDomains(raw) });
}

function workspacesByHost(host) {
  const hostname = String(host || "").split(":")[0].toLowerCase();
  if (!hostname) return [];
  let bestLen = -1;
  const matches = [];
  for (const item of workspaces()) {
    let itemLen = -1;
    for (const domain of item.domains || []) {
      if (hostMatchesDomain(hostname, domain) && domain.length > itemLen) itemLen = domain.length;
    }
    if (itemLen < 0) continue;
    if (itemLen > bestLen) {
      bestLen = itemLen;
      matches.length = 0;
      matches.push(item);
    } else if (itemLen === bestLen) {
      matches.push(item);
    }
  }
  return matches;
}

function workspacesForRequest(req) {
  const hostMatches = workspacesByHost(req.get("host"));
  return hostMatches.length ? hostMatches : workspaces();
}

function createWorkspace(input) {
  const slug = slugify(input.slug || input.name);
  if (!slug) throw new Error("Slug is required.");
  if (workspace(slug)) throw new Error("Workspace exists.");
  const domains = parseDomains(input.domains);
  const record = {
    slug,
    name: String(input.name || slug).trim(),
    defaultLang: ["nl", "en", "da", "de"].includes(input.defaultLang) ? input.defaultLang : "en",
    domains,
    createdAt: new Date().toISOString(),
  };
  const platform = readPlatform();
  platform.workspaces = platform.workspaces || [];
  platform.workspaces.push(record);
  writePlatform(platform);
  const tenant = openTenant(slug);
  const profile = ["cases", "hr", "both"].includes(input.appProfile) ? input.appProfile : "cases";
  tenant.saveMeta(
    {
      orgName: record.name,
      appProfile: profile,
      onboarded: true,
      setupOrgDone: true,
      setupProfileDone: true,
      setupCreateDone: true,
      setupAzureDone: true,
    },
    null
  );
  const wantsAdmin =
    String(input.adminEmail || "").trim() ||
    String(input.adminVoornaam || "").trim() ||
    String(input.adminAchternaam || "").trim() ||
    String(input.adminWachtwoord || "").trim();
  if (wantsAdmin) addTenantAdmin(tenant, input);
  if (input.seedDemo) {
    const admin = tenant.werknemers().find((w) => w.rol === "admin") || tenant.seedUsers();
    if (profile !== "hr") tenant.importDemoRegistry(record.defaultLang, admin);
  }
  migratePlatformUsers();
  return record;
}

function addTenantAdmin(tenant, input) {
  const voornaam = String(input.adminVoornaam || input.voornaam || "").trim();
  const achternaam = String(input.adminAchternaam || input.achternaam || "").trim();
  const email = String(input.adminEmail || input.email || "").toLowerCase().trim();
  const wachtwoord = String(input.adminWachtwoord || input.wachtwoord || "");
  if (!voornaam || !achternaam) throw new Error("Name is required.");
  if (!email) throw new Error("Email is required.");
  if (wachtwoord.length < 8) throw new Error("Password too short.");
  return tenant.saveWerknemer(
    {
      voornaam,
      achternaam,
      email,
      wachtwoord,
      rol: "admin",
      afdeling: "Beheer",
    },
    null
  );
}

function addWorkspaceAdmin(slug, input) {
  const item = workspace(slug);
  if (!item) throw new Error("Workspace not found.");
  return addTenantAdmin(openTenant(item.slug), input);
}

function updateWorkspace(slug, patch) {
  const id = slugify(slug);
  const platform = readPlatform();
  platform.workspaces = (platform.workspaces || []).map((item) => (item.slug === id ? { ...item, ...patch, slug: item.slug } : item));
  writePlatform(platform);
  return workspace(id);
}

function deleteWorkspace(slug) {
  const id = slugify(slug);
  const list = workspaces();
  if (list.length <= 1) throw new Error("Last workspace");
  const platform = readPlatform();
  platform.workspaces = (platform.workspaces || []).filter((item) => item.slug !== id);
  writePlatform(platform);
  cache.delete(id);
  fs.rmSync(tenantDir(id), { recursive: true, force: true });
}

function findDocumentJob(jobId) {
  for (const item of workspaces()) {
    const tenant = openTenant(item.slug);
    const job = tenant.documentJob(jobId);
    if (job) return { store: tenant, job, slug: item.slug };
  }
  return null;
}

function findStufJob(value) {
  const wanted = String(value || "").trim();
  if (!wanted) return null;
  const direct = findDocumentJob(wanted);
  if (direct) return direct;
  for (const item of workspaces()) {
    const tenant = openTenant(item.slug);
    const jobs = tenant.db.get("documentJobs").value() || [];
    const job = jobs.find((row) => row.stufReferentienummer === wanted || row.documentGenerationId === wanted);
    if (job) return { store: tenant, job, slug: item.slug };
  }
  return null;
}

function seedIfEmpty() {
  migrateLegacyWorkspace();
  const list = workspaces();
  if (!list.length) return false;
  const seeded = openTenant(list[0].slug).seedIfEmpty();
  migratePlatformUsers();
  return seeded;
}

migrateLegacyWorkspace();
migratePlatformUsers();

module.exports = {
  store,
  seedIfEmpty,
  createStore,
  openTenant,
  runWithStore,
  currentStore,
  workspaces,
  workspace,
  resolveSlug,
  setWorkspaceCookie,
  createWorkspace,
  addWorkspaceAdmin,
  updateWorkspace,
  deleteWorkspace,
  slugify,
  hostSlug,
  parseDomains,
  setWorkspaceDomains,
  workspacesByHost,
  workspacesForRequest,
  workspaceAllowsEmail,
  findDocumentJob,
  findStufJob,
  PLATFORM_SESSION,
  needsPlatformSetup,
  platformSetupStep,
  setPlatformAzureDone,
  platformUsers,
  platformUser,
  platformUserByEmail,
  platformUserByAzure,
  publicPlatformUser,
  savePlatformUser,
  markPlatformTourDone,
  deletePlatformUser,
  isGlobalAdminEmail,
  relocateWerknemer,
};
