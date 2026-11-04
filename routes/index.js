const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const {
  store,
  workspaces,
  workspace,
  openTenant,
  runWithStore,
  setWorkspaceCookie,
  createWorkspace,
  addWorkspaceAdmin,
  updateWorkspace,
  deleteWorkspace,
  slugify,
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
  platformUser,
  platformUserByEmail,
  platformUserByAzure,
  platformUsers,
  publicPlatformUser,
  savePlatformUser,
  markPlatformTourDone,
  deletePlatformUser,
  relocateWerknemer,
  isGlobalAdminEmail,
} = require("../lib/db");
const { verifyPassword } = require("../lib/crypto");
const { STATUSSEN, PRIORITEITEN, ROLLEN, OVERVIEW_GROUPS, PERSON_GROUPS, COMPANY_GROUPS, parseView, includesQ, slugFile, firstName, ymdToday, nowIso } = require("../lib/format");
const { currentUser, requireAuth, requireRole, requireGlobalAdmin, setSessionCookie, clearSessionCookie, canWriteMaster, isAdmin, isGlobalAdmin } = require("../lib/auth");
const config = require("../config");
const create = require("../lib/create");
const stufDcr = require("../lib/stuf-dcr");
const azure = require("../lib/azure");
const { setLangCookie } = require("../lib/i18n");
const { appProfile, isHr, isCases } = require("../lib/profile");

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, _file, cb) => {
      const dir = path.join((req.store && req.store.dataDir) || config.dataDir, "uploads");
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (_req, file, cb) => {
      cb(null, `${Date.now()}-${slugFile(file.originalname)}`);
    },
  }),
  limits: { fileSize: 25 * 1024 * 1024 },
});

const certUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 512 * 1024 },
});

function toast(res, path, message) {
  const sep = String(path).includes("?") ? "&" : "?";
  res.redirect(`${path}${sep}toast=${encodeURIComponent(message)}`);
}

function wantsJson(req) {
  return String(req.get("accept") || "").includes("application/json");
}

function withToast(path, message) {
  const sep = String(path).includes("?") ? "&" : "?";
  return `${path}${sep}toast=${encodeURIComponent(message)}`;
}

function generateReply(req, res, { open = "", next = "", message = "" }) {
  const nextUrl = message ? withToast(next, message) : next;
  if (wantsJson(req)) return res.json({ open, next: nextUrl });
  if (open) return res.redirect(open);
  return res.redirect(nextUrl);
}

function toastT(req, res, path, key, vars) {
  toast(res, path, req.t(key, vars));
}

function uploadsFile(req, stored) {
  return path.join((req.store && req.store.dataDir) || config.dataDir, "uploads", stored);
}

function workspaceOpen(req) {
  return (
    req.path === "/werkruimtes" ||
    req.path === "/login" ||
    req.path === "/lang" ||
    req.path === "/api/health" ||
    req.path.startsWith("/w/") ||
    req.path.startsWith("/auth/azure") ||
    req.path.startsWith("/api/create/webhook") ||
    req.path.startsWith("/api/stuf-dcr")
  );
}

function pickWorkspaces(req) {
  const list = workspacesForRequest(req);
  if (!req.user || isGlobalAdmin(req.user)) return list;
  const allowed = list.filter((item) => workspaceAllowsEmail(item, req.user.email));
  return allowed.length ? allowed : list;
}

function tenantForLogin(req) {
  const list = pickWorkspaces(req);
  const wanted = slugify(req.body?.workspace || req.query?.workspace || req.store?.slug || "");
  const item = list.find((row) => row.slug === wanted) || list[0] || null;
  if (!item) return { list, item: null, tenant: null };
  return { list, item, tenant: openTenant(item.slug) };
}

function renderLogin(req, res, extra = {}) {
  const ctx = extra.ctx || tenantForLogin(req);
  if (!ctx.item) return res.redirect("/werkruimtes");
  const azureCfg = azure.azureSettings(ctx.tenant);
  const view = {
    title: req.t("login.title"),
    layout: false,
    error: extra.error || req.query.error || "",
    next: extra.next || req.query.next || "/",
    azureReady: azure.enabled(azureCfg),
    showDemo: Boolean(platformUserByEmail("admin@zaakhub.local") || ctx.tenant.werknemerByEmail("admin@zaakhub.local")),
    workspaces: ctx.list,
    workspaceSlug: ctx.item.slug,
    meta: ctx.tenant.meta(),
  };
  if (extra.status) return res.status(extra.status).render("login", view);
  return res.render("login", view);
}

function formError(req, err) {
  if (err.message === "Name is required.") return req.t("validation.nameRequired");
  if (err.message === "A password is required for a new employee.") return req.t("validation.passwordRequired");
  return err.message;
}

function workspaceError(req, err) {
  if (err.message === "Workspace exists.") return req.t("workspace.exists");
  if (err.message === "Domain taken.") return req.t("workspace.domainTaken");
  if (err.message === "Invalid domain.") return req.t("workspace.domainInvalid");
  if (err.message === "Last workspace") return req.t("workspace.last");
  if (err.message === "Workspace not found.") return req.t("error.notFound");
  return adminError(req, err);
}

function workspaceAdminInput(body) {
  return {
    adminVoornaam: body.adminVoornaam,
    adminAchternaam: body.adminAchternaam,
    adminEmail: body.adminEmail,
    adminWachtwoord: body.adminWachtwoord,
  };
}

function adminError(req, err) {
  if (err.message === "Email exists.") return req.t("admins.emailExists");
  if (err.message === "Last admin") return req.t("admins.last");
  if (err.message === "Cannot delete self") return req.t("admins.cannotDeleteSelf");
  if (err.message === "Admin not found.") return req.t("error.notFound");
  if (err.message === "Password too short.") return req.t("validation.passwordShort");
  if (err.message === "Email is required.") return req.t("admins.emailRequired");
  return formError(req, err);
}

function adminBody(req) {
  return {
    voornaam: req.body.voornaam,
    achternaam: req.body.achternaam,
    email: req.body.email,
    wachtwoord: req.body.wachtwoord,
  };
}

function withModal(req, data) {
  const modal = req.query.modal === "1";
  return { ...data, modal, layout: modal ? false : "layout" };
}

function ids(value) {
  if (!value) return [];
  return Array.isArray(value) ? value.filter(Boolean) : [value];
}

function listRequest(req) {
  const fragment = String(req.query.fragment || "") === "1";
  const full = String(req.query.full || "") === "1";
  return {
    fragment,
    lazyPending: !fragment && !full,
  };
}

