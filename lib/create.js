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

function toIso8601(value) {
  if (value == null || value === "") return "";
  const text = String(value).trim();
  const day = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (day) return `${day[1]}-${day[2]}-${day[3]}T00:00:00`;
  if (/^\d{4}-\d{2}-\d{2}T/.test(text)) return text;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return text;
  return date.toISOString();
}

function asIso8601Dates(value) {
  if (Array.isArray(value)) return value.map(asIso8601Dates);
  if (!value || typeof value !== "object") {
    return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? toIso8601(value)
      : value;
  }
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = asIso8601Dates(item);
  }
  return out;
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
    lastWebhookAt: meta.lastWebhookAt || "",
    lastWebhookStatus: meta.lastWebhookStatus || "",
    lastWebhookPath: meta.lastWebhookPath || "",
    lastWebhookDetail: meta.lastWebhookDetail || "",
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

function stakeholders(zaak) {
  const list = [];
  for (const persoon of zaak?.personen || []) {
    if (!persoon?.id) continue;
    list.push({
      key: `persoon:${persoon.id}`,
      kind: "persoon",
      id: persoon.id,
      name: persoon.naam || "",
      persoon,
      bedrijf: persoon.bedrijf || null,
    });
  }
  for (const bedrijf of zaak?.bedrijven || []) {
    if (!bedrijf?.id) continue;
    list.push({
      key: `bedrijf:${bedrijf.id}`,
      kind: "bedrijf",
      id: bedrijf.id,
      name: bedrijf.handelsnaam || "",
      persoon: null,
      bedrijf,
    });
  }
  return list;
}

function pickStakeholders(zaak, keys) {
  const all = stakeholders(zaak);
  const wanted = new Set((Array.isArray(keys) ? keys : keys ? [keys] : []).map(String).filter(Boolean));
  if (!wanted.size) return all;
  const picked = all.filter((item) => wanted.has(item.key));
  return picked.length ? picked : all;
}

function sameKindTargets(list) {
  if (!Array.isArray(list) || !list.length) return [];
  const kinds = new Set(list.map((item) => item.kind));
  if (kinds.size > 1) return [];
  return list;
}

function persoonFields(persoon) {
  if (!persoon) return {};
  const adres = persoon.adres || [persoon.straat, persoon.huisnummer].filter(Boolean).join(" ");
  return {
    id: persoon.id || "",
    nummer: persoon.nummer || "",
    naam: persoon.naam || "",
    voornaam: persoon.voornaam || "",
    tussenvoegsel: persoon.tussenvoegsel || "",
    achternaam: persoon.achternaam || "",
    geslacht: persoon.geslacht || "",
    email: persoon.email || "",
    telefoon: persoon.telefoon || "",
    geboortedatum: persoon.geboortedatum || "",
    straat: persoon.straat || "",
    huisnummer: persoon.huisnummer || "",
    adres,
    postcode: persoon.postcode || "",
    plaats: persoon.plaats || "",
    land: persoon.land || "",
  };
}

function bedrijfFields(bedrijf) {
  if (!bedrijf) return {};
  return {
    id: bedrijf.id || "",
    nummer: bedrijf.nummer || "",
    handelsnaam: bedrijf.handelsnaam || "",
    naam: bedrijf.handelsnaam || "",
    kvk: bedrijf.kvk || "",
    email: bedrijf.email || "",
    telefoon: bedrijf.telefoon || "",
    adres: bedrijf.adres || "",
    postcode: bedrijf.postcode || "",
    plaats: bedrijf.plaats || "",
  };
}

function zaakFields(zaak) {
  return {
    id: zaak.id || "",
    zaaknummer: zaak.zaaknummer || "",
    titel: zaak.titel || "",
    omschrijving: zaak.omschrijving || "",
    status: zaak.statusLabel || zaak.status || "",
    prioriteit: zaak.prioriteitLabel || zaak.prioriteit || "",
    deadline: zaak.deadline || "",
    startdatum: zaak.startdatum || "",
    referentie: zaak.referentie || "",
    zaaktype: zaak.zaaktype || "",
    behandelaar: zaak.behandelaarNaam || "",
    voortgang: zaak.voortgang ?? "",
  };
}

function assignFlat(values, obj, prefix = "") {
  if (!obj || typeof obj !== "object") return;
  for (const [key, value] of Object.entries(obj)) {
    if (value == null || typeof value === "object") continue;
    const nk = normalizeKey(`${prefix}${key}`);
    if (value !== "" || values[nk] == null) values[nk] = value;
  }
}

