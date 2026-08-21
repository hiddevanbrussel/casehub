const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { store } = require("../lib/db");
const { verifyPassword } = require("../lib/crypto");
const { STATUSSEN, PRIORITEITEN, ROLLEN, OVERVIEW_GROUPS, PERSON_GROUPS, COMPANY_GROUPS, parseView, includesQ, slugFile } = require("../lib/format");
const { requireAuth, requireRole, setSessionCookie, clearSessionCookie, canWriteMaster } = require("../lib/auth");
const config = require("../config");
const create = require("../lib/create");
const azure = require("../lib/azure");
const { setLangCookie } = require("../lib/i18n");
const { appProfile, isHr, isCases } = require("../lib/profile");

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      const dir = path.join(config.dataDir, "uploads");
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (_req, file, cb) => {
      cb(null, `${Date.now()}-${slugFile(file.originalname)}`);
    },
  }),
  limits: { fileSize: 25 * 1024 * 1024 },
});

function toast(res, path, message) {
  const sep = String(path).includes("?") ? "&" : "?";
  res.redirect(`${path}${sep}toast=${encodeURIComponent(message)}`);
}

function toastT(req, res, path, key, vars) {
  toast(res, path, req.t(key, vars));
}

function formError(req, err) {
  if (err.message === "Name is required.") return req.t("validation.nameRequired");
  if (err.message === "A password is required for a new employee.") return req.t("validation.passwordRequired");
  return err.message;
}

function withModal(req, data) {
  const modal = req.query.modal === "1";
  return { ...data, modal, layout: modal ? false : "layout" };
}

function ids(value) {
  if (!value) return [];
  return Array.isArray(value) ? value.filter(Boolean) : [value];
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

async function generateOwnerDocument(req, res, { owner, data, fileName, docsUrl, backUrl }) {
  const recipe = store.recipe(req.body.recipeId);
  if (!recipe) return toastT(req, res, backUrl, "toast.pickTemplate");
  const settings = create.createSettings(store);
  if (!create.enabled(settings)) return toastT(req, res, backUrl, "toast.createOff");
  const interactive = String(req.body.mode || "") === "interactive";
  const job = store.addDocumentJob(
    {
      zaakId: owner.zaakId || "",
      werknemerId: owner.werknemerId || "",
      recipeId: recipe.itemId,
      recipeName: recipe.name,
      status: interactive ? "prepared" : "generating",
    },
    req.user
  );
  try {
    if (interactive) {
      const webhookUrl = create.webhookUrlFor(settings, job);
      const prepared = await create.prepareGenerate(settings, {
        recipeId: recipe.itemId,
        data,
        webhookUrl,
        webhookHeaders: webhookUrl ? { "X-Zaakhub-Token": job.token } : undefined,
      });
      store.updateDocumentJob(
        job.id,
        { finalizeUrl: prepared.finalizeUrl || "", expiresAtUtc: prepared.expiresAtUtc || "" },
        req.user
      );
      if (prepared.finalizeUrl) return res.redirect(create.withAuthDomain(prepared.finalizeUrl, settings));
      return toastT(req, res, docsUrl, "toast.noFinalize");
    }
    const generated = await create.generateDocument(settings, {
      recipeId: recipe.itemId,
      values: data,
      fileName,
      mimeType: "application/pdf",
    });
    const fileUri = generated?.fileUri || generated?.url || "";
    if (!fileUri) {
      store.updateDocumentJob(job.id, { status: "error", error: "No fileUri" }, req.user);
      return toastT(req, res, docsUrl, "toast.noFileUri");
    }
    const file = await create.fetchGeneratedFile(settings, fileUri);
    if (!file) {
      store.updateDocumentJob(job.id, { status: "error", documentUrl: fileUri, error: "Download failed" }, req.user);
      return toastT(req, res, docsUrl, "toast.noFileUri");
    }
    if (generated.contentType && (!file.mime || file.mime === "application/octet-stream")) file.mime = generated.contentType;
    if (!file.mime || file.mime === "application/octet-stream") file.mime = "application/pdf";
    if (!file.naam || file.naam === "document") file.naam = fileName;
    const bijlage = store.addBijlage(owner, create.saveGeneratedFile(file), req.user);
    store.updateDocumentJob(job.id, { status: "success", documentUrl: fileUri, bijlageId: bijlage.id }, req.user);
    toastT(req, res, docsUrl, "toast.documentGenerated");
  } catch (err) {
    store.updateDocumentJob(job.id, { status: "error", error: err.message }, req.user);
    store.patchCreate({ lastError: err.message });
    toast(res, docsUrl, `Create: ${err.message}`);
  }
}

const SETUP_STEPS = ["org", "profile", "admin", "create", "azure"];

function allowedSetupStep(requested) {
  const current = store.setupStep();
  const curIdx = Math.max(0, SETUP_STEPS.indexOf(current));
  const reqIdx = SETUP_STEPS.indexOf(requested);
  if (reqIdx < 0) return current || "org";
  if (reqIdx > curIdx) return current || "org";
  return requested;
}

function finishSetup(res) {
  const admin = store.werknemers().find((w) => w.rol === "admin") || store.werknemers()[0];
  store.completeOnboarding(admin);
  if (admin) setSessionCookie(res, admin.id);
  res.redirect("/");
}

function renderSetup(req, res, step, extra = {}) {
  const createCfg = create.createSettings(store);
  const azureCfg = azure.azureSettings(store);
  const admin = store.werknemers().find((w) => w.rol === "admin");
  const defaults = {
    org: { orgName: store.meta().orgName, zaakPrefix: store.meta().zaakPrefix },
    profile: { appProfile: appProfile(store.meta()), personeelPrefix: store.meta().personeelPrefix || "P" },
    admin: admin ? { voornaam: admin.voornaam, achternaam: admin.achternaam, email: admin.email } : {},
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
    step,
    steps: SETUP_STEPS,
    stepIndex: Math.max(0, SETUP_STEPS.indexOf(step)),
    error: extra.error || "",
    values: extra.values || defaults[step] || {},
    redirectUri: azure.redirectUri(req, store),
  });
}

