const fs = require("fs");
const path = require("path");
const config = require("../config");
const { encrypt, decrypt } = require("./crypto");
const { slugFile } = require("./format");

const tokenCache = new Map();

function tokenKey(settings) {
  return `${settings.baseUrl}|${settings.clientId}|${settings.unitId}`;
}

function stripSlash(url) {
  return String(url || "").replace(/\/+$/, "");
}

function normalizeKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function createSettings(store) {
  const meta = store.meta().create || {};
  return {
    slug: store.slug || "",
    baseUrl: stripSlash(meta.baseUrl || process.env.CREATE_BASE_URL || "https://app.omnidocs.cloud"),
    clientId: meta.clientId || process.env.CREATE_CLIENT_ID || "",
    clientSecret: decrypt(meta.clientSecretEnc || "") || process.env.CREATE_CLIENT_SECRET || "",
    unitId: meta.unitId || process.env.CREATE_UNIT_ID || "",
    contentSourceId: meta.contentSourceId || process.env.CREATE_CONTENT_SOURCE_ID || "",
    publicBaseUrl: stripSlash(meta.publicBaseUrl || process.env.PUBLIC_BASE_URL || ""),
    authDomain: String(meta.authDomain || process.env.CREATE_AUTH_DOMAIN || "").trim(),
    lastSyncAt: meta.lastSyncAt || "",
    lastError: meta.lastError || "",
    hasSecret: Boolean(meta.clientSecretEnc || process.env.CREATE_CLIENT_SECRET),
    active: meta.active !== false,
  };
}

function configured(settings) {
  return Boolean(settings.baseUrl && settings.clientId && settings.clientSecret && settings.unitId && settings.contentSourceId);
}

function enabled(settings) {
  return configured(settings) && settings.active !== false;
}

function createSummary(settings, translate) {
  const label = typeof translate === "function"
    ? translate
    : ((key) => ({ "create.clientConfigured": "Client configured", "create.clientMissing": "Client missing" }[key] || key));
  if (!configured(settings)) return "—";
  const host = settings.baseUrl.replace(/^https?:\/\//, "");
  if (settings.hasSecret || settings.clientId) return host;
  return `${host} · ${label("create.clientMissing")}`;
}

function saveCreateSettings(store, input, actor) {
  const current = store.meta().create || {};
  const nextSecret = String(input.clientSecret || "").trim();
  store.patchCreate(
    {
      baseUrl: stripSlash(input.baseUrl || "https://app.omnidocs.cloud"),
      clientId: String(input.clientId || "").trim(),
      clientSecretEnc: nextSecret ? encrypt(nextSecret) : current.clientSecretEnc || "",
      unitId: String(input.unitId || "").trim(),
      contentSourceId: String(input.contentSourceId || "").trim(),
      publicBaseUrl: stripSlash(input.publicBaseUrl || ""),
      authDomain: String(input.authDomain || "").trim(),
    },
    actor,
    "Create-koppeling bijgewerkt"
  );
  tokenCache.clear();
}

async function parseError(res) {
  const text = await res.text();
  try {
    const json = JSON.parse(text);
    return json.detail || json.title || json.message || text || `${res.status} ${res.statusText}`;
  } catch {
    return text || `${res.status} ${res.statusText}`;
  }
}

async function getToken(settings, force = false) {
  const key = tokenKey(settings);
  const cachedToken = tokenCache.get(key);
  if (!force && cachedToken && cachedToken.expiresAt > Date.now() + 5000) {
    return cachedToken.accessToken;
  }
  const auth = Buffer.from(`${settings.clientId}:${settings.clientSecret}`).toString("base64");
  const res = await fetch(`${settings.baseUrl}/api/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: settings.clientId,
      client_secret: settings.clientSecret,
    }),
  });
  if (!res.ok) throw new Error(`OAuth token failed: ${await parseError(res)}`);
  const body = await res.json();
  const nextToken = {
    accessToken: body.access_token,
    expiresAt: Date.now() + Math.max(30, Number(body.expires_in || 3600) - 60) * 1000,
  };
  tokenCache.set(key, nextToken);
  return nextToken.accessToken;
}

async function createRequest(settings, path, options = {}, retry = true) {
  const token = await getToken(settings);
  const res = await fetch(`${settings.baseUrl}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });
  if (res.status === 401 && retry) {
    tokenCache.delete(tokenKey(settings));
    return createRequest(settings, path, options, false);
  }
  if (!res.ok) throw new Error(await parseError(res));
  if (res.status === 204) return null;
  return res.json();
}

