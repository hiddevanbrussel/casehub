const fs = require("fs");
const path = require("path");
const config = require("../config");
const { encrypt, decrypt } = require("./crypto");
const { slugFile } = require("./format");

let cachedToken = null;

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
    baseUrl: stripSlash(process.env.CREATE_BASE_URL || meta.baseUrl || "https://app.omnidocs.cloud"),
    clientId: process.env.CREATE_CLIENT_ID || meta.clientId || "",
    clientSecret: process.env.CREATE_CLIENT_SECRET || decrypt(meta.clientSecretEnc || ""),
    unitId: process.env.CREATE_UNIT_ID || meta.unitId || "",
    contentSourceId: process.env.CREATE_CONTENT_SOURCE_ID || meta.contentSourceId || "",
    publicBaseUrl: stripSlash(process.env.PUBLIC_BASE_URL || meta.publicBaseUrl || ""),
    authDomain: String(process.env.CREATE_AUTH_DOMAIN || meta.authDomain || "").trim(),
    lastSyncAt: meta.lastSyncAt || "",
    lastError: meta.lastError || "",
    hasSecret: Boolean(process.env.CREATE_CLIENT_SECRET || meta.clientSecretEnc),
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
  const parts = [host, settings.hasSecret || settings.clientId ? label("create.clientConfigured") : label("create.clientMissing")];
  if (settings.unitId) parts.push(`Unit ID: ${settings.unitId}`);
  if (settings.contentSourceId) parts.push(`Content source ID: ${settings.contentSourceId}`);
  if (settings.authDomain) parts.push(`authDomain: ${settings.authDomain}`);
  return parts.join(" · ");
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
  cachedToken = null;
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
  cachedToken = {
    accessToken: body.access_token,
    expiresAt: Date.now() + Math.max(30, Number(body.expires_in || 3600) - 60) * 1000,
  };
  return cachedToken.accessToken;
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
    cachedToken = null;
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
    achternaam: persoon?.achternaam || "",
    firstname: persoon?.voornaam || "",
    lastname: persoon?.achternaam || "",
    email: persoon?.email || "",
    telefoon: persoon?.telefoon || "",
    phone: persoon?.telefoon || "",
    adres: persoon?.adres || bedrijf?.adres || "",
    address: persoon?.adres || bedrijf?.adres || "",
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

async function testConnection(settings) {
  await getToken(settings, true);
  const recipes = await searchRecipes(settings);
  return { ok: true, recipes: recipes.length };
}

function webhookPayload(webhookUrl, webhookHeaders) {
  if (!webhookUrl) return undefined;
  const hook = { url: webhookUrl, requestType: "Post" };
  if (webhookHeaders) hook.headers = webhookHeaders;
  return { onSuccess: [hook], onError: [hook] };
}

async function prepareGenerate(settings, { recipeId, data, webhookUrl, webhookHeaders }) {
  const body = { data: data || {} };
  const webhooks = webhookPayload(webhookUrl, webhookHeaders);
  if (webhooks) body.webhooks = webhooks;
  const unit = encodeURIComponent(settings.unitId);
  const path = recipeId
    ? `/api/v1/units/${unit}/recipes/${encodeURIComponent(recipeId)}/generate/prepare`
    : `/api/v1/units/${unit}/generate/prepare`;
  return createRequest(settings, path, { method: "POST", body: JSON.stringify(body) });
}

async function generateDocument(settings, { recipeId, values, fileName, mimeType = "application/pdf" }) {
  const params = new URLSearchParams();
  if (fileName) params.set("fileName", fileName);
  if (mimeType) params.set("mimeType", mimeType);
  const query = params.toString();
  const path = `/api/v1/units/${encodeURIComponent(settings.unitId)}/recipes/${encodeURIComponent(recipeId)}/generate${query ? `?${query}` : ""}`;
  return createRequest(settings, path, { method: "POST", body: JSON.stringify({ values: values || {} }) });
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

function webhookUrlFor(settings, job) {
  if (!settings.publicBaseUrl) return "";
  return `${settings.publicBaseUrl}/api/create/webhook/${encodeURIComponent(job.id)}?token=${encodeURIComponent(job.token)}`;
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

function saveGeneratedFile(file) {
  const naam = slugFile(file.naam || "document");
  const stored = `${Date.now()}-${naam}`;
  fs.writeFileSync(path.join(config.dataDir, "uploads", stored), file.buffer);
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
  prepareGenerate,
  generateDocument,
  resolveCreateUrl,
  prefillData,
  summarizeRecipe,
  recipeFields,
  webhookUrlFor,
  withAuthDomain,
  fetchGeneratedFile,
  saveGeneratedFile,
};