function routes() {
  const r = express.Router();

  r.use((req, res, next) => {
    if (!store.needsOnboarding()) return next();
    if (req.path === "/setup" || req.path === "/lang" || req.path === "/api/health") return next();
    if (req.path.startsWith("/auth/azure")) return next();
    return res.redirect("/setup");
  });

  r.get("/login", (req, res) => {
    if (req.user || require("../lib/auth").currentUser(req)) return res.redirect("/");
    const azureCfg = azure.azureSettings(store);
    res.render("login", {
      title: req.t("login.title"),
      layout: false,
      error: req.query.error,
      next: req.query.next || "/",
      azureReady: azure.enabled(azureCfg),
      showDemo: Boolean(store.werknemerByEmail("admin@zaakhub.local")),
    });
  });

  r.post("/login", (req, res) => {
    const email = String(req.body.email || "").trim();
    const password = String(req.body.password || "");
    const nextUrl = req.body.next && String(req.body.next).startsWith("/") ? req.body.next : "/";
    const row = store.werknemerByEmail(email);
    if (!row || !verifyPassword(password, row.wachtwoord)) {
      const azureCfg = azure.azureSettings(store);
      return res.status(401).render("login", {
        title: req.t("login.title"),
        layout: false,
        error: req.t("login.error"),
        next: nextUrl,
        azureReady: azure.enabled(azureCfg),
        showDemo: Boolean(store.werknemerByEmail("admin@zaakhub.local")),
      });
    }
    setSessionCookie(res, row.id);
    res.redirect(nextUrl);
  });

  r.post("/logout", requireAuth, (_req, res) => {
    clearSessionCookie(res);
    res.redirect("/login");
  });

  r.post("/lang", (req, res) => {
    setLangCookie(res, req.body.lang);
    const nextUrl = req.body.next && String(req.body.next).startsWith("/") ? req.body.next : "/";
    res.redirect(nextUrl.split("?")[0] === "/login" ? nextUrl : nextUrl);
  });

  r.get("/api/health", (_req, res) => {
    const counts = store.counts();
    res.json({ ok: true, service: "zaakhub", counts });
  });

  r.post("/api/create/webhook/:jobId", async (req, res) => {
    try {
      const job = store.documentJob(req.params.jobId);
      if (!job) return res.status(404).json({ ok: false });
      const headerToken = req.get("x-zaakhub-token") || String(req.query.token || "");
      if (job.token && headerToken !== job.token) return res.status(401).json({ ok: false });

      const body = req.body || {};
      const fileUrl = body.url || body.fileUri || "";
      const failed = Boolean(body.error) || /error|fail/i.test(String(body.status || ""));
      const patch = {
        status: failed ? "error" : "success",
        documentGenerationId: body.documentGenerationId || "",
        documentUrl: fileUrl,
        error: failed ? JSON.stringify(body.error || body.status || "Genereren mislukt") : "",
      };

      if (!failed && fileUrl) {
        try {
          const settings = create.createSettings(store);
          const file = await create.fetchGeneratedFile(settings, fileUrl);
          if (file) {
            const bijlage = store.addBijlage(
              { zaakId: job.zaakId, werknemerId: job.werknemerId },
              create.saveGeneratedFile(file),
              null
            );
            patch.bijlageId = bijlage.id;
          }
        } catch (err) {
          patch.error = err.message;
        }
      }

      store.updateDocumentJob(job.id, patch, null);
      res.json({ ok: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ ok: false });
    }
  });

  r.get("/setup", (req, res) => {
    if (!store.needsOnboarding()) return res.redirect("/");
    renderSetup(req, res, allowedSetupStep(req.query.step));
  });

  r.post("/setup", (req, res) => {
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
        store.saveWerknemer(
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
      return finishSetup(res);
    }

    res.redirect("/setup");
  });

  r.get("/auth/azure", (req, res) => {
    const settings = azure.azureSettings(store);
    if (!azure.enabled(settings)) return res.redirect("/login");
    const state = crypto.randomBytes(24).toString("hex");
    res.cookie("zaakhub_azure", state, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.COOKIE_SECURE === "true",
      maxAge: 10 * 60 * 1000,
    });
    res.redirect(azure.authorizeUrl(settings, { state, redirectUri: azure.redirectUri(req, store) }));
  });

  r.get("/auth/azure/callback", async (req, res) => {
    try {
      if (req.query.error) throw new Error(String(req.query.error_description || req.query.error));
      const expected = req.cookies?.zaakhub_azure || "";
      res.clearCookie("zaakhub_azure");
      if (!expected || expected !== String(req.query.state || "")) {
        throw new Error(req.t("login.error"));
      }
      const settings = azure.azureSettings(store);
      if (!azure.enabled(settings)) throw new Error(req.t("common.notConfigured"));
      const tokens = await azure.exchangeCode(settings, {
        code: String(req.query.code || ""),
        redirectUri: azure.redirectUri(req, store),
      });
      const profile = await azure.fetchProfile(tokens.access_token);
      const user = azure.findOrCreateAzureUser(store, profile);
      store.patchAzure({ lastError: "" });
      setSessionCookie(res, user.id);
      const nextUrl = req.query.next && String(req.query.next).startsWith("/") ? req.query.next : "/";
      res.redirect(nextUrl);
    } catch (err) {
      store.patchAzure({ lastError: err.message });
      res.redirect(`/login?error=${encodeURIComponent(err.message)}`);
    }
  });

  r.use(requireAuth);

  r.use((req, res, next) => {
    if (isCases(store.meta())) return next();
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

  r.get("/", (req, res) => {
    res.render("dashboard", {
      title: req.t("dash.title"),
      counts: store.counts(),
      zaken: store.recentZaken(),
      overdue: store.overdueZaken(),
      documenten: store.recentBijlagen(),
      werknemers: store.werknemers().slice(0, 8),
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
    res.render("cases/index", {
      title: req.t("cases.overview"),
      zaken: store.zaken({ q: req.query.q, status: req.query.status }),
      q: req.query.q || "",
      status: req.query.status || "",
      view: parseView(req.query.view),
      groups: OVERVIEW_GROUPS,
      statussen: STATUSSEN,
    });
  });

  r.get("/zaken/nieuw", (req, res) => {
    res.render("cases/form", withModal(req, {
      title: req.t("cases.new"),
      zaak: null,
      statussen: STATUSSEN,
      prioriteiten: PRIORITEITEN,
      bedrijven: store.bedrijven(),
      personen: store.personen(),
      werknemers: store.werknemers(),
      zaaktypen: store.zaaktypen(),
    }));
  });

  r.post("/zaken", (req, res) => {
    const zaak = store.saveZaak(
      {
        titel: req.body.titel,
        omschrijving: req.body.omschrijving,
        zaaktypeId: req.body.zaaktypeId,
        referentie: req.body.referentie,
        voortgang: req.body.voortgang,
        status: req.body.status,
        prioriteit: req.body.prioriteit,
        deadline: req.body.deadline,
        behandelaarId: req.body.behandelaarId,
        bedrijfIds: ids(req.body.bedrijfIds),
        persoonIds: ids(req.body.persoonIds),
      },
      req.user
    );
    toastT(req, res, `/zaken/${zaak.id}`, "toast.caseCreated");
  });

  r.get("/zaken/:id", (req, res) => {
    const zaak = store.zaak(req.params.id);
    if (!zaak) return res.status(404).render("fout", { title: req.t("error.notFound"), message: req.t("error.notFoundCase") });
    const allRecipes = store.recipes().filter((recipe) => !recipe.hideFromUserView);
    const type = zaak.zaaktypeId ? store.zaaktype(zaak.zaaktypeId) : null;
    const recipes = type?.recipeIds?.length
      ? allRecipes.filter((recipe) => type.recipeIds.includes(recipe.itemId))
      : allRecipes;
    const settings = create.createSettings(store);
    res.render("cases/show", {
      title: zaak.titel || zaak.zaaknummer,
      zaak: {
        ...zaak,
        documentJobs: (zaak.documentJobs || []).map((job) => ({
          ...job,
          finalizeUrl: create.withAuthDomain(job.finalizeUrl, settings),
        })),
      },
      recipes,
      templatesLinked: Boolean(type?.recipeIds?.length),
      createReady: create.enabled(settings),
      tab: req.query.tab === "documents" ? "documents" : "details",
    });
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
    store.saveZaak(
      {
        id: req.params.id,
        titel: req.body.titel,
        omschrijving: req.body.omschrijving,
        zaaktypeId: req.body.zaaktypeId,
        referentie: req.body.referentie,
        voortgang: req.body.voortgang,
        status: req.body.status,
        prioriteit: req.body.prioriteit,
        deadline: req.body.deadline,
        behandelaarId: req.body.behandelaarId,
        bedrijfIds: ids(req.body.bedrijfIds),
        persoonIds: ids(req.body.persoonIds),
      },
      req.user
    );
    toastT(req, res, `/zaken/${req.params.id}`, "toast.caseSaved");
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
    const filePath = path.join(config.dataDir, "uploads", bijlage.stored);
    const isPdf = /pdf/i.test(bijlage.mime || "") || /\.pdf$/i.test(bijlage.naam || "");
    if (req.query.download === "1" || !isPdf) {
      return res.download(filePath, bijlage.naam);
    }
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(bijlage.naam)}`);
    res.sendFile(path.resolve(filePath));
  });

  r.post("/zaken/:id/bijlagen/:bijlageId/verwijderen", (req, res) => {
    const bijlage = store.bijlage(req.params.bijlageId);
    if (!bijlage || bijlage.zaakId !== req.params.id) {
      return res.status(404).render("fout", { title: req.t("error.notFound"), message: req.t("error.notFoundCase") });
    }
    store.deleteBijlage(req.params.bijlageId, req.user);
    toastT(req, res, `/zaken/${req.params.id}?tab=documents`, "toast.attachmentDeleted");
  });

  r.post("/zaken/:id/documenten/:jobId/verwijderen", (req, res) => {
    const job = store.documentJob(req.params.jobId);
    if (!job || job.zaakId !== req.params.id) {
      return res.status(404).render("fout", { title: req.t("error.notFound"), message: req.t("error.notFoundCase") });
    }
    store.deleteDocumentJob(req.params.jobId, req.user);
    toastT(req, res, `/zaken/${req.params.id}?tab=documents`, "toast.attachmentDeleted");
  });

  r.post("/zaken/:id/documenten", async (req, res) => {
    const zaak = store.zaak(req.params.id);
    if (!zaak) return res.status(404).render("fout", { title: req.t("error.notFound"), message: req.t("error.notFoundCase") });
    const recipe = store.recipe(req.body.recipeId);
    if (!recipe) return toastT(req, res, `/zaken/${req.params.id}`, "toast.pickTemplate");
    const settings = create.createSettings(store);
    if (!create.enabled(settings)) {
      return toastT(req, res, `/zaken/${req.params.id}`, "toast.createOff");
    }
    const interactive = String(req.body.mode || "") === "interactive";
    const docsUrl = `/zaken/${zaak.id}?tab=documents`;
    const job = store.addDocumentJob(
      {
        zaakId: zaak.id,
        recipeId: recipe.itemId,
        recipeName: recipe.name,
        status: interactive ? "prepared" : "generating",
      },
      req.user
    );
    try {
      if (interactive) {
        const webhookUrl = create.webhookUrlFor(settings, job);
        const prepared = await create.prepareGenerate(settings, {
          recipeId: recipe.itemId,
          data: create.prefillData(zaak, recipe),
          webhookUrl,
          webhookHeaders: webhookUrl ? { "X-Zaakhub-Token": job.token } : undefined,
        });
        store.updateDocumentJob(
          job.id,
          { finalizeUrl: prepared.finalizeUrl || "", expiresAtUtc: prepared.expiresAtUtc || "" },
          req.user
        );
        if (prepared.finalizeUrl) return res.redirect(create.withAuthDomain(prepared.finalizeUrl, settings));
        return toastT(req, res, docsUrl, "toast.noFinalize");
      }

      const generated = await create.generateDocument(settings, {
        recipeId: recipe.itemId,
        values: create.prefillData(zaak, recipe),
        fileName: `${recipe.name}-${zaak.zaaknummer}.pdf`,
        mimeType: "application/pdf",
      });
      const fileUri = generated?.fileUri || generated?.url || "";
      if (!fileUri) {
        store.updateDocumentJob(job.id, { status: "error", error: "No fileUri" }, req.user);
        return toastT(req, res, docsUrl, "toast.noFileUri");
      }
      const file = await create.fetchGeneratedFile(settings, fileUri);
      if (!file) {
        store.updateDocumentJob(job.id, { status: "error", documentUrl: fileUri, error: "Download failed" }, req.user);
        return toastT(req, res, docsUrl, "toast.noFileUri");
      }
      if (generated.contentType && (!file.mime || file.mime === "application/octet-stream")) {
        file.mime = generated.contentType;
      }
      if (!file.mime || file.mime === "application/octet-stream") file.mime = "application/pdf";
      if (!file.naam || file.naam === "document") {
        file.naam = `${recipe.name}-${zaak.zaaknummer}.pdf`;
      }
      const bijlage = store.addBijlage(zaak.id, create.saveGeneratedFile(file), req.user);
      store.updateDocumentJob(
        job.id,
        { status: "success", documentUrl: fileUri, bijlageId: bijlage.id },
        req.user
      );
      toastT(req, res, docsUrl, "toast.documentGenerated");
    } catch (err) {
      store.updateDocumentJob(job.id, { status: "error", error: err.message }, req.user);
      store.patchCreate({ lastError: err.message });
      toast(res, docsUrl, `Create: ${err.message}`);
    }
  });

  r.get("/bedrijven", (req, res) => {
    res.render("bedrijven/index", {
      title: req.t("companies.overview"),
      bedrijven: store.bedrijven(req.query.q, req.query.group),
      q: req.query.q || "",
      group: req.query.group || "",
      view: parseView(req.query.view),
      groups: COMPANY_GROUPS,
      canWrite: canWriteMaster(req.user),
    });
  });

  r.get("/bedrijven/nieuw", requireRole("admin", "zaakmanager"), (req, res) => {
    res.render("bedrijven/form", withModal(req, { title: req.t("companies.new"), bedrijf: null }));
  });

  r.post("/bedrijven", requireRole("admin", "zaakmanager"), (req, res) => {
    const row = store.saveBedrijf(req.body, req.user);
    toastT(req, res, `/bedrijven/${row.id}`, "toast.companySaved");
  });

  r.get("/bedrijven/:id", (req, res) => {
    const bedrijf = store.bedrijf(req.params.id);
    if (!bedrijf) return res.status(404).render("fout", { title: req.t("error.notFound"), message: req.t("error.notFoundCompany") });
    const zaken = store.zaken({}).filter((z) => z.bedrijfIds.includes(bedrijf.id));
    res.render("bedrijven/show", {
      title: bedrijf.handelsnaam,
      bedrijf,
      zaken,
      canWrite: canWriteMaster(req.user),
    });
  });

  r.get("/bedrijven/:id/bewerken", requireRole("admin", "zaakmanager"), (req, res) => {
    const bedrijf = store.bedrijf(req.params.id);
    if (!bedrijf) return res.status(404).render("fout", { title: req.t("error.notFound"), message: req.t("error.notFoundCompany") });
    res.render("bedrijven/form", withModal(req, { title: req.t("companies.edit"), bedrijf }));
  });

  r.post("/bedrijven/:id", requireRole("admin", "zaakmanager"), (req, res) => {
    store.saveBedrijf({ ...req.body, id: req.params.id }, req.user);
    toastT(req, res, `/bedrijven/${req.params.id}`, "toast.companySaved");
  });

  r.post("/bedrijven/:id/verwijderen", requireRole("admin", "zaakmanager"), (req, res) => {
    store.deleteBedrijf(req.params.id, req.user);
    toastT(req, res, "/bedrijven", "toast.companyDeleted");
  });

  r.get("/personen", (req, res) => {
    res.render("personen/index", {
      title: req.t("persons.overview"),
      personen: store.personen(req.query.q, req.query.group),
      q: req.query.q || "",
      group: req.query.group || "",
      view: parseView(req.query.view),
      groups: PERSON_GROUPS,
      canWrite: canWriteMaster(req.user),
    });
  });

  r.get("/personen/nieuw", requireRole("admin", "zaakmanager"), (req, res) => {
    res.render("personen/form", withModal(req, { title: req.t("persons.new"), persoon: null, bedrijven: store.bedrijven() }));
  });

  r.post("/personen", requireRole("admin", "zaakmanager"), (req, res) => {
    const row = store.savePersoon(req.body, req.user);
    toastT(req, res, `/personen/${row.id}`, "toast.personSaved");
  });

  r.get("/personen/:id", (req, res) => {
    const showBsn = req.query.bsn === "1" && req.user.rol === "admin";
    if (showBsn) store.log(req.user, "bsn-inzage", "persoon", req.params.id, "BSN getoond");
    const persoon = store.persoon(req.params.id, { showBsn });
    if (!persoon) return res.status(404).render("fout", { title: req.t("error.notFound"), message: req.t("error.notFoundPerson") });
    const zaken = store.zaken({}).filter((z) => z.persoonIds.includes(persoon.id));
    res.render("personen/show", {
      title: persoon.naam,
      persoon,
      zaken,
      canWrite: canWriteMaster(req.user),
      showBsn,
      tab: req.query.tab === "cases" ? "cases" : "details",
    });
  });

  r.get("/personen/:id/bewerken", requireRole("admin", "zaakmanager"), (req, res) => {
    const persoon = store.persoon(req.params.id);
    if (!persoon) return res.status(404).render("fout", { title: req.t("error.notFound"), message: req.t("error.notFoundPerson") });
    res.render("personen/form", withModal(req, { title: req.t("persons.edit"), persoon, bedrijven: store.bedrijven() }));
  });

  r.post("/personen/:id", requireRole("admin", "zaakmanager"), (req, res) => {
    store.savePersoon({ ...req.body, id: req.params.id }, req.user);
    toastT(req, res, `/personen/${req.params.id}`, "toast.personSaved");
  });

  r.post("/personen/:id/anonimiseren", requireRole("admin", "zaakmanager"), (req, res) => {
    store.anonymizePersoon(req.params.id, req.user);
    toastT(req, res, `/personen/${req.params.id}`, "toast.personAnon");
  });

  r.post("/personen/:id/verwijderen", requireRole("admin"), (req, res) => {
    store.deletePersoon(req.params.id, req.user);
    toastT(req, res, "/personen", "toast.personDeleted");
  });

  r.get("/werknemers", employeesRead, (req, res) => {
    const q = req.query.q || "";
    const group = req.query.group || "";
    const werknemers = store.werknemers().filter((w) =>
      includesQ(`${w.naam} ${w.email} ${w.afdeling} ${w.personeelsnummer} ${w.functiebenaming} ${w.vestiging}`, q) && (!group || w.rol === group)
    );
    res.render("werknemers/index", {
      title: req.t("employees.overview"),
      werknemers,
      q,
      group,
      view: parseView(req.query.view),
      groups: ROLLEN,
      canWrite: isHr(store.meta()) ? canWriteMaster(req.user) : req.user.rol === "admin",
    });
  });

  r.get("/werknemers/nieuw", employeesWrite, (req, res) => {
    res.render("werknemers/form", withModal(req, { title: req.t("employees.new"), werknemer: null, rollen: ROLLEN }));
  });

  r.post("/werknemers", employeesWrite, (req, res) => {
    try {
      const row = store.saveWerknemer(employeeBody(req), req.user);
      toastT(req, res, `/werknemers/${row.id}`, "toast.employeeSaved");
    } catch (err) {
      res.status(400).render("werknemers/form", {
        title: req.t("employees.new"),
        werknemer: req.body,
        rollen: ROLLEN,
        error: formError(req, err),
      });
    }
  });

  r.get("/werknemers/:id", employeesRead, (req, res) => {
    const werknemer = store.werknemer(req.params.id);
    if (!werknemer) return res.status(404).render("fout", { title: req.t("error.notFound"), message: req.t("error.notFoundEmployee") });
    const settings = create.createSettings(store);
    const zaken = isCases(store.meta())
      ? store.zaken({}).filter((z) => z.behandelaarId === werknemer.id)
      : [];
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
      createReady: create.enabled(settings),
      tab: req.query.tab === "documents" ? "documents" : "details",
      canWrite: isHr(store.meta()) ? canWriteMaster(req.user) : req.user.rol === "admin",
    });
  });

  r.get("/werknemers/:id/bewerken", employeesWrite, (req, res) => {
    const werknemer = store.werknemer(req.params.id);
    if (!werknemer) return res.status(404).render("fout", { title: req.t("error.notFound"), message: req.t("error.notFoundEmployee") });
    res.render("werknemers/form", withModal(req, { title: req.t("employees.edit"), werknemer, rollen: ROLLEN }));
  });

  r.post("/werknemers/:id", employeesWrite, (req, res) => {
    try {
      store.saveWerknemer({ ...employeeBody(req), id: req.params.id }, req.user);
      toastT(req, res, `/werknemers/${req.params.id}`, "toast.employeeSaved");
    } catch (err) {
      const werknemer = { ...store.werknemer(req.params.id), ...req.body, id: req.params.id };
      res.status(400).render("werknemers/form", {
        title: req.t("employees.edit"),
        werknemer,
        rollen: ROLLEN,
        error: formError(req, err),
      });
    }
  });

  r.post("/werknemers/:id/verwijderen", employeesWrite, (req, res) => {
    if (req.params.id === req.user.id) return toastT(req, res, "/werknemers", "toast.cannotDeleteSelf");
    store.deleteWerknemer(req.params.id, req.user);
    toastT(req, res, "/werknemers", "toast.employeeDeleted");
  });

  r.get("/werknemers/:id/bijlagen/:bijlageId", employeesRead, (req, res) => {
    const bijlage = store.bijlage(req.params.bijlageId);
    if (!bijlage || bijlage.werknemerId !== req.params.id) return res.status(404).send(req.t("error.notFound"));
    const filePath = path.join(config.dataDir, "uploads", bijlage.stored);
    const isPdf = /pdf/i.test(bijlage.mime || "") || /\.pdf$/i.test(bijlage.naam || "");
    if (req.query.download === "1" || !isPdf) {
      return res.download(filePath, bijlage.naam);
    }
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(bijlage.naam)}`);
    res.sendFile(path.resolve(filePath));
  });

  r.post("/werknemers/:id/bijlagen/:bijlageId/verwijderen", employeesWrite, (req, res) => {
    const bijlage = store.bijlage(req.params.bijlageId);
    if (!bijlage || bijlage.werknemerId !== req.params.id) {
      return res.status(404).render("fout", { title: req.t("error.notFound"), message: req.t("error.notFoundEmployee") });
    }
    store.deleteBijlage(req.params.bijlageId, req.user);
    toastT(req, res, `/werknemers/${req.params.id}?tab=documents`, "toast.attachmentDeleted");
  });

  r.post("/werknemers/:id/documenten/:jobId/verwijderen", employeesWrite, (req, res) => {
    const job = store.documentJob(req.params.jobId);
    if (!job || job.werknemerId !== req.params.id) {
      return res.status(404).render("fout", { title: req.t("error.notFound"), message: req.t("error.notFoundEmployee") });
    }
    store.deleteDocumentJob(req.params.jobId, req.user);
    toastT(req, res, `/werknemers/${req.params.id}?tab=documents`, "toast.attachmentDeleted");
  });

  r.post("/werknemers/:id/documenten", employeesWrite, async (req, res) => {
    const werknemer = store.werknemer(req.params.id);
    if (!werknemer) return res.status(404).render("fout", { title: req.t("error.notFound"), message: req.t("error.notFoundEmployee") });
    const recipe = store.recipe(req.body.recipeId);
    const fileName = `${(recipe && recipe.name) || "document"}-${werknemer.personeelsnummer || werknemer.naam}.pdf`;
    await generateOwnerDocument(req, res, {
      owner: { werknemerId: werknemer.id },
      data: create.prefillEmployee(werknemer, recipe || {}),
      fileName,
      docsUrl: `/werknemers/${werknemer.id}?tab=documents`,
      backUrl: `/werknemers/${werknemer.id}`,
    });
  });

  r.get("/audit", requireRole("admin"), (req, res) => {
    const q = req.query.q || "";
    const group = req.query.group || "";
    const groups = ["zaak", "persoon", "bedrijf", "werknemer", "instellingen", "zaaktype", "recipe", "document"].map((id) => ({ id }));
    const items = store.auditLog().filter((item) => includesQ(`${item.actor} ${item.action} ${item.entity} ${item.detail}`, q) && (!group || item.entity === group));
    res.render("audit", {
      title: req.t("audit.overview"),
      items,
      q,
      group,
      view: parseView(req.query.view),
      groups,
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

  r.get("/instellingen", requireRole("admin"), (req, res) => {
    res.render("instellingen/index", { title: req.t("settings.title") });
  });

  r.get("/instellingen/algemeen", requireRole("admin"), (req, res) => {
    res.render("instellingen/algemeen", { title: req.t("settings.generalTitle"), meta: store.meta() });
  });

  r.post("/instellingen", requireRole("admin"), (req, res) => {
    res.redirect(307, "/instellingen/algemeen");
  });

  r.post("/instellingen/algemeen", requireRole("admin"), (req, res) => {
    store.saveMeta(
      {
        orgName: String(req.body.orgName || "Zaakhub").trim(),
        zaakPrefix: String(req.body.zaakPrefix || "ZH").trim().toUpperCase().slice(0, 6),
        appProfile: appProfile({ appProfile: req.body.appProfile }),
        personeelPrefix: String(req.body.personeelPrefix || "P").trim().toUpperCase().slice(0, 6) || "P",
      },
      req.user
    );
    toastT(req, res, "/instellingen/algemeen", "toast.settingsSaved");
  });

  r.post("/instellingen/algemeen/demo", requireRole("admin"), (req, res) => {
    const result = store.importDemoRegistry(req.lang, req.user);
    if (!result.companies && !result.persons) {
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
    const azureCfg = azure.azureSettings(store);
    res.render("instellingen/integraties", {
      title: req.t("integrations.title"),
      create: settings,
      createReady: create.configured(settings),
      createSummary: create.createSummary(settings, req.t),
      azure: azureCfg,
      azureReady: azure.configured(azureCfg),
      azureSummary: azure.azureSummary(azureCfg, req.t),
    });
  });

  r.post("/instellingen/integraties/active", requireRole("admin"), (req, res) => {
    store.patchCreate({ active: req.body.createActive === "1" }, req.user, "Create actief bijgewerkt");
    store.patchAzure({ active: req.body.azureActive === "1" }, req.user, "Azure actief bijgewerkt");
    toastT(req, res, "/instellingen/integraties", "toast.integrationsSaved");
  });

  r.get("/instellingen/integraties/create", requireRole("admin"), (req, res) => {
    const settings = create.createSettings(store);
    res.render("instellingen/create", {
      title: req.t("create.title"),
      create: settings,
      createReady: create.configured(settings),
      recipeCount: store.recipes().length,
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