async function searchRecipes(settings, { name } = {}) {
  const params = new URLSearchParams();
  if (name) params.set("name", name);
  const query = params.toString();
  const path = `/api/v1/units/${encodeURIComponent(settings.unitId)}/content-sources/${encodeURIComponent(settings.contentSourceId)}/recipes/search${query ? `?${query}` : ""}`;
  const recipes = await createRequest(settings, path);
  return Array.isArray(recipes) ? recipes : [];
}

function recipeFields(recipe) {
  if (Array.isArray(recipe.fields) && recipe.fields.length) return recipe.fields;
  const fields = [];
  for (const group of recipe.form?.groups || []) {
    for (const component of group.formComponents || []) {
      fields.push({
        key: component.key || component.name || component.itemId,
        title: component.title || component.name || component.key,
        required: Boolean(component.required),
        type: component.formComponentType || "TextField",
      });
    }
  }
  return fields.filter((f) => f.key);
}

function prefillData(zaak, recipe) {
  const persoon = zaak.personen?.[0];
  const bedrijf = zaak.bedrijven?.[0];
  const values = {
    zaaknummer: zaak.zaaknummer,
    casenumber: zaak.zaaknummer,
    caseid: zaak.zaaknummer,
    titel: zaak.titel,
    title: zaak.titel,
    omschrijving: zaak.omschrijving || "",
    description: zaak.omschrijving || "",
    status: zaak.statusLabel || zaak.status,
    deadline: zaak.deadline || "",
    enddate: zaak.deadline || "",
    startdatum: zaak.startdatum || "",
    startdate: zaak.startdatum || "",
    referentie: zaak.referentie || "",
    reference: zaak.referentie || "",
    zaaktype: zaak.zaaktype || "",
    type: zaak.zaaktype || "",
    behandelaar: zaak.behandelaarNaam || "",
    assignee: zaak.behandelaarNaam || "",
    persoon: persoon?.naam || "",
    person: persoon?.naam || "",
    naam: persoon?.naam || "",
    name: persoon?.naam || zaak.titel,
    voornaam: persoon?.voornaam || "",
    tussenvoegsel: persoon?.tussenvoegsel || "",
    achternaam: persoon?.achternaam || "",
    firstname: persoon?.voornaam || "",
    lastname: persoon?.achternaam || "",
    email: persoon?.email || "",
    telefoon: persoon?.telefoon || "",
    phone: persoon?.telefoon || "",
    adres: persoon?.adres || bedrijf?.adres || "",
    address: persoon?.adres || bedrijf?.adres || "",
    straat: persoon?.straat || "",
    huisnummer: persoon?.huisnummer || "",
    land: persoon?.land || "",
    plaats: persoon?.plaats || bedrijf?.plaats || "",
    city: persoon?.plaats || bedrijf?.plaats || "",
    postcode: persoon?.postcode || bedrijf?.postcode || "",
    bedrijf: bedrijf?.handelsnaam || "",
    company: bedrijf?.handelsnaam || "",
    kvk: bedrijf?.kvk || "",
  };

  const data = {
    zaaknummer: zaak.zaaknummer,
    titel: zaak.titel,
    omschrijving: zaak.omschrijving || "",
    status: zaak.statusLabel || zaak.status,
    deadline: zaak.deadline || "",
    startdatum: zaak.startdatum || "",
    referentie: zaak.referentie || "",
    zaaktype: zaak.zaaktype || "",
    behandelaar: zaak.behandelaarNaam || "",
    persoon: persoon?.naam || "",
    email: persoon?.email || "",
    bedrijf: bedrijf?.handelsnaam || "",
    kvk: bedrijf?.kvk || "",
  };

  for (const field of recipeFields(recipe)) {
    const hit = values[normalizeKey(field.key)] ?? values[normalizeKey(field.title)];
    if (hit != null && hit !== "") data[field.key] = hit;
  }
  return data;
}