function prefillData(zaak, recipe, party = {}) {
  const persoon = Object.prototype.hasOwnProperty.call(party, "persoon") ? party.persoon : zaak.personen?.[0];
  const bedrijf = Object.prototype.hasOwnProperty.call(party, "bedrijf")
    ? party.bedrijf
    : (persoon?.bedrijf || zaak.bedrijven?.[0]);
  const zaakCore = zaakFields(zaak);
  const persoonData = persoonFields(persoon);
  const bedrijfData = bedrijfFields(bedrijf);
  const betrokkene = persoon
    ? {
        soort: "persoon",
        ...persoonData,
        bedrijf: bedrijfData.handelsnaam || "",
        company: bedrijfData.handelsnaam || "",
        kvk: bedrijfData.kvk || "",
      }
    : bedrijf
      ? { soort: "bedrijf", ...bedrijfData }
      : {};
  const zaakData = {
    ...zaakCore,
    personen: (zaak.personen || []).map(persoonFields),
    bedrijven: (zaak.bedrijven || []).map(bedrijfFields),
  };

  const values = {
    casenumber: zaakCore.zaaknummer,
    caseid: zaakCore.zaaknummer,
    title: zaakCore.titel,
    description: zaakCore.omschrijving,
    enddate: zaakCore.deadline,
    startdate: zaakCore.startdatum,
    reference: zaakCore.referentie,
    type: zaakCore.zaaktype,
    assignee: zaakCore.behandelaar,
    person: persoonData.naam || "",
    name: persoonData.naam || bedrijfData.handelsnaam || zaakCore.titel,
    firstname: persoonData.voornaam || "",
    lastname: persoonData.achternaam || "",
    phone: persoonData.telefoon || bedrijfData.telefoon || "",
    address: persoonData.adres || bedrijfData.adres || "",
    city: persoonData.plaats || bedrijfData.plaats || "",
    company: bedrijfData.handelsnaam || "",
  };
  assignFlat(values, zaakCore);
  assignFlat(values, bedrijfData);
  assignFlat(values, persoonData);
  assignFlat(values, betrokkene);
  assignFlat(values, zaakCore, "zaak");
  assignFlat(values, persoonData, "persoon");
  assignFlat(values, bedrijfData, "bedrijf");
  assignFlat(values, betrokkene, "betrokkene");

  const data = {
    ...zaakCore,
    naam: values.name,
    persoon: persoonData.naam || "",
    email: persoonData.email || bedrijfData.email || "",
    telefoon: persoonData.telefoon || bedrijfData.telefoon || "",
    adres: persoonData.adres || bedrijfData.adres || "",
    plaats: persoonData.plaats || bedrijfData.plaats || "",
    postcode: persoonData.postcode || bedrijfData.postcode || "",
    bedrijf: bedrijfData.handelsnaam || "",
    kvk: bedrijfData.kvk || "",
    zaak: zaakData,
    betrokkene,
  };

  for (const field of recipeFields(recipe)) {
    const hit = values[normalizeKey(field.key)] ?? values[normalizeKey(field.title)];
    if (hit != null && hit !== "") data[field.key] = hit;
  }
  return asIso8601Dates(data);
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
  return asIso8601Dates(data);
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
  if (job?.zaakId) return `/zaken?focus=${encodeURIComponent(job.zaakId)}&peekTab=docs`;
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

function pickUri(obj) {
  if (!obj || typeof obj !== "object") return "";
  const map = {};
  for (const [key, value] of Object.entries(obj)) map[String(key).toLowerCase()] = value;
  const direct = firstNonEmpty(
    map.documenturi,
    map.fileuri,
    map.documenturl,
    map.fileurl,
    map.downloadurl,
    map.location,
    map.uri,
    map.url
  );
  return typeof direct === "string" ? direct : "";
}

function documentUriFromBody(body, depth = 0) {
  if (typeof body === "string" && /^https?:\/\//i.test(body.trim())) return body.trim();
  const src = body && typeof body === "object" && !Buffer.isBuffer(body) ? body : {};
  const direct = pickUri(src);
  if (direct) return direct;
  if (depth >= 5) return "";
  for (const value of Object.values(src)) {
    if (value && typeof value === "object") {
      const nested = documentUriFromBody(value, depth + 1);
      if (nested) return nested;
    }
  }
  return "";
}

function webhookBody(req) {
  const raw = req.body;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return { raw: raw.slice(0, 2000) };
    }
  }
  if (Buffer.isBuffer(raw)) return webhookBody({ body: raw.toString("utf8") });
  if (raw && typeof raw === "object") return raw;
  return {};
}