function nawListPath(base, src) {
  const params = new URLSearchParams();
  const map = {
    q: src.filterQ,
    group: src.filterGroup,
    focus: src.filterFocus,
    peekTab: src.filterPeekTab,
  };
  Object.keys(map).forEach((key) => {
    const value = map[key];
    if (!value) return;
    params.set(key, value);
  });
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

function draftPersoon() {
  return {
    id: "",
    nummer: "",
    naam: "",
    voornaam: "",
    tussenvoegsel: "",
    achternaam: "",
    geslacht: "",
    email: "",
    telefoon: "",
    geboortedatum: "",
    bedrijfId: "",
    bedrijf: null,
    straat: "",
    huisnummer: "",
    postcode: "",
    plaats: "",
    land: "",
    anoniem: false,
    caseCount: 0,
  };
}

function draftWerknemer() {
  return {
    id: "",
    personeelsnummer: "",
    naam: "",
    voornaam: "",
    achternaam: "",
    email: "",
    rol: "medewerker",
    afdeling: "",
    aanhef: "",
    geboortedatum: "",
    straat: "",
    huisnummer: "",
    postcode: "",
    plaats: "",
    datumIndiensttreding: "",
    functiebenaming: "",
    inschaling: "",
    salaris: "",
    leaseauto: false,
    vestiging: "",
  };
}

function sortLinkedCases(a, b) {
  const rank = (z) => (z.overdue ? 0 : ["afgerond", "geannuleerd"].includes(z.status) ? 2 : 1);
  const byRank = rank(a) - rank(b);
  if (byRank) return byRank;
  return String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
}

function assignedZaken(id) {
  if (!id) return [];
  return store.zaken({}).filter((z) => z.behandelaarId === id).sort(sortLinkedCases);
}

function employeeCanWrite(req) {
  return isHr(store.meta()) ? canWriteMaster(req.user) : isAdmin(req.user);
}

const AUDIT_ENTITIES = ["zaak", "persoon", "bedrijf", "werknemer", "instellingen", "zaaktype", "recipe", "document"];

function filterWerknemers(q, group) {
  return store.werknemers().filter((w) =>
    !isGlobalAdminEmail(w.email)
    && includesQ(`${w.naam} ${w.email} ${w.afdeling} ${w.personeelsnummer} ${w.functiebenaming} ${w.vestiging}`, q)
    && (!group || w.rol === group)
  );
}

function employeeFormLocals(req, extra = {}) {
  return {
    rollen: ROLLEN,
    workspaces: isGlobalAdmin(req.user) ? workspaces() : [],
    workspaceSlug: extra.workspaceSlug || req.store?.slug || "",
    ...extra,
  };
}

function targetWorkspaceSlug(req) {
  if (!isGlobalAdmin(req.user)) return req.store?.slug;
  const wanted = slugify(req.body.workspace || "");
  return workspace(wanted) ? wanted : req.store?.slug;
}

function persistWerknemer(req, input) {
  const destSlug = targetWorkspaceSlug(req);
  if (input.id && destSlug !== req.store.slug) {
    return { row: relocateWerknemer(req.store.slug, destSlug, input.id, input, req.user), destSlug };
  }
  if (destSlug === req.store.slug) {
    return { row: store.saveWerknemer(input, req.user), destSlug };
  }
  return { row: openTenant(destSlug).saveWerknemer(input, req.user), destSlug };
}

function redirectEmployeeSaved(req, res, row, destSlug, fromList) {
  const next = fromList
    ? nawListPath("/werknemers", { ...req.body, filterFocus: row.id })
    : `/werknemers/${row.id}`;
  if (destSlug !== req.store.slug) {
    setWorkspaceCookie(res, destSlug);
    return toastT(req, res, `/w/${destSlug}?next=${encodeURIComponent(next)}`, "toast.employeeSaved");
  }
  toastT(req, res, next, "toast.employeeSaved");
}

function auditEntityHref(item) {
  if (!item) return "";
  const entity = item.entity;
  const entityId = item.entityId;
  if (entity === "zaak" && entityId) return zaakFocusPath(entityId);
  if (entity === "persoon" && entityId) return nawFocusPath("/personen", entityId);
  if (entity === "bedrijf" && entityId) return nawFocusPath("/bedrijven", entityId);
  if (entity === "werknemer" && entityId) return `/werknemers/${entityId}`;
  if (entity === "zaaktype") return "/instellingen/zaaktypen";
  if (entity === "recipe") return "/templates";
  if (entity === "instellingen") return "/instellingen";
  if (entity === "document") return "";
  return "";
}

function leaseFlag(value) {
  const last = Array.isArray(value) ? value[value.length - 1] : value;
  return last === true || last === "1" || last === "on" || last === "ja";
}

function quickStatusOn() {
  return store.meta().quickStatusChange !== false;
}

function draftBedrijf() {
  return {
    id: "",
    nummer: "",
    handelsnaam: "",
    kvk: "",
    adres: "",
    postcode: "",
    plaats: "",
    email: "",
    telefoon: "",
    notities: "",
    caseCount: 0,
  };
}

function linkedZaken(kind, id) {
  if (!id) return [];
  return store.zaken({}).filter((z) => {
    if (kind === "person") return (z.persoonIds || []).includes(id);
    return (z.bedrijfIds || []).includes(id);
  }).sort(sortLinkedCases);
}

function zaakFocusPath(id, extra = {}) {
  if (!id) return "/zaken";
  const params = new URLSearchParams();
  params.set("focus", id);
  if (extra.peekTab) params.set("peekTab", extra.peekTab);
  const qs = params.toString();
  return qs ? `/zaken?${qs}` : "/zaken";
}

function nawFocusPath(base, id, extra = {}) {
  if (!id) return base;
  const params = new URLSearchParams();
  params.set("focus", id);
  if (extra.peekTab) params.set("peekTab", extra.peekTab);
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

function peekTabFromNawTab(tab) {
  if (tab === "cases") return "cases";
  if (tab === "contacts") return "contacts";
  return "";
}

function peekTabFromCaseTab(tab) {
  if (tab === "documents") return "docs";
  if (tab === "activity") return "activity";
  if (tab === "relations") return "holders";
  return "";
}

function zakenListPath(src) {
  const params = new URLSearchParams();
  const map = {
    q: src.filterQ,
    status: src.filterStatus,
    zaaktypeId: src.filterZaaktypeId,
    prioriteit: src.filterPrioriteit,
    page: src.filterPage,
    pageSize: src.filterPageSize,
    focus: src.filterFocus,
    peekTab: src.filterPeekTab,
  };
  Object.keys(map).forEach((key) => {
    const value = map[key];
    if (!value) return;
    if (key === "page" && Number(value) === 1) return;
    if (key === "pageSize" && Number(value) === 10) return;
    params.set(key, value);
  });
  const qs = params.toString();
  return qs ? `/zaken?${qs}` : "/zaken";
}

function zaakWriteFields(zaak, patch) {
  return {
    id: zaak.id,
    titel: zaak.titel,
    omschrijving: zaak.omschrijving,
    zaaktypeId: zaak.zaaktypeId,
    referentie: zaak.referentie,
    voortgang: zaak.voortgang,
    status: patch.status || zaak.status,
    prioriteit: patch.prioriteit || zaak.prioriteit,
    startdatum: zaak.startdatum,
    deadline: zaak.deadline,
    behandelaarId: Object.prototype.hasOwnProperty.call(patch, "behandelaarId")
      ? patch.behandelaarId
      : zaak.behandelaarId,
    bedrijfIds: Object.prototype.hasOwnProperty.call(patch, "bedrijfIds")
      ? patch.bedrijfIds
      : zaak.bedrijfIds,
    persoonIds: Object.prototype.hasOwnProperty.call(patch, "persoonIds")
      ? patch.persoonIds
      : zaak.persoonIds,
  };
}

function employeesRead(req, res, next) {
  if (isHr(store.meta())) return next();
  return requireRole("admin")(req, res, next);
}

function employeesWrite(req, res, next) {
  if (isHr(store.meta()) && canWriteMaster(req.user)) return next();
  return requireRole("admin")(req, res, next);
}

function employeeBody(req) {
  const body = { ...req.body };
  if (isHr(store.meta()) && !String(body.wachtwoord || "").trim() && !req.params.id) {
    body.authSource = "hr";
  }
  return body;
}

function visibleRecipes() {
  return store.recipes().filter((recipe) => !recipe.hideFromUserView);
}

function documentChannelReady() {
  return create.enabled(create.createSettings(store)) || stufDcr.enabled(stufDcr.stufSettings(store));
}

function employeeDocContext() {
  if (!isHr(store.meta())) return { recipes: [], createReady: false };
  return { recipes: visibleRecipes(), createReady: documentChannelReady() };
}

function draftZaak() {
  return {
    id: "",
    zaaknummer: "",
    titel: "",
    omschrijving: "",
    zaaktypeId: "",
    zaaktype: "",
    referentie: "",
    startdatum: ymdToday(),
    status: "nieuw",
    prioriteit: "normaal",
    deadline: "",
    behandelaarId: "",
    voortgang: 0,
    personen: [],
    bedrijven: [],
    bijlagen: [],
    overdue: false,
    behandelaarNaam: "—",
    behandelaarInitials: "",
  };
}

function recipesForZaak(zaak) {
  const allRecipes = visibleRecipes();
  if (!zaak) return [];
  const type = zaak.zaaktypeId ? store.zaaktype(zaak.zaaktypeId) : null;
  if (type?.recipeIds?.length) {
    return allRecipes.filter((recipe) => type.recipeIds.includes(recipe.itemId));
  }
  return allRecipes;
}

function bodyValues(value) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (value == null || value === "") return [];
  return [String(value)];
}

function partyFields(target) {
  return {
    persoonId: target?.kind === "persoon" ? target.id : "",
    bedrijfId: target?.kind === "bedrijf" ? target.id : "",
    stakeholderName: target?.name || "",
  };
}

function documentFileName(job, fileName, file) {
  const ext = path.extname(file?.naam || fileName || "") || ".pdf";
  const base = [job.recipeName, job.stakeholderName].filter(Boolean).join(" - ")
    || fileName
    || file?.naam
    || "document";
  return /\.[a-z0-9]+$/i.test(base) ? base : `${base}${ext}`;
}

function addOwnerJob(req, settings, { owner, recipe, interactive, target }) {
  const job = store.addDocumentJob(
    {
      zaakId: owner.zaakId || "",
      werknemerId: owner.werknemerId || "",
      recipeId: recipe.itemId,
      recipeName: recipe.name,
      mode: interactive ? "interactive" : "generate",
      status: interactive ? "prepared" : "generating",
      ...partyFields(target),
    },
    req.user
  );
  const hook = create.prepareWebhook(req, settings, job);
  if (hook.returnUrl || hook.webhookUrl) {
    store.updateDocumentJob(job.id, { returnUrl: hook.returnUrl || "", webhookUrl: hook.webhookUrl || "" });
  }
  return { job: store.documentJob(job.id) || job, hook };
}

async function saveGeneratedOwnerFile(req, settings, { job, generated, owner, fileName }) {
  const fileUri = generated?.fileUri || generated?.url || "";
  if (!fileUri) {
    store.updateDocumentJob(job.id, { status: "error", error: "No fileUri" }, req.user);
    return false;
  }
  const file = await create.fetchGeneratedFile(settings, fileUri);
  if (!file) {
    store.updateDocumentJob(job.id, { status: "error", documentUrl: fileUri, error: "Download failed" }, req.user);
    return false;
  }
  if (generated.contentType && (!file.mime || file.mime === "application/octet-stream")) file.mime = generated.contentType;
  if (!file.mime || file.mime === "application/octet-stream") file.mime = "application/pdf";
  file.naam = documentFileName(job, fileName, file);
  const bijlage = store.addBijlage(owner, create.saveGeneratedFile(file, req.store.dataDir), req.user);
  store.updateDocumentJob(job.id, { status: "success", documentUrl: fileUri, bijlageId: bijlage.id }, req.user);
  return true;
}

function saveStufOwnerFile(tenant, job, file, actor) {
  if (!file?.buffer?.length) return false;
  file.naam = documentFileName(job, file.naam, file);
  const bijlage = tenant.addBijlage(
    { zaakId: job.zaakId, werknemerId: job.werknemerId },
    create.saveGeneratedFile(file, tenant.dataDir),
    actor || null
  );
  tenant.updateDocumentJob(
    job.id,
    {
      status: "success",
      bijlageId: bijlage.id,
      webhookAt: nowIso(),
      webhookStatus: "ok",
      webhookDetail: "stuf-dcr",
      error: "",
    },
    actor || null
  );
  return true;
}

function rememberStuf(tenant, { status, path, detail, jobId }) {
  tenant.patchStuf({
    lastResultAt: nowIso(),
    lastResultStatus: status,
    lastResultPath: String(path || "").slice(0, 300),
    lastResultDetail: String(detail || "").slice(0, 400),
    lastError: status === "error" ? String(detail || "").slice(0, 400) : "",
  });
  tenant.log(null, "stuf-dcr", "document", jobId || "stuf-dcr", `${status}${detail ? ` · ${detail}` : ""}`);
  console.log(`stuf-dcr ${status} ${path || ""} ${jobId || ""}`.trim());
}

function sendSoap(res, xml, status = 200) {
  res.status(status).type("text/xml; charset=utf-8").send(xml);
}

function stufXmlBody(req) {
  if (typeof req.body === "string") return req.body;
  if (Buffer.isBuffer(req.body)) return req.body.toString("utf8");
  return "";
}

function stufConfirm(res, settings, parsed, job) {
  return sendSoap(
    res,
    stufDcr.buildBv03({
      settings,
      referentienummer: job?.stufReferentienummer || job?.id || parsed.referentienummer,
      crossRef: parsed.referentienummer,
    })
  );
}

async function applyStufResult(req, tenant, job, parsed) {
  const settings = create.createSettings(tenant);
  const outcome = parsed.outcome || stufDcr.jobOutcome(parsed.status);
  const patch = {
    webhookAt: nowIso(),
    documentGenerationId: parsed.jobidentificatie || job.documentGenerationId || "",
    finalizeUrl: parsed.presentUrl || job.finalizeUrl || "",
    documentUrl: parsed.resultUrl || job.documentUrl || "",
  };
  if (outcome === "failed") {
    patch.status = "error";
    patch.webhookStatus = "error";
    patch.webhookDetail = parsed.status || "fout";
    patch.error = parsed.message || parsed.status || "StUF-DCR fout";
    tenant.updateDocumentJob(job.id, patch);
    rememberStuf(tenant, { status: "error", path: req.originalUrl, detail: patch.error, jobId: job.id });
    return;
  }
  if (outcome === "ready") {
    let file = parsed.file;
    if (!file && parsed.resultUrl) {
      const downloaded = await create.fetchGeneratedFile(settings, parsed.resultUrl);
      if (downloaded) file = downloaded;
    }
    if (file) {
      saveStufOwnerFile(tenant, job, file, null);
      rememberStuf(tenant, { status: "ok", path: req.originalUrl, detail: file.naam, jobId: job.id });
      return;
    }
    tenant.updateDocumentJob(job.id, { ...patch, webhookStatus: "empty", webhookDetail: "geen documentinhoud" });
    rememberStuf(tenant, { status: "empty", path: req.originalUrl, detail: "geen documentinhoud", jobId: job.id });
    return;
  }
  tenant.updateDocumentJob(job.id, {
    ...patch,
    status: "prepared",
    webhookStatus: "pending",
    webhookDetail: parsed.status || "bezig",
  });
  rememberStuf(tenant, { status: "pending", path: req.originalUrl, detail: parsed.status, jobId: job.id });
}

async function startStufOwnerDocument(req, res, { owner, recipe, settings, stuf, job, payload, target, docsUrl }) {
  const zaak = owner.zaakId ? store.zaak(owner.zaakId) : null;
  const werknemer = owner.werknemerId ? store.werknemer(owner.werknemerId) : null;
  const party = stufDcr.partyFromTarget(target, werknemer);
  const referentienummer = job.id;
  const callbackUrl = stufDcr.publicCallbackUrl(stufDcr.publicOrigin(req, store), stuf.slug);
  store.updateDocumentJob(
    job.id,
    {
      channel: "stuf-dcr",
      stufReferentienummer: referentienummer,
      webhookUrl: callbackUrl,
    },
    req.user
  );
  const xml = stufDcr.buildStartRequest({
    settings: stuf,
    job,
    recipe,
    zaak,
    party,
    data: payload,
    actor: req.user,
    org: { orgName: store.meta().orgName || "", slug: store.slug || stuf.slug || "" },
    referentienummer,
  });
  store.log(
    req.user,
    "voorbereid",
    "document",
    job.id,
    `${recipe.name} · StUF-DCR verzoekStartenDocumentcreatieDi02`,
    { method: "POST", path: stuf.dcaUrl, body: stufDcr.clipXml(xml) }
  );
  const headers = {};
  if (create.configured(settings)) {
    try {
      headers.Authorization = `Bearer ${await create.getToken(settings)}`;
    } catch {
      /* SOAP uses its own contract; REST token is optional. */
    }
  }
  const result = await stufDcr.startDocumentcreatie(stuf, xml, headers);
  const presentUrl = result.presentUrl || result.resultUrl;
  store.updateDocumentJob(
    job.id,
    {
      documentGenerationId: result.jobidentificatie || "",
      finalizeUrl: presentUrl || "",
      documentUrl: result.resultUrl || "",
      status: result.outcome === "ready" ? "generating" : "prepared",
    },
    req.user
  );
  if (result.outcome === "ready" && result.file) {
    saveStufOwnerFile(store, job, result.file, req.user);
    return generateReply(req, res, { next: docsUrl, message: req.t("toast.documentGenerated") });
  }
  if (result.outcome === "failed") {
    store.updateDocumentJob(job.id, { status: "error", error: result.status || "StUF-DCR fout" }, req.user);
    store.patchStuf({ lastError: result.status || "StUF-DCR fout" });
    return generateReply(req, res, { next: docsUrl, message: `StUF-DCR: ${result.status || "fout"}` });
  }
  if (presentUrl) {
    return generateReply(req, res, {
      open: create.withAuthDomain(presentUrl, settings),
      next: docsUrl,
    });
  }
  return generateReply(req, res, { next: docsUrl, message: req.t("toast.noFinalize") });
}

async function generateBatchOwnerDocuments(req, res, { owner, recipe, settings, targets, docsUrl }) {
  try {
    await create.getToken(settings);
  } catch (err) {
    store.patchCreate({ lastError: err.message });
    return generateReply(req, res, { next: docsUrl, message: `Create: ${err.message}` });
  }
  const entries = targets.map((target) => {
    const { job, hook } = addOwnerJob(req, settings, { owner, recipe, interactive: false, target });
    return { job, hook, target };
  });
  const request = create.generateBatchAsyncRequest(settings, {
    recipeId: recipe.itemId,
    items: entries.map(({ target, hook }) => create.batchItem({
      data: target.data,
      webhookUrl: hook.webhookUrl,
      webhookHeaders: hook.webhookHeaders,
    })),
    mimeType: "application/pdf",
  });
  store.log(
    req.user,
    "genereren",
    "document",
    entries[0].job.id,
    `${recipe.name} · ${request.method} ${request.path} · ${entries.length} betrokkenen`,
    {
      ...request,
      body: {
        count: entries.length,
        names: targets.map((item) => item.name).filter(Boolean),
        data: create.clipJson(entries[0]?.target?.data),
      },
    }
  );

  const failAll = (message) => {
    for (const entry of entries) {
      store.updateDocumentJob(entry.job.id, { status: "error", error: message }, req.user);
    }
    store.patchCreate({ lastError: message });
  };

  const applyResults = (results) => {
    let queued = 0;
    let failed = 0;
    entries.forEach((entry, index) => {
      const result = results[index] || { success: false, message: "No batch result", generateId: "" };
      if (result.success) {
        store.updateDocumentJob(entry.job.id, {
          status: "generating",
          documentGenerationId: result.generateId || "",
          error: "",
        }, req.user);
        queued += 1;
      } else {
        store.updateDocumentJob(entry.job.id, {
          status: "error",
          error: result.message || "Batch enqueue failed",
        }, req.user);
        failed += 1;
      }
    });
    return { queued, failed };
  };

  try {
    const results = await create.generateBatchAsync(settings, {
      recipeId: recipe.itemId,
      items: request.body,
      mimeType: "application/pdf",
    });
    const { queued, failed } = applyResults(results);
    if (!queued) {
      const message = results.find((row) => row.message)?.message || "Batch enqueue failed";
      store.patchCreate({ lastError: message });
      return generateReply(req, res, { next: docsUrl, message: `Create: ${message}` });
    }
    const toast = failed
      ? req.t("toast.documentsQueuedPartial", { n: queued, failed })
      : req.t("toast.documentsQueued", { n: queued });
    return generateReply(req, res, { next: docsUrl, message: toast });
  } catch (err) {
    if (!create.isBatchUnsupported(err)) {
      failAll(err.message);
      return generateReply(req, res, { next: docsUrl, message: `Create: ${err.message}` });
    }
    store.log(req.user, "genereren", "document", entries[0].job.id, `${recipe.name} · batch niet beschikbaar, één voor één`);
    let saved = 0;
    let lastError = "";
    for (const entry of entries) {
      try {
        const generated = await create.generateDocument(settings, {
          recipeId: recipe.itemId,
          data: entry.target.data,
          fileName: entry.target.fileName,
          mimeType: "application/pdf",
        });
        if (await saveGeneratedOwnerFile(req, settings, {
          job: entry.job,
          generated,
          owner,
          fileName: entry.target.fileName,
        })) saved += 1;
        else lastError = "No fileUri";
      } catch (itemErr) {
        lastError = itemErr.message;
        store.updateDocumentJob(entry.job.id, { status: "error", error: itemErr.message }, req.user);
      }
    }
    if (!saved) {
      store.patchCreate({ lastError: lastError || err.message });
      return generateReply(req, res, { next: docsUrl, message: `Create: ${lastError || err.message}` });
    }
    return generateReply(req, res, {
      next: docsUrl,
      message: saved === entries.length
        ? req.t("toast.documentsQueued", { n: saved })
        : req.t("toast.documentsQueuedPartial", { n: saved, failed: entries.length - saved }),
    });
  }
}

async function generateOwnerDocument(req, res, { owner, data, fileName, docsUrl, backUrl, targets }) {
  const recipe = store.recipe(req.body.recipeId);
  if (!recipe) return generateReply(req, res, { next: backUrl, message: req.t("toast.pickTemplate") });
  const settings = create.createSettings(store);
  const stuf = stufDcr.stufSettings(store);
  const interactive = String(req.body.mode || "") === "interactive";
  if (!(interactive && stufDcr.enabled(stuf)) && !create.enabled(settings)) {
    return generateReply(req, res, { next: backUrl, message: req.t("toast.createOff") });
  }
  const batchTargets = !interactive && Array.isArray(targets) && targets.length > 1 ? targets : null;
  if (batchTargets) {
    return generateBatchOwnerDocuments(req, res, { owner, recipe, settings, targets: batchTargets, docsUrl });
  }
  const target = Array.isArray(targets) && targets[0] ? targets[0] : null;
  const payload = target?.data || data;
  const outName = target?.fileName || fileName;
  const { job, hook } = addOwnerJob(req, settings, { owner, recipe, interactive, target });
  if (interactive && stufDcr.enabled(stuf)) {
    try {
      return await startStufOwnerDocument(req, res, { owner, recipe, settings, stuf, job, payload, target, docsUrl });
    } catch (err) {
      store.updateDocumentJob(job.id, { status: "error", error: err.message }, req.user);
      store.patchStuf({ lastError: err.message });
      return generateReply(req, res, { next: docsUrl, message: `StUF-DCR: ${err.message}` });
    }
  }
  const webhookUrl = hook.webhookUrl;
  const webhookHeaders = hook.webhookHeaders;
  const request = interactive
    ? create.prepareGenerateRequest(settings, {
        recipeId: recipe.itemId,
        data: payload,
        webhookUrl,
        webhookHeaders,
      })
    : create.generateDocumentRequest(settings, {
        recipeId: recipe.itemId,
        data: payload,
        values: payload,
        fileName: outName,
        mimeType: "application/pdf",
      });
  store.log(
    req.user,
    interactive ? "voorbereid" : "genereren",
    "document",
    job.id,
    `${recipe.name} · ${request.method} ${request.path}`,
    request
  );
  try {
    if (interactive) {
      const prepared = await create.prepareGenerate(settings, {
        recipeId: recipe.itemId,
        data: payload,
        webhookUrl,
        webhookHeaders,
      });
      store.updateDocumentJob(
        job.id,
        { finalizeUrl: prepared.finalizeUrl || "", expiresAtUtc: prepared.expiresAtUtc || "" },
        req.user
      );
      if (prepared.finalizeUrl) {
        return generateReply(req, res, {
          open: create.withAuthDomain(prepared.finalizeUrl, settings),
          next: docsUrl,
        });
      }
      return generateReply(req, res, { next: docsUrl, message: req.t("toast.noFinalize") });
    }
    const generated = await create.generateDocument(settings, {
      recipeId: recipe.itemId,
      data: payload,
      values: payload,
      fileName: outName,
      mimeType: "application/pdf",
    });
    if (!(await saveGeneratedOwnerFile(req, settings, { job, generated, owner, fileName: outName }))) {
      return generateReply(req, res, { next: docsUrl, message: req.t("toast.noFileUri") });
    }
    return generateReply(req, res, { next: docsUrl, message: req.t("toast.documentGenerated") });
  } catch (err) {
    if (!interactive && create.isMissingRequiredValue(err)) {
      try {
        const fallback = create.prepareGenerateRequest(settings, {
          recipeId: recipe.itemId,
          data: payload,
          webhookUrl,
          webhookHeaders,
        });
        store.log(
          req.user,
          "voorbereid",
          "document",
          job.id,
          `${recipe.name} · ${fallback.method} ${fallback.path} · na ontbrekend veld`,
          fallback
        );
        const prepared = await create.prepareGenerate(settings, {
          recipeId: recipe.itemId,
          data: payload,
          webhookUrl,
          webhookHeaders,
        });
        store.updateDocumentJob(
          job.id,
          {
            mode: "interactive",
            status: "prepared",
            error: "",
            finalizeUrl: prepared.finalizeUrl || "",
            expiresAtUtc: prepared.expiresAtUtc || "",
          },
          req.user
        );
        if (prepared.finalizeUrl) {
          return generateReply(req, res, {
            open: create.withAuthDomain(prepared.finalizeUrl, settings),
            next: docsUrl,
          });
        }
        return generateReply(req, res, { next: docsUrl, message: req.t("toast.noFinalize") });
      } catch (prepareErr) {
        store.updateDocumentJob(job.id, { status: "error", error: prepareErr.message }, req.user);
        store.patchCreate({ lastError: prepareErr.message });
        return generateReply(req, res, { next: docsUrl, message: `Create: ${prepareErr.message}` });
      }
    }
    store.updateDocumentJob(job.id, { status: "error", error: err.message }, req.user);
    store.patchCreate({ lastError: err.message });
    return generateReply(req, res, { next: docsUrl, message: `Create: ${err.message}` });
  }
}

const SETUP_STEPS = ["org", "profile", "admin", "create", "azure"];
const PLATFORM_SETUP_STEPS = ["admin", "firstWorkspace", "azure"];

function allowedSetupStep(requested) {
  const current = store.setupStep();
  const curIdx = Math.max(0, SETUP_STEPS.indexOf(current));
  const reqIdx = SETUP_STEPS.indexOf(requested);
  if (reqIdx < 0) return current || "org";
  if (reqIdx > curIdx) return current || "org";
  return requested;
}

function platformSetupSteps() {
  return PLATFORM_SETUP_STEPS.slice();
}

function allowedPlatformSetupStep(requested) {
  const current = platformSetupStep() || "admin";
  const steps = platformSetupSteps();
  const curIdx = Math.max(0, steps.indexOf(current));
  const reqIdx = steps.indexOf(requested);
  if (reqIdx < 0) return current;
  if (reqIdx > curIdx) return current;
  return requested;
}

function finishSetup(req, res) {
  const admin = store.werknemers().find((w) => w.rol === "admin") || store.werknemers()[0];
  store.completeOnboarding(admin);
  if (admin) setSessionCookie(res, admin.id, req.store?.slug);
  res.redirect("/");
}

function finishPlatformSetup(req, res, admin, item, nextUrl) {
  if (admin) setSessionCookie(res, admin.id, PLATFORM_SESSION);
  if (item) {
    setWorkspaceCookie(res, item.slug);
    setLangCookie(res, item.defaultLang);
  }
  res.redirect(nextUrl || "/");
}

function firstWorkspaceTenant() {
  const item = workspaces()[0];
  return item ? openTenant(item.slug) : null;
}

function renderSetup(req, res, step, extra = {}) {
  const kind = extra.kind || "tenant";
  const steps = extra.steps || SETUP_STEPS;
  const azureStore = kind === "platform" ? firstWorkspaceTenant() : kind === "tenant" && req.store ? store : null;
  const createCfg = kind === "tenant" && req.store ? create.createSettings(store) : {};
  const azureCfg = azureStore ? azure.azureSettings(azureStore) : {};
  const platformAdmin = publicPlatformUser(platformUsers()[0]);
  const tenantAdmin = kind === "tenant" && req.store ? store.werknemers().find((w) => w.rol === "admin") : null;
  const defaults = {
    org: kind === "tenant" && req.store ? { orgName: store.meta().orgName, zaakPrefix: store.meta().zaakPrefix } : {},
    profile: kind === "tenant" && req.store
      ? { appProfile: appProfile(store.meta()), personeelPrefix: store.meta().personeelPrefix || "P" }
      : {},
    admin: (kind === "platform" ? platformAdmin : tenantAdmin)
      ? {
          id: (kind === "platform" ? platformAdmin : tenantAdmin).id,
          voornaam: (kind === "platform" ? platformAdmin : tenantAdmin).voornaam,
          achternaam: (kind === "platform" ? platformAdmin : tenantAdmin).achternaam,
          email: (kind === "platform" ? platformAdmin : tenantAdmin).email,
        }
      : {},
    firstWorkspace: {},
    create: {
      baseUrl: createCfg.baseUrl,
      clientId: createCfg.clientId,
      unitId: createCfg.unitId,
      contentSourceId: createCfg.contentSourceId,
      authDomain: createCfg.authDomain,
    },
    azure: { tenantId: azureCfg.tenantId, clientId: azureCfg.clientId },
  };
  res.render("setup", {
    layout: false,
    title: req.t("onboard.title"),
    kind,
    step,
    steps,
    stepIndex: Math.max(0, steps.indexOf(step)),
    error: extra.error || "",
    values: extra.values || defaults[step] || {},
    redirectUri: azureStore ? azure.redirectUri(req, azureStore) : "",
  });
}

function platformSetupView(req, res, step, extra = {}) {
  return renderSetup(req, res, step, {
    kind: "platform",
    steps: platformSetupSteps(),
    ...extra,
  });
}

function handlePlatformSetup(req, res) {
  const step = String(req.body.step || "");

  if (step === "admin") {
    const voornaam = String(req.body.voornaam || "").trim();
    const achternaam = String(req.body.achternaam || "").trim();
    const email = String(req.body.email || "").trim();
    const wachtwoord = String(req.body.wachtwoord || "");
    const wachtwoord2 = String(req.body.wachtwoord2 || "");
    const existing = platformUsers()[0];
    const values = { id: existing?.id, voornaam, achternaam, email };
    if (!voornaam || !achternaam) {
      return platformSetupView(req, res, "admin", { error: req.t("validation.nameRequired"), values });
    }
    if (!existing && wachtwoord.length < 8) {
      return platformSetupView(req, res, "admin", { error: req.t("validation.passwordShort"), values });
    }
    if (wachtwoord && wachtwoord.length < 8) {
      return platformSetupView(req, res, "admin", { error: req.t("validation.passwordShort"), values });
    }
    if (wachtwoord !== wachtwoord2) {
      return platformSetupView(req, res, "admin", { error: req.t("validation.passwordMismatch"), values });
    }
    try {
      const saved = savePlatformUser({
        id: existing?.id,
        voornaam,
        achternaam,
        email,
        wachtwoord,
      });
      if (!workspaces().length) return res.redirect("/setup?step=firstWorkspace");
      return finishPlatformSetup(req, res, saved, workspaces()[0]);
    } catch (err) {
      return platformSetupView(req, res, "admin", { error: adminError(req, err), values });
    }
  }

  if (step === "firstWorkspace") {
    const admin = publicPlatformUser(platformUsers()[0]);
    if (!admin) return res.redirect("/setup");
    const values = {
      name: req.body.name,
      slug: req.body.slug,
      defaultLang: req.body.defaultLang,
      appProfile: req.body.appProfile,
      domains: req.body.domains,
      adminVoornaam: req.body.adminVoornaam,
      adminAchternaam: req.body.adminAchternaam,
      adminEmail: req.body.adminEmail,
    };
    try {
      const created = createWorkspace({
        name: req.body.name,
        slug: req.body.slug,
        defaultLang: req.body.defaultLang || req.lang,
        appProfile: req.body.appProfile,
        seedDemo: leaseFlag(req.body.seedDemo),
        domains: req.body.domains,
        ...workspaceAdminInput(req.body),
      });
      setPlatformAzureDone(false);
      setWorkspaceCookie(res, created.slug);
      setLangCookie(res, created.defaultLang);
      return res.redirect("/setup?step=azure");
    } catch (err) {
      return platformSetupView(req, res, "firstWorkspace", { error: workspaceError(req, err), values });
    }
  }

  if (step === "azure") {
    const admin = publicPlatformUser(platformUsers()[0]);
    const item = workspaces()[0];
    if (!admin || !item) return res.redirect("/setup");
    const tenant = openTenant(item.slug);
    const skip = req.body.skip === "1";
    const link = req.body.link === "1";
    return runWithStore(tenant, () => {
      if (!skip) {
        const tenantId = String(req.body.tenantId || "").trim();
        const clientId = String(req.body.clientId || "").trim();
        const clientSecret = String(req.body.clientSecret || "").trim();
        const hasAny = tenantId || clientId || clientSecret;
        if (hasAny && !(tenantId && clientId && (clientSecret || azure.azureSettings(tenant).hasSecret))) {
          return platformSetupView(req, res, "azure", {
            error: req.t("azure.clientMissing"),
            values: req.body,
          });
        }
        if (link && !hasAny && !azure.enabled(azure.azureSettings(tenant))) {
          return platformSetupView(req, res, "azure", {
            error: req.t("toast.azureOff"),
            values: req.body,
          });
        }
        if (hasAny) {
          azure.saveAzureSettings(tenant, req.body, null);
          tenant.patchAzure({ active: true }, null);
        }
      }
      tenant.saveMeta({ setupAzureDone: true }, null);
      setPlatformAzureDone(true);
      return finishPlatformSetup(req, res, admin, item, link ? "/auth/azure?link=1" : "/");
    });
  }

  return res.redirect("/setup");
}

function routes() {
  const r = express.Router();

  r.use((req, res, next) => {
    if (needsPlatformSetup()) {
      if (req.path === "/setup" || req.path === "/lang" || req.path === "/api/health") return next();
      if (req.path.startsWith("/auth/azure")) return next();
      if (req.path.startsWith("/api/stuf-dcr")) return next();
      return res.redirect("/setup");
    }
    if (workspaceOpen(req)) return next();
    if (!req.store) {
      const visible = pickWorkspaces(req);
      return res.redirect(visible.length > 1 ? "/werkruimtes" : "/login");
    }
    if (!store.needsOnboarding()) return next();
    if (req.path === "/setup" || req.path === "/lang" || req.path === "/api/health") return next();
    if (req.path.startsWith("/auth/azure")) return next();
    if (req.path.startsWith("/api/stuf-dcr")) return next();
    return res.redirect("/setup");
  });

  r.get("/werkruimtes", (req, res) => {
    if (req.user && isGlobalAdmin(req.user)) return res.redirect("/instellingen/werkruimtes");
    const list = pickWorkspaces(req);
    if (!req.user && !list.length) {
      return res.render("workspaces/index", {
        layout: false,
        title: req.t("workspace.title"),
        items: list,
        error: req.query.error || "",
        canCreate: true,
      });
    }
    if (!req.user && list.length === 1) {
      setWorkspaceCookie(res, list[0].slug);
      return res.redirect("/login");
    }
    res.render("workspaces/index", {
      layout: false,
      title: req.t("workspace.title"),
      items: list,
      error: req.query.error || "",
      canCreate: false,
    });
  });

  r.post("/werkruimtes", (req, res) => {
    if (workspaces().length) return res.redirect("/werkruimtes");
    try {
      const created = createWorkspace({
        name: req.body.name,
        slug: req.body.slug,
        defaultLang: req.body.defaultLang || req.lang,
        appProfile: req.body.appProfile,
        seedDemo: leaseFlag(req.body.seedDemo),
        domains: req.body.domains,
      });
      setWorkspaceCookie(res, created.slug);
      setLangCookie(res, created.defaultLang);
      res.redirect("/login");
    } catch (err) {
      res.status(400).render("workspaces/index", {
        layout: false,
        title: req.t("workspace.title"),
        items: workspaces(),
        error: workspaceError(req, err),
        canCreate: true,
      });
    }
  });

  r.get("/w/:slug", (req, res) => {
    const item = workspace(req.params.slug);
    if (!item) return res.redirect("/login");
    const hostMatches = workspacesByHost(req.get("host"));
    if (hostMatches.length && !hostMatches.some((row) => row.slug === item.slug) && !isGlobalAdmin(req.user)) {
      return res.redirect("/werkruimtes");
    }
    setWorkspaceCookie(res, item.slug);
    setLangCookie(res, item.defaultLang);
    if (isGlobalAdmin(req.user)) {
      const nextUrl = req.query.next && String(req.query.next).startsWith("/") ? req.query.next : "/";
      return res.redirect(nextUrl === "/werkruimtes" ? "/" : nextUrl);
    }
    clearSessionCookie(res);
    const nextUrl = req.query.next && String(req.query.next).startsWith("/") ? req.query.next : "/login";
    res.redirect(nextUrl === "/werkruimtes" ? "/login" : nextUrl);
  });

  r.get("/login", (req, res) => {
    const existing = req.user || currentUser(req);
    if (existing) {
      return res.redirect("/");
    }
    const ctx = tenantForLogin(req);
    if (!ctx.item) return res.redirect("/werkruimtes");
    if (!req.store || req.store.slug !== ctx.item.slug) setWorkspaceCookie(res, ctx.item.slug);
    return renderLogin(req, res, { ctx });
  });

  r.post("/login", (req, res) => {
    const ctx = tenantForLogin(req);
    const nextUrl = req.body.next && String(req.body.next).startsWith("/") ? req.body.next : "/";
    if (!ctx.item) return res.redirect("/werkruimtes");
    setWorkspaceCookie(res, ctx.item.slug);
    const email = String(req.body.email || "").trim();
    const password = String(req.body.password || "");
    const global = platformUserByEmail(email);
    if (global) {
      if (!verifyPassword(password, global.wachtwoord)) {
        return renderLogin(req, res, { ctx, next: nextUrl, status: 401, error: req.t("login.error") });
      }
      setSessionCookie(res, global.id, PLATFORM_SESSION);
      return res.redirect(nextUrl || "/");
    }
    if (!workspaceAllowsEmail(ctx.item, email)) {
      return renderLogin(req, res, { ctx, next: nextUrl, status: 401, error: req.t("login.domainDenied") });
    }
    const row = ctx.tenant.werknemerByEmail(email);
    if (!row || isGlobalAdminEmail(row.email) || !verifyPassword(password, row.wachtwoord)) {
      return renderLogin(req, res, { ctx, next: nextUrl, status: 401, error: req.t("login.error") });
    }
    setSessionCookie(res, row.id, ctx.item.slug);
    res.redirect(nextUrl);
  });

  r.post("/logout", requireAuth, (req, res) => {
    clearSessionCookie(res);
    res.redirect("/login");
  });

  r.post("/lang", (req, res) => {
    setLangCookie(res, req.body.lang);
    const nextUrl = req.body.next && String(req.body.next).startsWith("/") ? req.body.next : "/";
    res.redirect(nextUrl.split("?")[0] === "/login" ? nextUrl : nextUrl);
  });

  r.get("/api/health", (_req, res) => {
    const items = workspaces().map((item) => {
      const tenant = openTenant(item.slug);
      return { slug: item.slug, name: item.name, counts: tenant.counts() };
    });
    res.json({ ok: true, service: "zaakhub", workspaces: items });
  });

  function rememberWebhook(tenant, { status, path, detail, jobId }) {
    tenant.patchCreate({
      lastWebhookAt: nowIso(),
      lastWebhookStatus: status,
      lastWebhookPath: String(path || "").slice(0, 300),
      lastWebhookDetail: String(detail || "").slice(0, 400),
    });
    tenant.log(null, "webhook", "document", jobId || "webhook", `${status}${detail ? ` · ${detail}` : ""}`);
    console.log(`create webhook ${status} ${path || ""} ${jobId || ""}`.trim());
  }

  async function handleCreateWebhook(req, res, tenant, job) {
    const body = create.webhookBody(req);
    const tokenState = create.webhookTokenState(req, job, body);
    const path = req.originalUrl || req.path;
    if (tokenState === "mismatch") {
      rememberWebhook(tenant, { status: "auth", path, detail: "token rejected", jobId: job.id });
      tenant.updateDocumentJob(job.id, {
        webhookAt: nowIso(),
        webhookStatus: "auth",
        webhookDetail: "token rejected",
      });
      return res.status(401).json({ ok: false });
    }

    const settings = create.createSettings(tenant);
    const fileUrl = create.documentUriFromBody(body);
    const failed = Boolean(body.error) || /error|fail/i.test(String(body.status || ""));
    const patch = {
      webhookAt: nowIso(),
      webhookStatus: failed ? "error" : fileUrl ? "ok" : "empty",
      webhookDetail: failed
        ? JSON.stringify(body.error || body.status || "Genereren mislukt").slice(0, 400)
        : fileUrl || Object.keys(body).slice(0, 8).join(", ") || "empty body",
      documentGenerationId: body.documentGenerationId || body.generationId || body.metadata?.documentGenerationId || "",
      documentUrl: fileUrl,
      error: failed ? JSON.stringify(body.error || body.status || "Genereren mislukt") : "",
    };
    if (failed) patch.status = "error";

    if (!failed && fileUrl) {
      try {
        const file = await create.fetchGeneratedFile(settings, fileUrl);
        if (file) {
          file.naam = documentFileName(job, file.naam, file);
          const bijlage = tenant.addBijlage(
            { zaakId: job.zaakId, werknemerId: job.werknemerId },
            create.saveGeneratedFile(file, tenant.dataDir),
            null
          );
          patch.bijlageId = bijlage.id;
          patch.status = "success";
          patch.webhookStatus = "ok";
        } else {
          patch.webhookStatus = "empty";
          patch.webhookDetail = "download failed";
          patch.error = "Download failed";
        }
      } catch (err) {
        patch.error = err.message;
        patch.webhookStatus = "error";
        patch.webhookDetail = err.message;
      }
    }

    tenant.updateDocumentJob(job.id, patch, null);
    rememberWebhook(tenant, {
      status: patch.webhookStatus,
      path,
      detail: patch.webhookDetail,
      jobId: job.id,
    });
    const origin = create.publicOrigin(req, settings);
    res.json({
      ok: true,
      navigateToUri: job.returnUrl || create.navigateToUriForJob(origin, job),
    });
  }

  r.post("/api/create/webhook/:slug/:jobId", async (req, res) => {
    try {
      const tenant = workspace(req.params.slug) ? openTenant(req.params.slug) : null;
      const job = tenant?.documentJob(req.params.jobId);
      if (!tenant) {
        console.log(`create webhook unknown workspace ${req.params.slug}`);
        return res.status(404).json({ ok: false });
      }
      if (!job) {
        rememberWebhook(tenant, {
          status: "unknown_job",
          path: req.originalUrl || req.path,
          detail: req.params.jobId,
          jobId: req.params.jobId,
        });
        return res.status(404).json({ ok: false });
      }
      await runWithStore(tenant, () => handleCreateWebhook(req, res, tenant, job));
    } catch (err) {
      console.error(err);
      res.status(500).json({ ok: false });
    }
  });

  r.post("/api/create/webhook/:jobId", async (req, res) => {
    try {
      const found = findDocumentJob(req.params.jobId);
      if (!found) {
        console.log(`create webhook unknown job ${req.params.jobId}`);
        return res.status(404).json({ ok: false });
      }
      await runWithStore(found.store, () => handleCreateWebhook(req, res, found.store, found.job));
    } catch (err) {
      console.error(err);
      res.status(500).json({ ok: false });
    }
  });

  function stufEndpointInfo(req, res, slug) {
    const origin = `${req.protocol}://${req.get("host") || "localhost"}`;
    res.type("text/plain").send(
      `StUF-DCR DCV endpoint for workspace ${slug || ""}\nPOST verstrekDocumentcreatieResultaatDi01 to ${origin}${req.path}`
    );
  }

  function rejectStufClientCert(req, res, tenant) {
    const stuf = stufDcr.stufSettings(tenant);
    const auth = stufDcr.verifyInboundClientCert(req, stuf);
    if (auth.ok) return false;
    const detail = auth.code === "missing" ? "geen clientcertificaat" : "clientcertificaat komt niet overeen";
    rememberStuf(tenant, {
      status: "auth",
      path: req.originalUrl || req.path,
      detail,
    });
    sendSoap(res, stufDcr.buildFault("Clientcertificaat ontbreekt of komt niet overeen"), 403);
    return true;
  }

  async function handleStufInbound(req, res, tenantHint) {
    if (tenantHint && rejectStufClientCert(req, res, tenantHint)) return;
    const xml = stufXmlBody(req);
    if (!xml.trim()) {
      return sendSoap(res, stufDcr.buildFault("Leeg SOAP-bericht"), 400);
    }
    const parsed = stufDcr.parseResult(xml);
    if (parsed.kind === "fault") {
      return sendSoap(res, stufDcr.buildFault(parsed.message), 400);
    }
    if (parsed.kind !== "di01" && parsed.kind !== "du02") {
      return sendSoap(res, stufDcr.buildFault("Verwacht verstrekDocumentcreatieResultaatDi01"), 400);
    }
    const refs = [parsed.jobidentificatie, parsed.referentienummer].map((value) => String(value || "").trim()).filter(Boolean);
    let found = null;
    for (const ref of refs) {
      const local = tenantHint?.documentJob(ref);
      if (local) {
        found = { store: tenantHint, job: local };
        break;
      }
      found = findStufJob(ref);
      if (found) break;
    }
    if (!found?.job) {
      if (tenantHint) {
        rememberStuf(tenantHint, {
          status: "unknown_job",
          path: req.originalUrl || req.path,
          detail: parsed.jobidentificatie || parsed.referentienummer,
          jobId: parsed.jobidentificatie,
        });
      }
      return sendSoap(res, stufDcr.buildFault("Onbekende creatiejob"), 404);
    }
    if (found.store !== tenantHint && rejectStufClientCert(req, res, found.store)) return;
    const stuf = stufDcr.stufSettings(found.store);
    await runWithStore(found.store, () => applyStufResult(req, found.store, found.job, parsed));
    return stufConfirm(res, stuf, parsed, found.job);
  }

  r.get("/api/stuf-dcr/:slug", (req, res) => stufEndpointInfo(req, res, req.params.slug));
  r.get("/api/stuf-dcr", (req, res) => stufEndpointInfo(req, res, req.store?.slug || ""));

  r.post("/api/stuf-dcr/:slug", async (req, res) => {
    try {
      const tenant = workspace(req.params.slug) ? openTenant(req.params.slug) : null;
      if (!tenant) return sendSoap(res, stufDcr.buildFault("Onbekende werkruimte"), 404);
      await handleStufInbound(req, res, tenant);
    } catch (err) {
      console.error(err);
      sendSoap(res, stufDcr.buildFault(err.message || "StUF-DCR fout"), 500);
    }
  });

  r.post("/api/stuf-dcr", async (req, res) => {
    try {
      await handleStufInbound(req, res, req.store);
    } catch (err) {
      console.error(err);
      sendSoap(res, stufDcr.buildFault(err.message || "StUF-DCR fout"), 500);
    }
  });

  r.get("/setup", (req, res) => {
    if (needsPlatformSetup()) {
      return renderSetup(req, res, allowedPlatformSetupStep(req.query.step), {
        kind: "platform",
        steps: platformSetupSteps(),
      });
    }
    if (!req.store) return res.redirect("/login");
    if (!store.needsOnboarding()) return res.redirect("/");
    renderSetup(req, res, allowedSetupStep(req.query.step), { kind: "tenant" });
  });

  r.post("/setup", (req, res) => {
    if (needsPlatformSetup()) {
      return handlePlatformSetup(req, res);
    }
    if (!req.store) return res.redirect("/login");
    if (!store.needsOnboarding()) return res.redirect("/");
    const step = String(req.body.step || "");
    const skip = req.body.skip === "1";

    if (step === "org") {
      store.saveMeta(
        {
          orgName: String(req.body.orgName || "").trim() || "Zaakhub",
          zaakPrefix: String(req.body.zaakPrefix || "ZH").trim().toUpperCase().slice(0, 6),
          setupOrgDone: true,
        },
        null
      );
      return res.redirect("/setup?step=profile");
    }

    if (step === "profile") {
      const chosen = appProfile({ appProfile: req.body.appProfile });
      store.saveMeta(
        {
          appProfile: chosen,
          personeelPrefix: String(req.body.personeelPrefix || "P").trim().toUpperCase().slice(0, 6) || "P",
          setupProfileDone: true,
        },
        null
      );
      return res.redirect("/setup?step=admin");
    }

    if (step === "admin") {
      const voornaam = String(req.body.voornaam || "").trim();
      const achternaam = String(req.body.achternaam || "").trim();
      const email = String(req.body.email || "").trim();
      const wachtwoord = String(req.body.wachtwoord || "");
      const wachtwoord2 = String(req.body.wachtwoord2 || "");
      const values = { voornaam, achternaam, email };
      if (!voornaam || !achternaam) {
        return renderSetup(req, res, "admin", { error: req.t("validation.nameRequired"), values });
      }
      if (wachtwoord.length < 8) {
        return renderSetup(req, res, "admin", { error: req.t("validation.passwordShort"), values });
      }
      if (wachtwoord !== wachtwoord2) {
        return renderSetup(req, res, "admin", { error: req.t("validation.passwordMismatch"), values });
      }
      const existing = store.werknemerByEmail(email) || store.werknemers().find((w) => w.rol === "admin");
      try {
        const saved = store.saveWerknemer(
          {
            id: existing?.id,
            voornaam,
            achternaam,
            email,
            rol: "admin",
            wachtwoord,
            authSource: "local",
          },
          existing || null
        );
        if (!platformUsers().length) {
          const raw = store.rawWerknemer(saved.id);
          savePlatformUser({
            id: saved.id,
            voornaam,
            achternaam,
            email,
            wachtwoord: raw?.wachtwoord || wachtwoord,
          });
        }
      } catch (err) {
        return renderSetup(req, res, "admin", { error: formError(req, err), values });
      }
      return res.redirect("/setup?step=create");
    }

    if (step === "create") {
      if (!skip) {
        const clientId = String(req.body.clientId || "").trim();
        const unitId = String(req.body.unitId || "").trim();
        const contentSourceId = String(req.body.contentSourceId || "").trim();
        const clientSecret = String(req.body.clientSecret || "").trim();
        const hasAny = clientId || unitId || contentSourceId || clientSecret;
        if (hasAny && !(clientId && unitId && contentSourceId && (clientSecret || create.createSettings(store).hasSecret))) {
          return renderSetup(req, res, "create", {
            error: req.t("toast.fillCreate"),
            values: req.body,
          });
        }
        if (hasAny) create.saveCreateSettings(store, req.body, null);
      }
      store.saveMeta({ setupCreateDone: true }, null);
      return res.redirect("/setup?step=azure");
    }

    if (step === "azure") {
      if (!skip) {
        const tenantId = String(req.body.tenantId || "").trim();
        const clientId = String(req.body.clientId || "").trim();
        const clientSecret = String(req.body.clientSecret || "").trim();
        const hasAny = tenantId || clientId || clientSecret;
        if (hasAny && !(tenantId && clientId && (clientSecret || azure.azureSettings(store).hasSecret))) {
          return renderSetup(req, res, "azure", {
            error: req.t("azure.clientMissing"),
            values: req.body,
          });
        }
        if (hasAny) {
          azure.saveAzureSettings(store, req.body, null);
          store.patchAzure({ active: true }, null);
        }
      }
      store.saveMeta({ setupAzureDone: true }, null);
      return finishSetup(req, res);
    }

    res.redirect("/setup");
  });

  function azureCookie(res, name, value) {
    res.cookie(name, value, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.COOKIE_SECURE === "true",
      maxAge: value ? 10 * 60 * 1000 : 0,
    });
  }

  function linkAzureToAdmin(admin, profile) {
    return savePlatformUser({
      id: admin.id,
      voornaam: admin.voornaam,
      achternaam: admin.achternaam,
      email: admin.email,
      wachtwoord: admin.wachtwoord,
      azureOid: profile.oid,
      azureEmail: profile.email,
    });
  }

  r.get("/auth/azure", (req, res) => {
    const current = currentUser(req);
    const linking = String(req.query.link || "") === "1" && isGlobalAdmin(current);
    const ctx = tenantForLogin(req);
    if (!ctx.item) return res.redirect("/login");
    setWorkspaceCookie(res, ctx.item.slug);
    const settings = azure.azureSettings(ctx.tenant);
    if (!azure.enabled(settings)) {
      if (linking) return toastT(req, res, "/instellingen/beheerders", "toast.azureOff");
      return res.redirect("/login");
    }
    const state = crypto.randomBytes(24).toString("hex");
    azureCookie(res, "zaakhub_azure", state);
    if (linking) azureCookie(res, "zaakhub_azure_link", current.id);
    else res.clearCookie("zaakhub_azure_link");
    res.redirect(azure.authorizeUrl(settings, { state, redirectUri: azure.redirectUri(req, ctx.tenant) }));
  });

  r.get("/auth/azure/callback", async (req, res) => {
    const ctx = tenantForLogin(req);
    const linkId = String(req.cookies?.zaakhub_azure_link || "");
    res.clearCookie("zaakhub_azure_link");
    try {
      if (!ctx.item) throw new Error(req.t("login.error"));
      if (req.query.error) throw new Error(String(req.query.error_description || req.query.error));
      const expected = req.cookies?.zaakhub_azure || "";
      res.clearCookie("zaakhub_azure");
      if (!expected || expected !== String(req.query.state || "")) {
        throw new Error(req.t("login.error"));
      }
      const settings = azure.azureSettings(ctx.tenant);
      if (!azure.enabled(settings)) throw new Error(req.t("common.notConfigured"));
      const tokens = await azure.exchangeCode(settings, {
        code: String(req.query.code || ""),
        redirectUri: azure.redirectUri(req, ctx.tenant),
      });
      const profile = await azure.fetchProfile(tokens.access_token);
      if (linkId) {
        const admin = platformUser(linkId);
        if (!admin) throw new Error(req.t("login.error"));
        linkAzureToAdmin(admin, profile);
        ctx.tenant.patchAzure({ lastError: "" });
        setSessionCookie(res, admin.id, PLATFORM_SESSION);
        return toastT(req, res, "/instellingen/beheerders", "toast.azureLinked");
      }
      const global = platformUserByAzure(profile.oid, profile.emails || profile.email);
      if (global) {
        linkAzureToAdmin(global, profile);
        ctx.tenant.patchAzure({ lastError: "" });
        setSessionCookie(res, global.id, PLATFORM_SESSION);
        const nextUrl = req.query.next && String(req.query.next).startsWith("/") ? req.query.next : "/";
        if (nextUrl === "/login" || nextUrl === "/werkruimtes") return res.redirect("/");
        return res.redirect(nextUrl);
      }
      if (!workspaceAllowsEmail(ctx.item, profile.email)) {
        throw new Error("DOMAIN_DENIED");
      }
      const user = azure.findOrCreateAzureUser(ctx.tenant, profile);
      ctx.tenant.patchAzure({ lastError: "" });
      setSessionCookie(res, user.id, ctx.item.slug);
      const nextUrl = req.query.next && String(req.query.next).startsWith("/") ? req.query.next : "/";
      res.redirect(nextUrl);
    } catch (err) {
      const message = err.message === "DOMAIN_DENIED" ? req.t("login.domainDenied") : err.message;
      if (ctx.tenant) ctx.tenant.patchAzure({ lastError: message });
      if (linkId) return toast(res, "/instellingen/beheerders", message);
      res.redirect(`/login?error=${encodeURIComponent(message)}`);
    }
  });

  r.use(requireAuth);

  r.use((req, res, next) => {
    if (req.store) return next();
    const route = req.path || "";
    const platformOnly =
      route === "/logout" ||
      route === "/api/tour" ||
      route === "/instellingen" ||
      route.startsWith("/instellingen/werkruimtes") ||
      route.startsWith("/instellingen/beheerders");
    if (isGlobalAdmin(req.user) && platformOnly) return next();
    if (isGlobalAdmin(req.user)) return res.redirect("/instellingen/werkruimtes");
    return res.redirect("/login");
  });

  r.use((req, res, next) => {
    if (!req.store || isCases(req.store.meta())) return next();
    if (
      req.path.startsWith("/zaken") ||
      req.path.startsWith("/personen") ||
      req.path.startsWith("/bedrijven")
    ) {
      return res.redirect("/werknemers");
    }
    if (req.path.startsWith("/instellingen/zaaktypen")) return res.redirect("/instellingen");
    next();
  });

  r.post("/api/tour", (req, res) => {
    if (isGlobalAdmin(req.user)) markPlatformTourDone(req.user.id);
    else store.markTourDone(req.user.id);
    res.json({ ok: true });
  });

  r.get("/", (req, res) => {
    res.render("dashboard", {
      title: req.t("dash.title"),
      counts: store.counts(),
      insights: store.dashboardInsights(req.lang),
      zaken: store.recentZaken(5),
      overdue: store.overdueZaken(),
      documenten: store.recentBijlagen(),
      werknemers: store.werknemers().filter((w) => !isGlobalAdminEmail(w.email)).slice(0, 8),
      activity: store.auditLog(3),
      firstName: firstName(req.user),
    });
  });

  r.get("/api/search", (req, res) => {
    const data = store.search(req.query.q);
    if (!isCases(store.meta())) {
      data.zaken = [];
      data.personen = [];
      data.bedrijven = [];
    }
    res.json(data);
  });

  r.get("/zaken", (req, res) => {
    const { fragment, lazyPending } = listRequest(req);
    if (fragment) res.locals.layout = false;
    const pageSizeOpts = [5, 10, 25, 50];
    const pageSize = pageSizeOpts.includes(Number(req.query.pageSize)) ? Number(req.query.pageSize) : 10;
    const composing = String(req.query.nieuw || "") === "1";
    const view = composing ? "overview" : parseView(req.query.view);
    if (view !== "board") res.locals.contentMod = " is-split-list";
    if (lazyPending && view !== "board") {
      return res.render("cases/index", {
        title: req.t("nav.cases"),
        zaken: [],
        total: 0,
        page: 1,
        pages: 1,
        pageSize,
        pageSizeOpts,
        from: 0,
        to: 0,
        q: req.query.q || "",
        status: req.query.status || "",
        zaaktypeId: req.query.zaaktypeId || "",
        prioriteit: req.query.prioriteit || "",
        view,
        focus: "",
        compose: false,
        peek: null,
        peekActivity: [],
        peekTab: "holders",
        recipes: [],
        templatesLinked: false,
        createReady: false,
        groups: OVERVIEW_GROUPS,
        statussen: STATUSSEN,
        prioriteiten: PRIORITEITEN,
        zaaktypen: store.zaaktypen(),
        werknemers: [],
        personen: [],
        bedrijven: [],
        lazyPending: true,
      });
    }
    const all = store.zaken({
      q: req.query.q,
      status: req.query.status,
      zaaktypeId: req.query.zaaktypeId,
      prioriteit: req.query.prioriteit,
    });
    const total = all.length;
    const pages = Math.max(1, Math.ceil(total / pageSize) || 1);
    let focusId = composing ? "" : String(req.query.focus || "");
    if (focusId && !store.zaak(focusId)) focusId = "";
    let page = Math.min(pages, Math.max(1, Number(req.query.page) || 1));
    if (focusId && view !== "board" && !req.query.page) {
      const focusIndex = all.findIndex((z) => z.id === focusId);
      if (focusIndex >= 0) page = Math.floor(focusIndex / pageSize) + 1;
    }
    const start = (page - 1) * pageSize;
    const pageZaken = view === "board" ? all : all.slice(start, start + pageSize);
    if (!composing && !focusId && pageZaken[0]) focusId = pageZaken[0].id;
    const peek = composing ? draftZaak() : (focusId ? store.zaak(focusId) : null);
    const settings = create.createSettings(store);
    const peekType = peek?.zaaktypeId ? store.zaaktype(peek.zaaktypeId) : null;
    const peekTab = ["holders", "activity", "docs"].includes(String(req.query.peekTab || ""))
      ? String(req.query.peekTab)
      : "holders";
    res.render("cases/index", {
      title: req.t("nav.cases"),
      zaken: pageZaken,
      total,
      page,
      pages,
      pageSize,
      pageSizeOpts,
      from: total ? start + 1 : 0,
      to: Math.min(total, start + pageSize),
      q: req.query.q || "",
      status: req.query.status || "",
      zaaktypeId: req.query.zaaktypeId || "",
      prioriteit: req.query.prioriteit || "",
      view,
      focus: focusId,
      compose: composing,
      peek,
      peekActivity: composing || !peek ? [] : store.zaakActivity(peek, 8),
      peekTab,
      recipes: composing ? [] : recipesForZaak(peek),
      templatesLinked: Boolean(peekType?.recipeIds?.length),
      createReady: documentChannelReady(),
      groups: OVERVIEW_GROUPS,
      statussen: STATUSSEN,
      prioriteiten: PRIORITEITEN,
      zaaktypen: store.zaaktypen(),
      werknemers: store.werknemers(),
      personen: store.personen(),
      bedrijven: store.bedrijven(),
      lazyPending: false,
      ...(fragment ? { layout: false } : {}),
    });
  });

  r.post("/zaken/bulk", (req, res) => {
    const back = zakenListPath(req.body || {});
    const selected = ids(req.body.ids);
    if (!selected.length) return toastT(req, res, back, "toast.noneSelected");

    const nextStatus = STATUSSEN.some((s) => s.id === req.body.status) ? req.body.status : null;
    const nextPrio = PRIORITEITEN.some((p) => p.id === req.body.prioriteit) ? req.body.prioriteit : null;
    const assign = Object.prototype.hasOwnProperty.call(req.body, "behandelaarId");
    const knownAssignees = new Set(store.werknemers().map((w) => w.id));
    const nextAssignee = req.body.behandelaarId === "__none__" || !req.body.behandelaarId
      ? ""
      : (knownAssignees.has(req.body.behandelaarId) ? req.body.behandelaarId : null);
    const addStake = req.body.addStakeholders === "1";
    const addPersonen = ids(req.body.addPersoonIds);
    const addBedrijven = ids(req.body.addBedrijfIds);
    const remove = req.body.delete === "1";

    if (!nextStatus && !nextPrio && !(assign && nextAssignee !== null) && !addStake && !remove) {
      return toastT(req, res, back, "toast.noneSelected");
    }
    if (addStake && !addPersonen.length && !addBedrijven.length) {
      return toastT(req, res, back, "toast.noneSelected");
    }

    let n = 0;
    selected.forEach((id) => {
      const zaak = store.zaak(id);
      if (!zaak) return;
      if (remove) {
        store.deleteZaak(id, req.user);
        n += 1;
        return;
      }
      const patch = {};
      if (nextStatus) patch.status = nextStatus;
      if (nextPrio) patch.prioriteit = nextPrio;
      if (assign && nextAssignee !== null) patch.behandelaarId = nextAssignee;
      if (addStake) {
        patch.persoonIds = [...new Set([...(zaak.persoonIds || []), ...addPersonen])];
        patch.bedrijfIds = [...new Set([...(zaak.bedrijfIds || []), ...addBedrijven])];
      }
      store.saveZaak(zaakWriteFields(zaak, patch), req.user);
      n += 1;
    });

    if (remove) return toastT(req, res, back, "toast.casesDeleted", { n });
    toastT(req, res, back, "toast.casesUpdated", { n });
  });

  r.get("/zaken/nieuw", (_req, res) => {
    res.redirect("/zaken?nieuw=1");
  });

  r.post("/zaken", (req, res) => {
    const fromList = req.body.from === "list";
    const zaak = store.saveZaak(
      {
        titel: req.body.titel,
        omschrijving: req.body.omschrijving,
        zaaktypeId: req.body.zaaktypeId,
        referentie: req.body.referentie,
        voortgang: req.body.voortgang,
        status: req.body.status,
        prioriteit: req.body.prioriteit,
        startdatum: req.body.startdatum,
        deadline: req.body.deadline,
        behandelaarId: req.body.behandelaarId,
        bedrijfIds: ids(req.body.bedrijfIds),
        persoonIds: ids(req.body.persoonIds),
      },
      req.user
    );
    if (fromList) {
      return toastT(req, res, zakenListPath({ ...req.body, filterFocus: zaak.id, filterPage: "1" }), "toast.caseCreated");
    }
    toastT(req, res, zaakFocusPath(zaak.id), "toast.caseCreated");
  });

  r.get("/zaken/:id", (req, res) => {
    const zaak = store.zaak(req.params.id);
    if (!zaak) return res.status(404).render("fout", { title: req.t("error.notFound"), message: req.t("error.notFoundCase") });
    const peekTab = peekTabFromCaseTab(req.query.tab);
    res.redirect(zaakFocusPath(zaak.id, peekTab ? { peekTab } : {}));
  });

  r.get("/zaken/:id/bewerken", (req, res) => {
    const zaak = store.zaak(req.params.id);
    if (!zaak) return res.status(404).render("fout", { title: req.t("error.notFound"), message: req.t("error.notFoundCase") });
    res.render("cases/form", withModal(req, {
      title: `${req.t("cases.edit")} ${zaak.zaaknummer}`,
      zaak,
      statussen: STATUSSEN,
      prioriteiten: PRIORITEITEN,
      bedrijven: store.bedrijven(),
      personen: store.personen(),
      werknemers: store.werknemers(),
      zaaktypen: store.zaaktypen(),
    }));
  });

  r.post("/zaken/:id", (req, res) => {
    const zaak = store.zaak(req.params.id);
    if (!zaak) return res.status(404).render("fout", { title: req.t("error.notFound"), message: req.t("error.notFoundCase") });
    const fromList = req.body.from === "list";
    store.saveZaak(
      {
        id: req.params.id,
        titel: req.body.titel,
        omschrijving: req.body.omschrijving,
        zaaktypeId: req.body.zaaktypeId,
        referentie: req.body.referentie,
        voortgang: fromList ? zaak.voortgang : req.body.voortgang,
        status: req.body.status,
        prioriteit: fromList ? zaak.prioriteit : req.body.prioriteit,
        startdatum: req.body.startdatum,
        deadline: req.body.deadline,
        behandelaarId: req.body.behandelaarId,
        bedrijfIds: ids(req.body.bedrijfIds),
        persoonIds: ids(req.body.persoonIds),
      },
      req.user
    );
    if (fromList) {
      return toastT(req, res, zakenListPath({ ...req.body, filterFocus: zaak.id }), "toast.caseSaved");
    }
    toastT(req, res, zaakFocusPath(req.params.id), "toast.caseSaved");
  });

  r.post("/zaken/:id/status", (req, res) => {
    const zaak = store.zaak(req.params.id);
    if (!zaak) return res.status(404).render("fout", { title: req.t("error.notFound"), message: req.t("error.notFoundCase") });
    if (!quickStatusOn()) {
      if (req.body.from === "list") {
        return toastT(req, res, zakenListPath({ ...req.body, filterFocus: zaak.id }), "toast.quickStatusOff");
      }
      return toastT(req, res, zaakFocusPath(zaak.id), "toast.quickStatusOff");
    }
    const next = STATUSSEN.some((s) => s.id === req.body.status) ? req.body.status : zaak.status;
    store.saveZaak(
      {
        id: zaak.id,
        titel: zaak.titel,
        omschrijving: zaak.omschrijving,
        zaaktypeId: zaak.zaaktypeId,
        referentie: zaak.referentie,
        voortgang: zaak.voortgang,
        status: next,
        prioriteit: zaak.prioriteit,
        startdatum: zaak.startdatum,
        deadline: zaak.deadline,
        behandelaarId: zaak.behandelaarId,
        bedrijfIds: zaak.bedrijfIds,
        persoonIds: zaak.persoonIds,
      },
      req.user
    );
    if (req.body.from === "list") {
      return toastT(req, res, zakenListPath({ ...req.body, filterFocus: zaak.id }), "toast.caseSaved");
    }
    toastT(req, res, zaakFocusPath(zaak.id), "toast.caseSaved");
  });

  r.post("/zaken/:id/verwijderen", (req, res) => {
    store.deleteZaak(req.params.id, req.user);
    toastT(req, res, "/zaken", "toast.caseDeleted");
  });

  r.post("/zaken/:id/bijlagen", (_req, res) => {
    res.status(404).render("fout", { title: res.locals.t("error.notFound"), message: res.locals.t("error.notFoundPage") });
  });

  r.get("/zaken/:id/bijlagen/:bijlageId", (req, res) => {
    const bijlage = store.bijlage(req.params.bijlageId);
    if (!bijlage || bijlage.zaakId !== req.params.id) return res.status(404).send(req.t("error.notFound"));
    const filePath = uploadsFile(req, bijlage.stored);
    const isPdf = /pdf/i.test(bijlage.mime || "") || /\.pdf$/i.test(bijlage.naam || "");
    if (req.query.download === "1" || !isPdf) {
      return res.download(filePath, bijlage.naam);
    }
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(bijlage.naam)}`);
    res.sendFile(path.resolve(filePath));
  });

  function afterCaseDocumentDelete(req, res) {
    if (req.body.from === "list") {
      return toastT(
        req,
        res,
        zakenListPath({ ...req.body, filterFocus: req.params.id, filterPeekTab: "docs" }),
        "toast.attachmentDeleted"
      );
    }
    toastT(req, res, zaakFocusPath(req.params.id, { peekTab: "docs" }), "toast.attachmentDeleted");
  }

  r.post("/zaken/:id/bijlagen/:bijlageId/verwijderen", (req, res) => {
    const bijlage = store.bijlage(req.params.bijlageId);
    if (!bijlage || bijlage.zaakId !== req.params.id) {
      return res.status(404).render("fout", { title: req.t("error.notFound"), message: req.t("error.notFoundCase") });
    }
    store.deleteBijlage(req.params.bijlageId, req.user);
    afterCaseDocumentDelete(req, res);
  });

  r.post("/zaken/:id/documenten/:jobId/verwijderen", (req, res) => {
    const job = store.documentJob(req.params.jobId);
    if (!job || job.zaakId !== req.params.id) {
      return res.status(404).render("fout", { title: req.t("error.notFound"), message: req.t("error.notFoundCase") });
    }
    store.deleteDocumentJob(req.params.jobId, req.user);
    afterCaseDocumentDelete(req, res);
  });

  r.post("/zaken/:id/documenten", async (req, res) => {
    const zaak = store.zaak(req.params.id);
    if (!zaak) return res.status(404).render("fout", { title: req.t("error.notFound"), message: req.t("error.notFoundCase") });
    const recipe = store.recipe(req.body.recipeId);
    const fromList = req.body.from === "list";
    const listBack = zakenListPath({ ...req.body, filterFocus: zaak.id, filterPeekTab: "docs" });
    const recipeName = (recipe && recipe.name) || "document";
    const targets = create.pickStakeholders(zaak, bodyValues(req.body.stakeholder)).map((stake) => ({
      ...stake,
      data: create.prefillData(zaak, recipe || {}, { persoon: stake.persoon, bedrijf: stake.bedrijf }),
      fileName: `${recipeName}-${zaak.zaaknummer}${stake.name ? `-${stake.name}` : ""}.pdf`,
    }));
    await generateOwnerDocument(req, res, {
      owner: { zaakId: zaak.id },
      data: targets[0]?.data || create.prefillData(zaak, recipe || {}),
      fileName: targets[0]?.fileName || `${recipeName}-${zaak.zaaknummer}.pdf`,
      targets,
      docsUrl: fromList ? listBack : zaakFocusPath(zaak.id, { peekTab: "docs" }),
      backUrl: fromList ? listBack : zaakFocusPath(zaak.id),
    });
  });

  r.get("/bedrijven", (req, res) => {
    const { fragment, lazyPending } = listRequest(req);
    if (fragment) res.locals.layout = false;
    const canWrite = canWriteMaster(req.user);
    res.locals.contentMod = " is-split-list";
    if (lazyPending) {
      return res.render("bedrijven/index", {
        title: req.t("nav.companies"),
        bedrijven: [],
        q: req.query.q || "",
        group: req.query.group || "",
        groups: COMPANY_GROUPS,
        canWrite,
        compose: false,
        focus: "",
        peek: null,
        peekCases: [],
        peekPersons: [],
        peekTab: "contacts",
        lazyPending: true,
      });
    }
    const composing = canWrite && String(req.query.nieuw || "") === "1";
    const all = store.bedrijven(req.query.q, req.query.group);
    let focusId = composing ? "" : String(req.query.focus || "");
    if (focusId && !store.bedrijf(focusId)) focusId = "";
    if (!composing && !focusId && all[0]) focusId = all[0].id;
    const peek = composing ? draftBedrijf() : (focusId ? store.bedrijf(focusId) : null);
    const peekTab = ["contacts", "cases"].includes(String(req.query.peekTab || ""))
      ? String(req.query.peekTab)
      : "contacts";
    res.render("bedrijven/index", {
      title: req.t("nav.companies"),
      bedrijven: all,
      q: req.query.q || "",
      group: req.query.group || "",
      groups: COMPANY_GROUPS,
      canWrite,
      compose: composing,
      focus: focusId,
      peek,
      peekCases: peek && peek.id ? linkedZaken("company", peek.id) : [],
      peekPersons: peek && peek.id ? store.personenForBedrijf(peek.id) : [],
      peekTab,
      lazyPending: false,
      ...(fragment ? { layout: false } : {}),
    });
  });

  r.get("/bedrijven/nieuw", requireRole("admin", "zaakmanager"), (_req, res) => {
    res.redirect("/bedrijven?nieuw=1");
  });

  r.post("/bedrijven", requireRole("admin", "zaakmanager"), (req, res) => {
    const fromList = req.body.from === "list";
    const row = store.saveBedrijf(req.body, req.user);
    if (fromList) {
      return toastT(req, res, nawListPath("/bedrijven", { ...req.body, filterFocus: row.id }), "toast.companySaved");
    }
    toastT(req, res, nawFocusPath("/bedrijven", row.id), "toast.companySaved");
  });

  r.get("/bedrijven/:id", (req, res) => {
    const bedrijf = store.bedrijf(req.params.id);
    if (!bedrijf) return res.status(404).render("fout", { title: req.t("error.notFound"), message: req.t("error.notFoundCompany") });
    const peekTab = peekTabFromNawTab(req.query.tab);
    res.redirect(nawFocusPath("/bedrijven", bedrijf.id, peekTab ? { peekTab } : {}));
  });

  r.get("/bedrijven/:id/bewerken", requireRole("admin", "zaakmanager"), (req, res) => {
    const bedrijf = store.bedrijf(req.params.id);
    if (!bedrijf) return res.status(404).render("fout", { title: req.t("error.notFound"), message: req.t("error.notFoundCompany") });
    res.render("bedrijven/form", withModal(req, { title: req.t("companies.edit"), bedrijf }));
  });

  r.post("/bedrijven/bulk", requireRole("admin", "zaakmanager"), (req, res) => {
    const back = nawListPath("/bedrijven", { ...req.body, filterFocus: "" });
    const selected = ids(req.body.ids);
    if (!selected.length || req.body.delete !== "1") return toastT(req, res, back, "toast.noneSelected");
    let n = 0;
    selected.forEach((id) => {
      if (!store.bedrijf(id)) return;
      store.deleteBedrijf(id, req.user);
      n += 1;
    });
    toastT(req, res, back, n === 1 ? "toast.companyDeleted" : "toast.companiesDeleted", { n });
  });

  r.post("/bedrijven/:id", requireRole("admin", "zaakmanager"), (req, res) => {
    store.saveBedrijf({ ...req.body, id: req.params.id }, req.user);
    if (req.body.from === "list") {
      return toastT(req, res, nawListPath("/bedrijven", { ...req.body, filterFocus: req.params.id }), "toast.companySaved");
    }
    toastT(req, res, nawFocusPath("/bedrijven", req.params.id), "toast.companySaved");
  });

  r.post("/bedrijven/:id/verwijderen", requireRole("admin", "zaakmanager"), (req, res) => {
    store.deleteBedrijf(req.params.id, req.user);
    const back = req.body.from === "list" ? nawListPath("/bedrijven", { ...req.body, filterFocus: "" }) : "/bedrijven";
    toastT(req, res, back, "toast.companyDeleted");
  });

  r.get("/personen", (req, res) => {
    const { fragment, lazyPending } = listRequest(req);
    if (fragment) res.locals.layout = false;
    const canWrite = canWriteMaster(req.user);
    res.locals.contentMod = " is-split-list";
    if (lazyPending) {
      return res.render("personen/index", {
        title: req.t("nav.persons"),
        personen: [],
        q: req.query.q || "",
        group: req.query.group || "",
        groups: PERSON_GROUPS,
        canWrite,
        compose: false,
        focus: "",
        peek: null,
        peekCases: [],
        bedrijven: [],
        peekTab: "cases",
        lazyPending: true,
      });
    }
    const composing = canWrite && String(req.query.nieuw || "") === "1";
    const all = store.personen(req.query.q, req.query.group);
    let focusId = composing ? "" : String(req.query.focus || "");
    if (focusId && !store.persoon(focusId)) focusId = "";
    if (!composing && !focusId && all[0]) focusId = all[0].id;
    const peek = composing ? draftPersoon() : (focusId ? store.persoon(focusId) : null);
    const peekTab = String(req.query.peekTab || "") === "cases" ? "cases" : "";
    res.render("personen/index", {
      title: req.t("nav.persons"),
      personen: all,
      q: req.query.q || "",
      group: req.query.group || "",
      groups: PERSON_GROUPS,
      canWrite,
      compose: composing,
      focus: focusId,
      peek,
      peekCases: peek && peek.id ? linkedZaken("person", peek.id) : [],
      bedrijven: store.bedrijven(),
      peekTab,
      lazyPending: false,
      ...(fragment ? { layout: false } : {}),
    });
  });

  r.get("/personen/nieuw", requireRole("admin", "zaakmanager"), (_req, res) => {
    res.redirect("/personen?nieuw=1");
  });

  r.post("/personen", requireRole("admin", "zaakmanager"), (req, res) => {
    const fromList = req.body.from === "list";
    const row = store.savePersoon(req.body, req.user);
    if (fromList) {
      return toastT(req, res, nawListPath("/personen", { ...req.body, filterFocus: row.id }), "toast.personSaved");
    }
    toastT(req, res, nawFocusPath("/personen", row.id), "toast.personSaved");
  });

  r.get("/personen/:id", (req, res) => {
    const persoon = store.persoon(req.params.id);
    if (!persoon) return res.status(404).render("fout", { title: req.t("error.notFound"), message: req.t("error.notFoundPerson") });
    const peekTab = peekTabFromNawTab(req.query.tab);
    res.redirect(nawFocusPath("/personen", persoon.id, peekTab ? { peekTab } : {}));
  });

  r.get("/personen/:id/bewerken", requireRole("admin", "zaakmanager"), (req, res) => {
    const persoon = store.persoon(req.params.id);
    if (!persoon) return res.status(404).render("fout", { title: req.t("error.notFound"), message: req.t("error.notFoundPerson") });
    res.render("personen/form", withModal(req, { title: req.t("persons.edit"), persoon, bedrijven: store.bedrijven() }));
  });

  r.post("/personen/bulk", requireRole("admin"), (req, res) => {
    const back = nawListPath("/personen", { ...req.body, filterFocus: "" });
    const selected = ids(req.body.ids);
    if (!selected.length || req.body.delete !== "1") return toastT(req, res, back, "toast.noneSelected");
    let n = 0;
    selected.forEach((id) => {
      if (!store.persoon(id)) return;
      store.deletePersoon(id, req.user);
      n += 1;
    });
    toastT(req, res, back, n === 1 ? "toast.personDeleted" : "toast.personsDeleted", { n });
  });

  r.post("/personen/:id", requireRole("admin", "zaakmanager"), (req, res) => {
    store.savePersoon({ ...req.body, id: req.params.id }, req.user);
    if (req.body.from === "list") {
      return toastT(req, res, nawListPath("/personen", { ...req.body, filterFocus: req.params.id }), "toast.personSaved");
    }
    toastT(req, res, nawFocusPath("/personen", req.params.id), "toast.personSaved");
  });

  r.post("/personen/:id/anonimiseren", requireRole("admin", "zaakmanager"), (req, res) => {
    store.anonymizePersoon(req.params.id, req.user);
    if (req.body.from === "list") {
      return toastT(req, res, nawListPath("/personen", req.body), "toast.personAnon");
    }
    toastT(req, res, nawFocusPath("/personen", req.params.id), "toast.personAnon");
  });

  r.post("/personen/:id/verwijderen", requireRole("admin"), (req, res) => {
    store.deletePersoon(req.params.id, req.user);
    const back = req.body.from === "list" ? nawListPath("/personen", { ...req.body, filterFocus: "" }) : "/personen";
    toastT(req, res, back, "toast.personDeleted");
  });

  r.get("/werknemers", employeesRead, (req, res) => {
    const { fragment, lazyPending } = listRequest(req);
    if (fragment) res.locals.layout = false;
    const canWrite = employeeCanWrite(req);
    res.locals.contentMod = " is-split-list";
    const q = req.query.q || "";
    const group = req.query.group || "";
    const docs = employeeDocContext();
    if (lazyPending) {
      return res.render("werknemers/index", {
        title: req.t("employees.overview"),
        werknemers: [],
        q,
        group,
        groups: ROLLEN,
        canWrite,
        compose: false,
        focus: "",
        peek: null,
        peekCases: [],
        lazyPending: true,
        peekTab: "docs",
        ...docs,
      });
    }
    const composing = canWrite && String(req.query.nieuw || "") === "1";
    const all = filterWerknemers(q, group);
    let focusId = composing ? "" : String(req.query.focus || "");
    if (focusId && !store.werknemer(focusId)) focusId = "";
    if (!composing && !focusId && all[0]) focusId = all[0].id;
    const peek = composing ? draftWerknemer() : (focusId ? store.werknemer(focusId) : null);
    const peekTab = ["docs", "cases"].includes(String(req.query.peekTab || ""))
      ? String(req.query.peekTab)
      : "docs";
    res.render("werknemers/index", {
      title: req.t("employees.overview"),
      werknemers: all,
      q,
      group,
      groups: ROLLEN,
      canWrite,
      compose: composing,
      focus: focusId,
      peek,
      peekCases: peek && peek.id && isCases(store.meta()) ? assignedZaken(peek.id) : [],
      peekTab,
      lazyPending: false,
      ...docs,
      ...(fragment ? { layout: false } : {}),
    });
  });

  r.get("/werknemers/nieuw", employeesWrite, (_req, res) => {
    res.redirect("/werknemers?nieuw=1");
  });

  r.post("/werknemers", employeesWrite, (req, res) => {
    const fromList = req.body.from === "list";
    try {
      const { row, destSlug } = persistWerknemer(req, employeeBody(req));
      return redirectEmployeeSaved(req, res, row, destSlug, fromList);
    } catch (err) {
      if (fromList) {
        const q = req.body.filterQ || "";
        const group = req.body.filterGroup || "";
        res.locals.contentMod = " is-split-list";
        return res.status(400).render("werknemers/index", {
          title: req.t("employees.new"),
          werknemers: filterWerknemers(q, group),
          q,
          group,
          groups: ROLLEN,
          canWrite: true,
          compose: true,
          focus: "",
          peek: { ...draftWerknemer(), ...req.body, leaseauto: leaseFlag(req.body.leaseauto) },
          peekCases: [],
          lazyPending: false,
          error: formError(req, err),
          ...employeeDocContext(),
        });
      }
      res.status(400).render("werknemers/form", employeeFormLocals(req, {
        title: req.t("employees.new"),
        werknemer: req.body,
        error: formError(req, err),
      }));
    }
  });

  r.get("/werknemers/:id", employeesRead, (req, res) => {
    const werknemer = store.werknemer(req.params.id);
    if (!werknemer) return res.status(404).render("fout", { title: req.t("error.notFound"), message: req.t("error.notFoundEmployee") });
    const settings = create.createSettings(store);
    const zaken = isCases(store.meta()) ? assignedZaken(werknemer.id) : [];
    const tab = ["documents", "cases"].includes(String(req.query.tab || ""))
      ? String(req.query.tab)
      : "details";
    res.render("werknemers/show", {
      title: werknemer.naam,
      werknemer: {
        ...werknemer,
        documentJobs: (werknemer.documentJobs || []).map((job) => ({
          ...job,
          finalizeUrl: create.withAuthDomain(job.finalizeUrl, settings),
        })),
      },
      zaken,
      recipes: visibleRecipes(),
      createReady: documentChannelReady(),
      tab,
      canWrite: isHr(store.meta()) ? canWriteMaster(req.user) : isAdmin(req.user),
    });
  });

  r.get("/werknemers/:id/bewerken", employeesWrite, (req, res) => {
    const werknemer = store.werknemer(req.params.id);
    if (!werknemer) return res.status(404).render("fout", { title: req.t("error.notFound"), message: req.t("error.notFoundEmployee") });
    res.render("werknemers/form", withModal(req, employeeFormLocals(req, { title: req.t("employees.edit"), werknemer })));
  });

  r.post("/werknemers/bulk", employeesWrite, (req, res) => {
    const back = nawListPath("/werknemers", { ...req.body, filterFocus: "" });
    const selected = ids(req.body.ids);
    if (!selected.length || req.body.delete !== "1") return toastT(req, res, back, "toast.noneSelected");
    let n = 0;
    let blockedSelf = false;
    selected.forEach((id) => {
      if (id === req.user.id) {
        blockedSelf = true;
        return;
      }
      if (!store.werknemer(id)) return;
      store.deleteWerknemer(id, req.user);
      n += 1;
    });
    if (!n && blockedSelf) return toastT(req, res, back, "toast.cannotDeleteSelf");
    toastT(req, res, back, n === 1 ? "toast.employeeDeleted" : "toast.employeesDeleted", { n });
  });

  r.post("/werknemers/:id", employeesWrite, (req, res) => {
    const fromList = req.body.from === "list";
    try {
      const { row, destSlug } = persistWerknemer(req, { ...employeeBody(req), id: req.params.id });
      return redirectEmployeeSaved(req, res, row, destSlug, fromList);
    } catch (err) {
      const existing = store.werknemer(req.params.id) || draftWerknemer();
      const werknemer = { ...existing, ...req.body, id: req.params.id, leaseauto: leaseFlag(req.body.leaseauto) };
      if (fromList) {
        const q = req.body.filterQ || "";
        const group = req.body.filterGroup || "";
        res.locals.contentMod = " is-split-list";
        return res.status(400).render("werknemers/index", {
          title: req.t("employees.edit"),
          werknemers: filterWerknemers(q, group),
          q,
          group,
          groups: ROLLEN,
          canWrite: true,
          compose: false,
          focus: req.params.id,
          peek: werknemer,
          peekCases: isCases(store.meta()) ? assignedZaken(req.params.id) : [],
          lazyPending: false,
          error: formError(req, err),
          forceEdit: true,
          ...employeeDocContext(),
        });
      }
      res.status(400).render("werknemers/form", employeeFormLocals(req, {
        title: req.t("employees.edit"),
        werknemer,
        error: formError(req, err),
      }));
    }
  });

  r.post("/werknemers/:id/verwijderen", employeesWrite, (req, res) => {
    const back = req.body.from === "list" ? nawListPath("/werknemers", { ...req.body, filterFocus: "" }) : "/werknemers";
    if (req.params.id === req.user.id) return toastT(req, res, back, "toast.cannotDeleteSelf");
    store.deleteWerknemer(req.params.id, req.user);
    toastT(req, res, back, "toast.employeeDeleted");
  });

  r.get("/werknemers/:id/bijlagen/:bijlageId", employeesRead, (req, res) => {
    const bijlage = store.bijlage(req.params.bijlageId);
    if (!bijlage || bijlage.werknemerId !== req.params.id) return res.status(404).send(req.t("error.notFound"));
    const filePath = uploadsFile(req, bijlage.stored);
    const isPdf = /pdf/i.test(bijlage.mime || "") || /\.pdf$/i.test(bijlage.naam || "");
    if (req.query.download === "1" || !isPdf) {
      return res.download(filePath, bijlage.naam);
    }
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(bijlage.naam)}`);
    res.sendFile(path.resolve(filePath));
  });

  function afterEmployeeDocumentDelete(req, res) {
    if (req.body.from === "list") {
      return toastT(
        req,
        res,
        nawListPath("/werknemers", { ...req.body, filterFocus: req.params.id, filterPeekTab: "docs" }),
        "toast.attachmentDeleted"
      );
    }
    toastT(req, res, `/werknemers/${req.params.id}?tab=documents`, "toast.attachmentDeleted");
  }

  r.post("/werknemers/:id/bijlagen/:bijlageId/verwijderen", employeesWrite, (req, res) => {
    const bijlage = store.bijlage(req.params.bijlageId);
    if (!bijlage || bijlage.werknemerId !== req.params.id) {
      return res.status(404).render("fout", { title: req.t("error.notFound"), message: req.t("error.notFoundEmployee") });
    }
    store.deleteBijlage(req.params.bijlageId, req.user);
    afterEmployeeDocumentDelete(req, res);
  });

  r.post("/werknemers/:id/documenten/:jobId/verwijderen", employeesWrite, (req, res) => {
    const job = store.documentJob(req.params.jobId);
    if (!job || job.werknemerId !== req.params.id) {
      return res.status(404).render("fout", { title: req.t("error.notFound"), message: req.t("error.notFoundEmployee") });
    }
    store.deleteDocumentJob(req.params.jobId, req.user);
    afterEmployeeDocumentDelete(req, res);
  });

  r.post("/werknemers/:id/documenten", employeesWrite, async (req, res) => {
    const werknemer = store.werknemer(req.params.id);
    if (!werknemer) return res.status(404).render("fout", { title: req.t("error.notFound"), message: req.t("error.notFoundEmployee") });
    const recipe = store.recipe(req.body.recipeId);
    const fromList = req.body.from === "list";
    const listBack = nawListPath("/werknemers", { ...req.body, filterFocus: werknemer.id, filterPeekTab: "docs" });
    const fileName = `${(recipe && recipe.name) || "document"}-${werknemer.personeelsnummer || werknemer.naam}.pdf`;
    await generateOwnerDocument(req, res, {
      owner: { werknemerId: werknemer.id },
      data: create.prefillEmployee(werknemer, recipe || {}),
      fileName,
      docsUrl: fromList ? listBack : `/werknemers/${werknemer.id}?tab=documents`,
      backUrl: fromList ? listBack : `/werknemers/${werknemer.id}`,
    });
  });

  r.get("/audit", requireRole("admin"), (req, res) => {
    const { fragment, lazyPending } = listRequest(req);
    if (fragment) res.locals.layout = false;
    res.locals.contentMod = " is-split-list";
    const q = req.query.q || "";
    const group = req.query.group || "";
    const sort = req.query.sort === "entity" ? "entity" : "";
    const groups = AUDIT_ENTITIES.map((id) => ({ id }));
    if (lazyPending) {
      return res.render("audit", {
        title: req.t("nav.audit"),
        items: [],
        q,
        group,
        sort,
        groups,
        focus: "",
        peek: null,
        peekHref: "",
        lazyPending: true,
      });
    }
    const items = store.auditLog(200).filter((item) => {
      const payload = item.payload ? JSON.stringify(item.payload) : "";
      return includesQ(`${item.actor} ${item.action} ${item.entity} ${item.detail} ${payload}`, q) && (!group || item.entity === group);
    }).map((item) => ({ ...item, href: auditEntityHref(item) }));
    items.sort((a, b) => {
      if (sort === "entity") {
        const cmp = String(a.entity || "").localeCompare(String(b.entity || ""));
        if (cmp) return cmp;
      }
      return String(b.at || "").localeCompare(String(a.at || ""));
    });
    let focusId = String(req.query.focus || "");
    if (focusId && !items.some((item) => item.id === focusId)) focusId = "";
    if (!focusId && items[0]) focusId = items[0].id;
    const peek = focusId ? items.find((item) => item.id === focusId) || null : null;
    res.render("audit", {
      title: req.t("nav.audit"),
      items,
      q,
      group,
      sort,
      groups,
      focus: focusId,
      peek,
      peekHref: peek && peek.href ? peek.href : "",
      lazyPending: false,
      ...(fragment ? { layout: false } : {}),
    });
  });

  r.get("/templates", requireRole("admin"), (req, res) => {
    const settings = create.createSettings(store);
    res.render("templates/index", {
      title: req.t("templates.title"),
      recipes: store.recipes(),
      q: req.query.q || "",
      createReady: create.configured(settings),
      lastSyncAt: settings.lastSyncAt,
      lastError: settings.lastError,
    });
  });

  r.post("/templates/sync", requireRole("admin"), async (req, res) => {
    const settings = create.createSettings(store);
    if (!create.configured(settings)) return toastT(req, res, "/templates", "toast.configureFirst");
    try {
      const remote = await create.searchRecipes(settings, { name: String(req.body.name || "").trim() });
      const list = remote.map(create.summarizeRecipe);
      store.replaceRecipes(list, req.user);
      store.patchCreate({ lastSyncAt: new Date().toISOString(), lastError: "" });
      toastT(req, res, "/templates", "toast.synced", { n: list.length });
    } catch (err) {
      store.patchCreate({ lastError: err.message });
      toastT(req, res, "/templates", "toast.syncFail", { msg: err.message });
    }
  });

  r.get("/instellingen", requireRole("admin", "global_admin"), (req, res) => {
    res.render("instellingen/index", { title: req.t("settings.title") });
  });

  r.get("/instellingen/werkruimtes", requireGlobalAdmin, (req, res) => {
    const items = workspaces().map((item) => {
      const tenant = openTenant(item.slug);
      return { ...item, profile: appProfile(tenant.meta()), orgName: tenant.meta().orgName };
    });
    const focusSlug = String(req.query.ws || "");
    res.render("instellingen/werkruimtes", {
      title: req.t("workspace.manage"),
      items,
      focus: items.find((item) => item.slug === focusSlug) || null,
      creating: req.query.nieuw === "1" || !items.length,
      langs: req.app.locals.langs || res.locals.langs,
    });
  });

  r.post("/instellingen/werkruimtes", requireGlobalAdmin, (req, res) => {
    try {
      createWorkspace({
        name: req.body.name,
        slug: req.body.slug,
        defaultLang: req.body.defaultLang || req.lang,
        appProfile: req.body.appProfile,
        seedDemo: leaseFlag(req.body.seedDemo),
        domains: req.body.domains,
        ...workspaceAdminInput(req.body),
      });
      toastT(req, res, "/instellingen/werkruimtes", "workspace.created");
    } catch (err) {
      toast(res, "/instellingen/werkruimtes?nieuw=1", workspaceError(req, err));
    }
  });

  r.post("/instellingen/werkruimtes/:slug", requireGlobalAdmin, (req, res) => {
    const next = `/instellingen/werkruimtes?ws=${encodeURIComponent(req.params.slug)}`;
    try {
      setWorkspaceDomains(req.params.slug, req.body.domains);
      toastT(req, res, next, "workspace.saved");
    } catch (err) {
      toast(res, next, workspaceError(req, err));
    }
  });

  r.post("/instellingen/werkruimtes/:slug/beheerder", requireGlobalAdmin, (req, res) => {
    const next = `/instellingen/werkruimtes?ws=${encodeURIComponent(req.params.slug)}`;
    try {
      addWorkspaceAdmin(req.params.slug, workspaceAdminInput(req.body));
      toastT(req, res, next, "workspace.adminCreated");
    } catch (err) {
      toast(res, next, workspaceError(req, err));
    }
  });

  r.post("/instellingen/werkruimtes/:slug/verwijderen", requireGlobalAdmin, (req, res) => {
    try {
      if (req.params.slug === req.store?.slug) {
        return toastT(req, res, "/instellingen/werkruimtes", "workspace.cannotDeleteCurrent");
      }
      deleteWorkspace(req.params.slug);
      toastT(req, res, "/instellingen/werkruimtes", "workspace.deleted");
    } catch (err) {
      const key = err.message === "Last workspace" ? "workspace.last" : "";
      toast(res, "/instellingen/werkruimtes", key ? req.t(key) : err.message);
    }
  });

  r.get("/instellingen/beheerders", requireGlobalAdmin, (req, res) => {
    res.render("instellingen/beheerders", {
      title: req.t("admins.manage"),
      items: platformUsers().map(publicPlatformUser),
      azureReady: Boolean(req.store) && azure.enabled(azure.azureSettings(req.store)),
    });
  });

  r.post("/instellingen/beheerders/:id/azure-ontkoppelen", requireGlobalAdmin, (req, res) => {
    try {
      if (req.params.id !== req.user?.id) throw new Error(req.t("error.forbiddenMsg"));
      const admin = platformUser(req.params.id);
      if (!admin) throw new Error("Admin not found.");
      savePlatformUser({
        id: admin.id,
        voornaam: admin.voornaam,
        achternaam: admin.achternaam,
        email: admin.email,
        wachtwoord: admin.wachtwoord,
        azureOid: "",
        azureEmail: "",
      });
      toastT(req, res, "/instellingen/beheerders", "toast.azureUnlinked");
    } catch (err) {
      toast(res, "/instellingen/beheerders", adminError(req, err));
    }
  });

  r.post("/instellingen/beheerders", requireGlobalAdmin, (req, res) => {
    try {
      savePlatformUser(adminBody(req));
      toastT(req, res, "/instellingen/beheerders", "admins.created");
    } catch (err) {
      toast(res, "/instellingen/beheerders", adminError(req, err));
    }
  });

  r.post("/instellingen/beheerders/:id", requireGlobalAdmin, (req, res) => {
    try {
      savePlatformUser({ ...adminBody(req), id: req.params.id });
      toastT(req, res, "/instellingen/beheerders", "admins.saved");
    } catch (err) {
      toast(res, "/instellingen/beheerders", adminError(req, err));
    }
  });

  r.post("/instellingen/beheerders/:id/verwijderen", requireGlobalAdmin, (req, res) => {
    try {
      deletePlatformUser(req.params.id, req.user?.id);
      toastT(req, res, "/instellingen/beheerders", "admins.deleted");
    } catch (err) {
      toast(res, "/instellingen/beheerders", adminError(req, err));
    }
  });

  r.get("/instellingen/algemeen", requireRole("admin"), (req, res) => {
    res.render("instellingen/algemeen", { title: req.t("settings.generalTitle"), meta: store.meta() });
  });

  r.post("/instellingen", requireRole("admin"), (req, res) => {
    res.redirect(307, "/instellingen/algemeen");
  });

  r.post("/instellingen/algemeen", requireRole("admin"), (req, res) => {
    const patch = {
      orgName: String(req.body.orgName || "Zaakhub").trim(),
      zaakPrefix: String(req.body.zaakPrefix || "ZH").trim().toUpperCase().slice(0, 6),
      appProfile: appProfile({ appProfile: req.body.appProfile }),
      personeelPrefix: String(req.body.personeelPrefix || "P").trim().toUpperCase().slice(0, 6) || "P",
    };
    if (Object.prototype.hasOwnProperty.call(req.body, "quickStatusChange")) {
      patch.quickStatusChange = leaseFlag(req.body.quickStatusChange);
    }
    store.saveMeta(patch, req.user);
    if (req.store?.slug) updateWorkspace(req.store.slug, { name: patch.orgName });
    toastT(req, res, "/instellingen/algemeen", "toast.settingsSaved");
  });

  r.post("/instellingen/algemeen/demo", requireRole("admin"), (req, res) => {
    const result = store.importDemoRegistry(req.lang, req.user);
    if (!result.companies && !result.persons && !result.cases && !result.types) {
      return toastT(req, res, "/instellingen/algemeen", "toast.demoAlready");
    }
    toastT(req, res, "/instellingen/algemeen", "toast.demoImported", result);
  });

  r.get("/instellingen/zaaktypen", requireRole("admin"), (req, res) => {
    res.render("instellingen/zaaktypen", {
      title: req.t("caseTypes.title"),
      zaaktypen: store.zaaktypen(),
    });
  });

  r.get("/instellingen/zaaktypen/nieuw", requireRole("admin"), (req, res) => {
    res.render("instellingen/zaaktype-form", {
      title: req.t("caseTypes.newTitle"),
      zaaktype: null,
      recipes: store.recipes(),
    });
  });

  r.post("/instellingen/zaaktypen", requireRole("admin"), (req, res) => {
    try {
      store.saveZaaktype(
        {
          naam: req.body.naam,
          leadTimeDays: req.body.leadTimeDays,
          recipeIds: ids(req.body.recipeIds),
        },
        req.user
      );
      toastT(req, res, "/instellingen/zaaktypen", "toast.typeSaved");
    } catch (err) {
      res.status(400).render("instellingen/zaaktype-form", {
        title: req.t("caseTypes.newTitle"),
        zaaktype: req.body,
        recipes: store.recipes(),
        error: formError(req, err),
      });
    }
  });

  r.get("/instellingen/zaaktypen/:id", requireRole("admin"), (req, res) => {
    const zaaktype = store.zaaktype(req.params.id);
    if (!zaaktype) return res.status(404).render("fout", { title: req.t("error.notFound"), message: req.t("caseTypes.notFound") });
    res.render("instellingen/zaaktype-form", {
      title: zaaktype.naam,
      zaaktype,
      recipes: store.recipes(),
    });
  });

  r.post("/instellingen/zaaktypen/:id", requireRole("admin"), (req, res) => {
    try {
      store.saveZaaktype(
        {
          id: req.params.id,
          naam: req.body.naam,
          leadTimeDays: req.body.leadTimeDays,
          recipeIds: ids(req.body.recipeIds),
        },
        req.user
      );
      toastT(req, res, "/instellingen/zaaktypen", "toast.typeSaved");
    } catch (err) {
      res.status(400).render("instellingen/zaaktype-form", {
        title: req.t("caseTypes.editTitle"),
        zaaktype: { ...req.body, id: req.params.id },
        recipes: store.recipes(),
        error: formError(req, err),
      });
    }
  });

  r.post("/instellingen/zaaktypen/:id/verwijderen", requireRole("admin"), (req, res) => {
    store.deleteZaaktype(req.params.id, req.user);
    toastT(req, res, "/instellingen/zaaktypen", "toast.typeDeleted");
  });

  r.get("/instellingen/integraties", requireRole("admin"), (req, res) => {
    const settings = create.createSettings(store);
    const stuf = stufDcr.stufSettings(store);
    const azureCfg = azure.azureSettings(store);
    res.render("instellingen/integraties", {
      title: req.t("integrations.title"),
      create: settings,
      createReady: create.configured(settings),
      createSummary: create.createSummary(settings, req.t),
      stuf,
      stufReady: stufDcr.configured(stuf),
      stufSummary: stufDcr.stufSummary(stuf),
      azure: azureCfg,
      azureReady: azure.configured(azureCfg),
      azureSummary: azure.azureSummary(azureCfg, req.t),
    });
  });

  r.post("/instellingen/integraties/active", requireRole("admin"), (req, res) => {
    store.patchCreate({ active: leaseFlag(req.body.createActive) }, req.user, "Create actief bijgewerkt");
    store.patchStuf({ active: leaseFlag(req.body.stufActive) }, req.user, "StUF-DCR actief bijgewerkt");
    store.patchAzure({ active: leaseFlag(req.body.azureActive) }, req.user, "Azure actief bijgewerkt");
    toastT(req, res, "/instellingen/integraties", "toast.integrationsSaved");
  });

  r.get("/instellingen/integraties/create", requireRole("admin"), (req, res) => {
    const settings = create.createSettings(store);
    const origin = create.publicOrigin(req, settings);
    const wanted = String(req.query.tab || "");
    res.render("instellingen/create", {
      title: req.t("create.title"),
      create: settings,
      createTab: wanted === "webhooks" ? "webhooks" : "connection",
      createReady: create.configured(settings),
      recipeCount: store.recipes().length,
      webhookExample: origin ? `${origin}/api/create/webhook/${settings.slug || "workspace"}/…` : "",
    });
  });

  r.post("/instellingen/create", requireRole("admin"), (req, res) => {
    create.saveCreateSettings(store, req.body, req.user);
    toastT(req, res, "/instellingen/integraties", "toast.createSaved");
  });

  r.post("/instellingen/create/test", requireRole("admin"), async (req, res) => {
    const settings = create.createSettings(store);
    if (!create.configured(settings)) {
      return toastT(req, res, "/instellingen/integraties/create", "toast.fillCreate");
    }
    try {
      const result = await create.testConnection(settings);
      store.patchCreate({ lastError: "" });
      toastT(req, res, "/instellingen/integraties/create", "toast.testOk", { n: result.recipes });
    } catch (err) {
      store.patchCreate({ lastError: err.message });
      toastT(req, res, "/instellingen/integraties/create", "toast.testFail", { msg: err.message });
    }
  });

  r.get("/instellingen/integraties/stuf-dcr", requireRole("admin"), (req, res) => {
    const stuf = stufDcr.stufSettings(store);
    const wanted = String(req.query.tab || "");
    res.render("instellingen/stuf-dcr", {
      title: req.t("stuf.title"),
      stuf,
      stufTab: wanted === "identity" || wanted === "certs" ? wanted : "connection",
      stufReady: stufDcr.configured(stuf),
      stufCallback: stufDcr.publicCallbackUrl(stufDcr.publicOrigin(req, store), stuf.slug),
    });
  });

  r.post(
    "/instellingen/stuf-dcr",
    requireRole("admin"),
    certUpload.fields([
      { name: "inboundCertFile", maxCount: 1 },
      { name: "outboundCertFile", maxCount: 1 },
    ]),
    (req, res) => {
      try {
        stufDcr.saveStufSettings(req.store, req.body, req.user, req.files || {});
        toastT(req, res, "/instellingen/integraties", "toast.stufSaved");
      } catch (err) {
        toastT(req, res, "/instellingen/integraties/stuf-dcr?tab=certs", "toast.stufCertFail", { msg: err.message });
      }
    }
  );

  r.get("/instellingen/integraties/azure", requireRole("admin"), (req, res) => {
    const settings = azure.azureSettings(store);
    res.render("instellingen/azure", {
      title: req.t("azure.title"),
      azure: settings,
      azureReady: azure.configured(settings),
      redirectUri: azure.redirectUri(req, store),
    });
  });

  r.post("/instellingen/azure", requireRole("admin"), (req, res) => {
    azure.saveAzureSettings(store, req.body, req.user);
    toastT(req, res, "/instellingen/integraties", "toast.azureSaved");
  });

  return r;
}

module.exports = { routes };
