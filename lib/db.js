const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const low = require("lowdb");
const FileSync = require("lowdb/adapters/FileSync");
const config = require("../config");
const { encrypt, decrypt, hashPassword, maskBsn } = require("./crypto");
const { nowIso, includesQ, fullName, parseStreet, STATUSSEN, PRIORITEITEN, ROLLEN, labelOf, overviewGroup, progressOf, OVERVIEW_GROUPS } = require("./format");
const { demoPack } = require("./demo-data");

fs.mkdirSync(path.join(config.dataDir, "uploads"), { recursive: true });

const dbPath = path.join(config.dataDir, "db.json");
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
if (!Array.isArray(state.recipes)) db.set("recipes", []).write();
if (!Array.isArray(state.documentJobs)) db.set("documentJobs", []).write();
if (!Array.isArray(state.zaaktypen)) db.set("zaaktypen", []).write();

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

function audit(actor, action, entity, entityId, detail) {
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
  return {
    ...zaak,
    zaaktype: zaak.zaaktype || "",
    zaaktypeId: zaak.zaaktypeId || "",
    referentie: zaak.referentie || "",
    voortgang: progressOf(zaak),
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
  return {
    ...row,
    leadTimeDays: Number(row.leadTimeDays) || 0,
    recipeIds,
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
  dataDir: config.dataDir,
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
    const zaken = db.get("zaken").value();
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
  overdueZaken() {
    return store.zaken({}).filter((z) => z.overdue);
  },
  recentZaken(limit = 8) {
    return db.get("zaken").take(limit).value().map(hydrateZaak);
  },
  recentBijlagen(limit = 6) {
    return db
      .get("bijlagen")
      .take(limit)
      .value()
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
      });
  },
  auditLog(limit = 80) {
    return db.get("audit").take(limit).value();
  },

  werknemers() {
    return db.get("werknemers").value().map(publicWerknemer);
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
    const record = {
      id: existing?.id || id(),
      personeelsnummer: existing?.personeelsnummer || nextPersoneelnummer(),
      voornaam: String(input.voornaam || "").trim(),
      achternaam: String(input.achternaam || "").trim(),
      email,
      rol: input.rol || existing?.rol || "medewerker",
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
      wachtwoord: input.wachtwoord ? hashPassword(input.wachtwoord) : existing?.wachtwoord || "",
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
    let companies = 0;
    let persons = 0;
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
      if (existing) return;
      store.savePersoon(
        {
          ...item,
          bedrijfId: item.companyKey ? companyIds[item.companyKey] || "" : "",
        },
        actor
      );
      persons += 1;
    });
    return { companies, persons };
  },

  zaken({ q, status } = {}) {
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
        return includesQ(text, q) && statusOk;
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
    if (existing) db.get("zaken").find({ id: existing.id }).assign(record).write();
    else db.get("zaken").unshift(record).write();
    audit(actor, existing ? "gewijzigd" : "aangemaakt", "zaak", record.id, record.zaaknummer);
    return hydrateZaak(record);
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
          fs.unlinkSync(path.join(config.dataDir, "uploads", b.stored));
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
      fs.unlinkSync(path.join(config.dataDir, "uploads", row.stored));
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
  log(actor, action, entity, entityId, detail) {
    audit(actor, action, entity, entityId, detail);
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
      status: input.status || "prepared",
      token: input.token || crypto.randomBytes(24).toString("hex"),
      finalizeUrl: input.finalizeUrl || "",
      expiresAtUtc: input.expiresAtUtc || "",
      documentGenerationId: "",
      documentUrl: "",
      bijlageId: "",
      error: "",
      createdAt: nowIso(),
      updatedAt: nowIso(),
      createdBy: actorName(actor),
    };
    db.get("documentJobs").unshift(record).write();
    audit(actor, "voorbereid", "document", record.id, record.recipeName);
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

function seedIfEmpty() {
  if (db.get("werknemers").size().value() > 0) return false;
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

  const kappen = store.saveZaaktype({ naam: "Het kappen van bomen", leadTimeDays: 14 }, admin);
  const bezwaar = store.saveZaaktype({ naam: "Bezwaar en beroep", leadTimeDays: 42 }, admin);
  const melding = store.saveZaaktype({ naam: "Sagsbehandling", leadTimeDays: 7 }, admin);
  const welkom = store.saveZaaktype({ naam: "Welkomst brief voor nieuwe inwoner", leadTimeDays: 21 }, admin);
  const omgevings = store.saveZaaktype({ naam: "Omgevingsvergunning", leadTimeDays: 56 }, admin);

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

module.exports = { store, seedIfEmpty };