function clipJson(value, max = 4000) {
  try {
    const text = JSON.stringify(value);
    if (text.length <= max) return value;
    return { truncated: true, preview: text.slice(0, max) };
  } catch {
    return { unserializable: true };
  }
}

function webhookTokenState(req, job, body) {
  if (!job?.token) return "ok";
  const got = String(req.get("x-zaakhub-token") || req.query.token || body?.token || "").trim();
  if (!got) return "missing";
  return got === job.token ? "ok" : "mismatch";
}

function publicWebhookUrl(url) {
  return String(url || "")
    .replace(/[?&]token=[^&]*/g, "")
    .replace(/\?$/, "")
    .replace(/&&+/g, "&");
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

function generateDocumentRequest(settings, { recipeId, values, data, fileName, mimeType = "application/pdf" }) {
  const params = new URLSearchParams();
  if (fileName) params.set("fileName", fileName);
  if (mimeType) params.set("mimeType", mimeType);
  const query = params.toString();
  const path = `/api/v1/units/${encodeURIComponent(settings.unitId)}/recipes/${encodeURIComponent(recipeId)}/generate${query ? `?${query}` : ""}`;
  const payload = data || values || {};
  return { method: "POST", path, body: { data: payload, values: payload } };
}

async function generateDocument(settings, opts) {
  const request = generateDocumentRequest(settings, opts);
  return createRequest(settings, request.path, { method: request.method, body: JSON.stringify(request.body) });
}

function batchItem({ data, webhookUrl, webhookHeaders }) {
  const item = { data: data || {} };
  const webhooks = webhookPayload(webhookUrl, webhookHeaders);
  if (webhooks) item.webhooks = webhooks;
  return item;
}

function generateBatchAsyncRequest(settings, { recipeId, items, mimeType = "application/pdf" }) {
  const params = new URLSearchParams();
  if (mimeType) params.set("mimeType", mimeType);
  params.set("includeMetadata", "true");
  const query = params.toString();
  const path = `/api/v1/units/${encodeURIComponent(settings.unitId)}/recipes/${encodeURIComponent(recipeId)}/generate/batch/async${query ? `?${query}` : ""}`;
  return { method: "POST", path, body: items || [] };
}

function asMessageList(body) {
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.results)) return body.results;
  if (Array.isArray(body?.items)) return body.items;
  if (body && typeof body === "object") return [body];
  return [];
}

function normalizeGenerateMessage(row) {
  if (!row || typeof row !== "object") return { success: false, message: "", generateId: "" };
  const generateId = firstNonEmpty(row.generateId, row.GenerateId, row.documentGenerationId);
  const message = firstNonEmpty(row.message, row.Message);
  const flagged = row.success ?? row.Success;
  const success = flagged === true || flagged === "true" || (flagged == null && Boolean(generateId));
  return { success, message, generateId };
}

async function generateBatchAsync(settings, opts) {
  const request = generateBatchAsyncRequest(settings, opts);
  const body = await createRequest(settings, request.path, {
    method: request.method,
    body: JSON.stringify(request.body),
  });
  return asMessageList(body).map(normalizeGenerateMessage);
}

function isBatchUnsupported(err) {
  return /404|not found|405|method not allowed|does not exist/i.test(String(err?.message || err || ""));
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
  generateBatchAsyncRequest,
  generateBatchAsync,
  batchItem,
  normalizeGenerateMessage,
  isBatchUnsupported,
  isMissingRequiredValue,
  resolveCreateUrl,
  prefillData,
  stakeholders,
  pickStakeholders,
  sameKindTargets,
  prefillEmployee,
  summarizeRecipe,
  recipeFields,
  webhookUrlFor,
  prepareWebhook,
  publicOrigin,
  requestOrigin,
  documentUriFromBody,
  webhookBody,
  clipJson,
  webhookTokenState,
  publicWebhookUrl,
  navigateToUriForJob,
  withAuthDomain,
  fetchGeneratedFile,
  saveGeneratedFile,
};