function prefillEmployee(werknemer, recipe) {
  const values = {
    personeelsnummer: werknemer.personeelsnummer || "",
    staffnumber: werknemer.personeelsnummer || "",
    employeeid: werknemer.personeelsnummer || "",
    voornaam: werknemer.voornaam || "",
    achternaam: werknemer.achternaam || "",
    firstname: werknemer.voornaam || "",
    lastname: werknemer.achternaam || "",
    naam: werknemer.naam || "",
    name: werknemer.naam || "",
    email: werknemer.email || "",
    aanhef: { heer: "De heer", mevrouw: "Mevrouw" }[werknemer.aanhef] || werknemer.aanhef || "",
    salutation: { heer: "De heer", mevrouw: "Mevrouw" }[werknemer.aanhef] || werknemer.aanhef || "",
    geboortedatum: werknemer.geboortedatum || "",
    dateofbirth: werknemer.geboortedatum || "",
    straat: werknemer.straat || "",
    street: werknemer.straat || "",
    huisnummer: werknemer.huisnummer || "",
    housenumber: werknemer.huisnummer || "",
    postcode: werknemer.postcode || "",
    plaats: werknemer.plaats || "",
    city: werknemer.plaats || "",
    adres: [werknemer.straat, werknemer.huisnummer].filter(Boolean).join(" "),
    address: [werknemer.straat, werknemer.huisnummer].filter(Boolean).join(" "),
    datumindiensttreding: werknemer.datumIndiensttreding || "",
    startdate: werknemer.datumIndiensttreding || "",
    functiebenaming: werknemer.functiebenaming || "",
    jobtitle: werknemer.functiebenaming || "",
    inschaling: werknemer.inschaling || "",
    scale: werknemer.inschaling || "",
    salaris: werknemer.salaris || "",
    salary: werknemer.salaris || "",
    leaseauto: werknemer.leaseauto ? "ja" : "nee",
    companycar: werknemer.leaseauto ? "yes" : "no",
    vestiging: werknemer.vestiging || "",
    location: werknemer.vestiging || "",
    afdeling: werknemer.afdeling || werknemer.vestiging || "",
    department: werknemer.afdeling || werknemer.vestiging || "",
  };
  const data = { ...values };
  for (const field of recipeFields(recipe)) {
    const hit = values[normalizeKey(field.key)] ?? values[normalizeKey(field.title)];
    if (hit != null && hit !== "") data[field.key] = hit;
  }
  return data;
}

async function testConnection(settings) {
  await getToken(settings, true);
  const recipes = await searchRecipes(settings);
  return { ok: true, recipes: recipes.length };
}

function requestOrigin(req) {
  if (!req || typeof req.get !== "function") return "";
  const proto = String(req.get("x-forwarded-proto") || req.protocol || "http")
    .split(",")[0]
    .trim();
  const host = String(req.get("x-forwarded-host") || req.get("host") || "")
    .split(",")[0]
    .trim();
  if (!host) return "";
  return stripSlash(`${proto}://${host}`);
}

function publicOrigin(req, settings) {
  const configured = stripSlash(settings?.publicBaseUrl || "");
  if (configured) return configured;
  return requestOrigin(req);
}

function webhookPayload(webhookUrl, webhookHeaders) {
  if (!webhookUrl) return undefined;
  const hook = { url: webhookUrl, requestType: "Post" };
  if (webhookHeaders) hook.headers = webhookHeaders;
  return { onSuccess: [hook], onError: [hook] };
}

function prepareWebhook(req, settings, job) {
  const origin = publicOrigin(req, settings);
  const webhookUrl = webhookUrlFor(settings, job, origin);
  return {
    origin,
    webhookUrl,
    webhookHeaders: webhookUrl && job?.token ? { "X-Zaakhub-Token": job.token } : undefined,
    returnUrl: navigateToUriForJob(origin, job),
  };
}

function returnPathForJob(job) {
  if (job?.zaakId) return `/zaken/${job.zaakId}?tab=documents`;
  if (job?.werknemerId) return `/werknemers/${job.werknemerId}?tab=documents`;
  return "/";
}

function navigateToUriForJob(origin, job) {
  const path = returnPathForJob(job);
  const base = stripSlash(origin || "");
  return base ? `${base}${path}` : path;
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const text = String(value || "").trim();
    if (text) return text;
  }
  return "";
}

function documentUriFromBody(body) {
  const src = body && typeof body === "object" ? body : {};
  const meta = src.metadata && typeof src.metadata === "object" ? src.metadata : {};
  return firstNonEmpty(
    src.documentUri,
    src.fileUri,
    src.documentUrl,
    src.url,
    src.uri,
    meta.documentUri,
    meta.fileUri,
    meta.url
  );
}

function prepareGenerateRequest(settings, { recipeId, data, webhookUrl, webhookHeaders }) {
  const body = { data: data || {} };
  const webhooks = webhookPayload(webhookUrl, webhookHeaders);
  if (webhooks) body.webhooks = webhooks;
  const unit = encodeURIComponent(settings.unitId);
  const path = recipeId
    ? `/api/v1/units/${unit}/recipes/${encodeURIComponent(recipeId)}/generate/prepare`
    : `/api/v1/units/${unit}/generate/prepare`;
  return { method: "POST", path, body };
}

