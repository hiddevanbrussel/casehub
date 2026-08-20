const { encrypt, decrypt } = require("./crypto");

function stripSlash(url) {
  return String(url || "").replace(/\/+$/, "");
}

function azureSettings(store) {
  const meta = store.meta().azure || {};
  return {
    tenantId: String(process.env.AZURE_TENANT_ID || meta.tenantId || "").trim(),
    clientId: String(process.env.AZURE_CLIENT_ID || meta.clientId || "").trim(),
    clientSecret: process.env.AZURE_CLIENT_SECRET || decrypt(meta.clientSecretEnc || ""),
    hasSecret: Boolean(process.env.AZURE_CLIENT_SECRET || meta.clientSecretEnc),
    lastError: meta.lastError || "",
    active: meta.active !== false,
  };
}

function configured(settings) {
  return Boolean(settings.tenantId && settings.clientId && settings.clientSecret);
}

function enabled(settings) {
  return configured(settings) && settings.active !== false;
}

function azureSummary(settings, translate) {
  const label = typeof translate === "function"
    ? translate
    : ((key) => ({ "azure.clientConfigured": "App registered", "azure.clientMissing": "App missing" }[key] || key));
  if (!configured(settings)) return "—";
  const parts = [
    settings.tenantId,
    settings.hasSecret || settings.clientId ? label("azure.clientConfigured") : label("azure.clientMissing"),
  ];
  return parts.join(" · ");
}

function saveAzureSettings(store, input, actor) {
  const current = store.meta().azure || {};
  const nextSecret = String(input.clientSecret || "").trim();
  store.patchAzure(
    {
      tenantId: String(input.tenantId || "").trim(),
      clientId: String(input.clientId || "").trim(),
      clientSecretEnc: nextSecret ? encrypt(nextSecret) : current.clientSecretEnc || "",
      lastError: "",
    },
    actor,
    "Azure-koppeling bijgewerkt"
  );
}

function publicOrigin(req, store) {
  const createMeta = store.meta().create || {};
  const fromSettings = stripSlash(process.env.PUBLIC_BASE_URL || createMeta.publicBaseUrl || "");
  if (fromSettings) return fromSettings;
  const proto = req.get("x-forwarded-proto") || req.protocol || "http";
  return `${proto}://${req.get("host")}`;
}

function redirectUri(req, store) {
  return `${publicOrigin(req, store)}/auth/azure/callback`;
}

function authorizeUrl(settings, { state, redirectUri: uri }) {
  const url = new URL(`https://login.microsoftonline.com/${encodeURIComponent(settings.tenantId)}/oauth2/v2.0/authorize`);
  url.searchParams.set("client_id", settings.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", uri);
  url.searchParams.set("response_mode", "query");
  url.searchParams.set("scope", "openid profile email User.Read");
  url.searchParams.set("state", state);
  return url.toString();
}

async function exchangeCode(settings, { code, redirectUri: uri }) {
  const res = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(settings.tenantId)}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      client_id: settings.clientId,
      client_secret: settings.clientSecret,
      code,
      redirect_uri: uri,
      grant_type: "authorization_code",
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error_description || body.error || `${res.status} ${res.statusText}`);
  }
  return body;
}

async function fetchProfile(accessToken) {
  const res = await fetch("https://graph.microsoft.com/v1.0/me", {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error?.message || body.error_description || "Microsoft Graph profile failed");
  }
  const email = String(body.mail || body.userPrincipalName || "").toLowerCase().trim();
  const display = String(body.displayName || "").trim();
  const parts = display.split(/\s+/).filter(Boolean);
  return {
    oid: body.id || "",
    email,
    voornaam: String(body.givenName || parts[0] || "User").trim(),
    achternaam: String(body.surname || parts.slice(1).join(" ") || "—").trim(),
  };
}

function findOrCreateAzureUser(store, profile) {
  if (!profile.email) throw new Error("Microsoft account has no email address");
  const existing = store.werknemerByEmail(profile.email);
  if (existing) {
    store.saveWerknemer(
      {
        id: existing.id,
        voornaam: existing.voornaam || profile.voornaam,
        achternaam: existing.achternaam || profile.achternaam,
        email: existing.email,
        rol: existing.rol,
        afdeling: existing.afdeling,
        authSource: existing.authSource === "local" ? "local" : "azure",
        azureOid: profile.oid,
      },
      null
    );
    return store.werknemer(existing.id);
  }
  return store.saveWerknemer(
    {
      voornaam: profile.voornaam,
      achternaam: profile.achternaam,
      email: profile.email,
      rol: "medewerker",
      authSource: "azure",
      azureOid: profile.oid,
    },
    null
  );
}

module.exports = {
  azureSettings,
  configured,
  enabled,
  azureSummary,
  saveAzureSettings,
  publicOrigin,
  redirectUri,
  authorizeUrl,
  exchangeCode,
  fetchProfile,
  findOrCreateAzureUser,
};