async function prepareGenerate(settings, opts) {
  const request = prepareGenerateRequest(settings, opts);
  return createRequest(settings, request.path, { method: request.method, body: JSON.stringify(request.body) });
}

function generateDocumentRequest(settings, { recipeId, values, fileName, mimeType = "application/pdf" }) {
  const params = new URLSearchParams();
  if (fileName) params.set("fileName", fileName);
  if (mimeType) params.set("mimeType", mimeType);
  const query = params.toString();
  const path = `/api/v1/units/${encodeURIComponent(settings.unitId)}/recipes/${encodeURIComponent(recipeId)}/generate${query ? `?${query}` : ""}`;
  return { method: "POST", path, body: { values: values || {} } };
}

async function generateDocument(settings, opts) {
  const request = generateDocumentRequest(settings, opts);
  return createRequest(settings, request.path, { method: request.method, body: JSON.stringify(request.body) });
}

function isMissingRequiredValue(err) {
  return /value is required/i.test(String(err?.message || err || ""));
}

function resolveCreateUrl(settings, uri) {
  const raw = String(uri || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  return `${stripSlash(settings.baseUrl)}${raw.startsWith("/") ? "" : "/"}${raw}`;
}

function summarizeRecipe(recipe) {
  return {
    itemId: recipe.itemId,
    name: recipe.name,
    recipeType: recipe.recipeType || "Word",
    unitId: recipe.unitId,
    contentSourceId: recipe.contentSourceId,
    hideFromUserView: Boolean(recipe.hideFromUserView),
    fields: recipeFields(recipe),
    syncedAt: new Date().toISOString(),
  };
}

function webhookUrlFor(settings, job, origin) {
  const base = stripSlash(origin || settings?.publicBaseUrl || "");
  if (!base || !job?.id) return "";
  const slugPart = settings?.slug ? `${encodeURIComponent(settings.slug)}/` : "";
  const token = job.token ? `?token=${encodeURIComponent(job.token)}` : "";
  return `${base}/api/create/webhook/${slugPart}${encodeURIComponent(job.id)}${token}`;
}

function withAuthDomain(url, settings) {
  const domain = String(settings?.authDomain || "").trim();
  if (!url || !domain) return url || "";
  try {
    const next = new URL(url);
    next.searchParams.set("authDomain", domain);
    return next.toString();
  } catch {
    const sep = String(url).includes("?") ? "&" : "?";
    return `${url}${sep}authDomain=${encodeURIComponent(domain)}`;
  }
}

async function fetchGeneratedFile(settings, url) {
  const resolved = resolveCreateUrl(settings, url);
  if (!resolved) return null;
  const tryFetch = async (withAuth) => {
    const headers = { Accept: "*/*" };
    if (withAuth) {
      try {
        headers.Authorization = `Bearer ${await getToken(settings)}`;
      } catch {
        return null;
      }
    }
    const res = await fetch(resolved, { headers, redirect: "follow" });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length) return null;
    const cd = res.headers.get("content-disposition") || "";
    const match = /filename\*?=(?:UTF-8''|")?([^\";]+)/i.exec(cd);
    const naam = decodeURIComponent((match?.[1] || "").replace(/"/g, "")) || "document";
    return {
      buffer: buf,
      naam,
      mime: (res.headers.get("content-type") || "application/octet-stream").split(";")[0].trim(),
    };
  };
  return (await tryFetch(true)) || (await tryFetch(false));
}

function saveGeneratedFile(file, dataDir) {
  const naam = slugFile(file.naam || "document");
  const stored = `${Date.now()}-${naam}`;
  const dir = path.join(dataDir || config.dataDir, "uploads");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, stored), file.buffer);
  return {
    originalname: file.naam || naam,
    filename: stored,
    size: file.buffer.length,
    mimetype: file.mime || "application/octet-stream",
  };
}

module.exports = {
  createSettings,
  configured,
  enabled,
  createSummary,
  saveCreateSettings,
  getToken,
  searchRecipes,
  testConnection,
  prepareGenerateRequest,
  prepareGenerate,
  generateDocumentRequest,
  generateDocument,
  isMissingRequiredValue,
  resolveCreateUrl,
  prefillData,
  prefillEmployee,
  summarizeRecipe,
  recipeFields,
  webhookUrlFor,
  prepareWebhook,
  publicOrigin,
  requestOrigin,
  documentUriFromBody,
  navigateToUriForJob,
  withAuthDomain,
  fetchGeneratedFile,
  saveGeneratedFile,
};
