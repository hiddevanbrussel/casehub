const http = require("http");
const https = require("https");
const { X509Certificate, timingSafeEqual, randomUUID } = require("crypto");
const { encrypt, decrypt } = require("./crypto");

const NS = {
  soap: "http://schemas.xmlsoap.org/soap/envelope/",
  stuf: "http://www.egem.nl/StUF/StUF0301",
  zkn: "http://www.egem.nl/StUF/sector/zkn/0310",
  bg: "http://www.egem.nl/StUF/sector/bg/0310",
  dcr: "http://www.kinggemeenten.nl/StUF/sector/dcr/0310",
  xsi: "http://www.w3.org/2001/XMLSchema-instance",
  xsd: "http://www.w3.org/2001/XMLSchema",
};

const SOAP_ACTION_START =
  "http://www.kinggemeenten.nl/StUF/sector/dcr/0310/verzoekStartenDocumentcreatieDi02";

const JOB_STATUS = {
  ontvangen: "ontvangen",
  bezig: "bezig",
  onderbroken: "onderbroken",
  geannuleerd: "geannuleerd",
  klaar: "klaar",
  onbekend: "onbekend",
  fout: "fout",
};

function stripSlash(url) {
  return String(url || "").replace(/\/+$/, "");
}

function escapeXml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function decodeXml(value) {
  return String(value || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();
}

function stufTimestamp(date = new Date()) {
  const p = (n, width = 2) => String(n).padStart(width, "0");
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}${p(date.getMilliseconds(), 3)}`;
}

function stufDate(value) {
  const digits = String(value || "").replace(/\D/g, "").slice(0, 8);
  return digits.length === 8 ? digits : "";
}

function splitHuisnummer(value) {
  const text = String(value || "").trim();
  const match = /^(\d+)\s*([A-Za-z])?(?:\s*[-/]?\s*(.*))?$/.exec(text);
  if (!match) return { huisnummer: text, huisletter: "", toevoeging: "" };
  return {
    huisnummer: match[1] || "",
    huisletter: match[2] || "",
    toevoeging: String(match[3] || "").trim(),
  };
}

function rawFromMeta(meta = {}) {
  return { ...(meta.create?.stufDcr || {}), ...(meta.stufDcr || {}) };
}

function readActive(stuf) {
  if (Object.prototype.hasOwnProperty.call(stuf, "active")) return stuf.active !== false;
  if (Object.prototype.hasOwnProperty.call(stuf, "enabled")) return stuf.enabled === true;
  return true;
}

function readSettings(meta = {}) {
  const stuf = rawFromMeta(meta);
  return {
    slug: "",
    dcaUrl: stripSlash(stuf.dcaUrl || process.env.STUF_DCR_DCA_URL || ""),
    soapAction: String(stuf.soapAction || process.env.STUF_DCR_SOAP_ACTION || "").trim(),
    publicBaseUrl: stripSlash(stuf.publicBaseUrl || ""),
    ontvangerOrganisatie: String(stuf.ontvangerOrganisatie || "").trim(),
    ontvangerApplicatie: String(stuf.ontvangerApplicatie || "OmniDocs Create").trim() || "OmniDocs Create",
    zenderOrganisatie: String(stuf.zenderOrganisatie || "").trim(),
    zenderApplicatie: String(stuf.zenderApplicatie || "Zaakhub").trim() || "Zaakhub",
    zenderAdministratie: String(stuf.zenderAdministratie || "").trim(),
    zenderGebruiker: String(stuf.zenderGebruiker || "").trim(),
    lastResultAt: stuf.lastResultAt || "",
    lastResultStatus: stuf.lastResultStatus || "",
    lastResultPath: stuf.lastResultPath || "",
    lastResultDetail: stuf.lastResultDetail || "",
    lastError: stuf.lastError || "",
    active: readActive(stuf),
    inboundCertPem: stuf.inboundCertPem || "",
    inboundCertMeta: stuf.inboundCertMeta || null,
    hasInboundCert: Boolean(stuf.inboundCertPem),
    hasOutboundCert: Boolean(stuf.outboundPfxEnc),
    outboundCertMeta: stuf.outboundCertMeta || null,
    outboundPfxEnc: stuf.outboundPfxEnc || "",
    outboundPassEnc: stuf.outboundPassEnc || "",
    templates: Array.isArray(stuf.templates) ? stuf.templates.filter((item) => item && item.itemId) : [],
  };
}

function parseTemplateLines(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const named = line.match(/^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\s*[|–-]\s*|\s+)(.+)$/i);
      if (named) return { itemId: named[1], name: named[2].trim() || named[1] };
      return { itemId: line, name: line };
    });
}

function templatesText(templates) {
  return (Array.isArray(templates) ? templates : [])
    .map((item) => (item.name && item.name !== item.itemId ? `${item.itemId} | ${item.name}` : item.itemId))
    .join("\n");
}

function leftoverActive(leftover) {
  if (Object.prototype.hasOwnProperty.call(leftover, "active")) return leftover.active !== false;
  if (Object.prototype.hasOwnProperty.call(leftover, "enabled")) return leftover.enabled === true;
  return Boolean(leftover.dcaUrl);
}

function migrateNested(store) {
  const leftover = store?.meta?.()?.create?.stufDcr;
  if (!leftover || typeof leftover !== "object" || !store.patchStuf) return;
  const current = store.meta().stufDcr || {};
  if (!current.dcaUrl && (leftover.dcaUrl || leftover.lastResultAt)) {
    const rest = { ...leftover };
    delete rest.enabled;
    store.patchStuf({ ...rest, active: leftoverActive(leftover) });
  }
  store.patchCreate({ stufDcr: null });
}

function stufSettings(store) {
  if (!store || typeof store.meta !== "function") {
    return { ...readSettings({}), slug: "" };
  }
  migrateNested(store);
  const settings = readSettings(store.meta() || {});
  settings.slug = store.slug || "";
  return settings;
}

function fromInput(input, current = {}) {
  return {
    dcaUrl: stripSlash(input.stufDcaUrl || input.dcaUrl || ""),
    soapAction: String(input.stufSoapAction || input.soapAction || "").trim(),
    publicBaseUrl: stripSlash(input.stufPublicBaseUrl || input.publicBaseUrl || ""),
    ontvangerOrganisatie: String(input.stufOntvangerOrganisatie || input.ontvangerOrganisatie || "").trim(),
    ontvangerApplicatie: String(input.stufOntvangerApplicatie || input.ontvangerApplicatie || current.ontvangerApplicatie || "OmniDocs Create").trim(),
    zenderOrganisatie: String(input.stufZenderOrganisatie || input.zenderOrganisatie || "").trim(),
    zenderApplicatie: String(input.stufZenderApplicatie || input.zenderApplicatie || current.zenderApplicatie || "Zaakhub").trim(),
    zenderAdministratie: String(input.stufZenderAdministratie || input.zenderAdministratie || "").trim(),
    zenderGebruiker: String(input.stufZenderGebruiker || input.zenderGebruiker || "").trim(),
    lastResultAt: current.lastResultAt || "",
    lastResultStatus: current.lastResultStatus || "",
    lastResultPath: current.lastResultPath || "",
    lastResultDetail: current.lastResultDetail || "",
    lastError: "",
    active: true,
    templates: Object.prototype.hasOwnProperty.call(input, "templatesText") || Object.prototype.hasOwnProperty.call(input, "stufTemplates")
      ? parseTemplateLines(input.templatesText || input.stufTemplates || "")
      : current.templates || [],
  };
}

function firstFile(files, name) {
  const list = files && files[name];
  return Array.isArray(list) && list[0] ? list[0] : null;
}

function normalizePem(value) {
  const text = String(value || "")
    .replace(/\r/g, "")
    .replace(/\\n/g, "\n")
    .trim();
  if (!text) return "";
  return `${text.replace(/\n+$/, "")}\n`;
}

function derToPem(der) {
  const b64 = Buffer.from(der).toString("base64").match(/.{1,64}/g) || [];
  return `-----BEGIN CERTIFICATE-----\n${b64.join("\n")}\n-----END CERTIFICATE-----\n`;
}

function bufferToPem(buf, fallbackText) {
  const source = buf && buf.length ? buf : Buffer.from(String(fallbackText || ""), "utf8");
  if (!source.length) return "";
  const asText = source.toString("utf8");
  if (/-----BEGIN CERTIFICATE-----/.test(asText)) return normalizePem(asText);
  return derToPem(source);
}

function certMetaFromPem(pem) {
  const cert = new X509Certificate(pem);
  return {
    subject: String(cert.subject || "").replace(/\n/g, ", "),
    issuer: String(cert.issuer || "").replace(/\n/g, ", "),
    fingerprint: cert.fingerprint256 || cert.fingerprint || "",
    validTo: cert.validTo || "",
  };
}

function inboundPemFromInput(input, files) {
  const uploaded = firstFile(files, "inboundCertFile");
  if (uploaded && uploaded.buffer && uploaded.buffer.length) {
    return bufferToPem(uploaded.buffer);
  }
  return normalizePem(input.inboundCertPem || "");
}

function applyCertificateUploads(input, files, current) {
  const next = {};
  if (String(input.clearInboundCert || "") === "1") {
    next.inboundCertPem = "";
    next.inboundCertMeta = null;
  } else {
    const pem = inboundPemFromInput(input, files);
    if (pem) {
      try {
        next.inboundCertPem = pem;
        next.inboundCertMeta = certMetaFromPem(pem);
      } catch {
        throw new Error("Ongeldig inkomend clientcertificaat");
      }
    }
  }
  if (String(input.clearOutboundCert || "") === "1") {
    next.outboundPfxEnc = "";
    next.outboundPassEnc = "";
    next.outboundCertMeta = null;
  } else {
    const uploaded = firstFile(files, "outboundCertFile");
    const pass = String(input.outboundPass || "").trim();
    if (uploaded && uploaded.buffer && uploaded.buffer.length) {
      next.outboundPfxEnc = encrypt(uploaded.buffer.toString("base64"));
      next.outboundPassEnc = pass ? encrypt(pass) : current.outboundPassEnc || "";
      next.outboundCertMeta = {
        fileName: uploaded.originalname || "client.pfx",
        kind: "pfx",
      };
    } else if (pass) {
      next.outboundPassEnc = encrypt(pass);
    }
  }
  return next;
}

function saveStufSettings(store, input, actor, files = {}) {
  if (!store || typeof store.meta !== "function" || typeof store.patchStuf !== "function") {
    throw new Error("Werkruimte ontbreekt");
  }
  const current = stufSettings(store);
  const stored = store.meta().stufDcr || {};
  store.patchStuf(
    { ...fromInput(input, current), ...applyCertificateUploads(input, files, stored) },
    actor,
    "StUF-DCR-koppeling bijgewerkt"
  );
  if (store.meta().create?.stufDcr) store.patchCreate({ stufDcr: null });
}

function normalizeFingerprint(value) {
  return String(value || "").replace(/[^0-9a-f]/gi, "").toLowerCase();
}

function fingerprintsEqual(left, right) {
  const a = normalizeFingerprint(left);
  const b = normalizeFingerprint(right);
  if (!a || !b || a.length !== b.length || a.length % 2) return false;
  const ba = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

function decodeCertHeader(value) {
  let text = String(value || "").trim();
  if (!text) return "";
  try {
    text = decodeURIComponent(text);
  } catch {
    /* already decoded */
  }
  text = text.replace(/\t/g, "\n");
  if (/-----BEGIN CERTIFICATE-----/.test(text)) return normalizePem(text.replace(/\n+/g, "\n"));
  try {
    const der = Buffer.from(text.replace(/\s+/g, ""), "base64");
    if (der.length > 40) return derToPem(der);
  } catch {
    /* not base64 DER */
  }
  return "";
}

function presentedClientCert(req) {
  if (!req) return { pem: "", fingerprint: "" };
  const headerNames = [
    "ssl-client-cert",
    "x-ssl-client-cert",
    "x-forwarded-tls-client-cert",
    "x-forwarded-client-cert",
    "x-client-cert",
  ];
  for (const name of headerNames) {
    const pem = decodeCertHeader(req.get(name));
    if (!pem) continue;
    try {
      return { pem, fingerprint: certMetaFromPem(pem).fingerprint };
    } catch {
      return { pem, fingerprint: "" };
    }
  }
  const headerFp = req.get("ssl-client-fingerprint") || req.get("x-ssl-client-fingerprint") || req.get("x-client-cert-fingerprint") || "";
  const sock = req.socket || req.connection;
  if (sock && typeof sock.getPeerCertificate === "function") {
    const cert = sock.getPeerCertificate();
    if (cert && cert.raw) {
      const pem = derToPem(cert.raw);
      return { pem, fingerprint: cert.fingerprint256 || cert.fingerprint || certMetaFromPem(pem).fingerprint };
    }
    if (cert && (cert.fingerprint256 || cert.fingerprint)) {
      return { pem: "", fingerprint: cert.fingerprint256 || cert.fingerprint };
    }
  }
  return { pem: "", fingerprint: headerFp };
}

function verifyInboundClientCert(req, settings) {
  const expectedPem = asStuf(settings).inboundCertPem || "";
  if (!expectedPem) return { ok: true, skipped: true };
  let expected;
  try {
    expected = certMetaFromPem(expectedPem);
  } catch {
    return { ok: false, code: "invalid_stored" };
  }
  const presented = presentedClientCert(req);
  if (!presented.pem && !presented.fingerprint) return { ok: false, code: "missing" };
  if (presented.fingerprint && fingerprintsEqual(presented.fingerprint, expected.fingerprint)) {
    return { ok: true };
  }
  if (presented.pem) {
    try {
      const got = certMetaFromPem(presented.pem);
      if (fingerprintsEqual(got.fingerprint, expected.fingerprint)) return { ok: true };
    } catch {
      return { ok: false, code: "mismatch" };
    }
  }
  return { ok: false, code: "mismatch" };
}

function outboundTlsOptions(settings) {
  const stuf = asStuf(settings);
  const encoded = decrypt(stuf.outboundPfxEnc || "");
  if (!encoded) return {};
  const options = { pfx: Buffer.from(encoded, "base64") };
  const passphrase = decrypt(stuf.outboundPassEnc || "");
  if (passphrase) options.passphrase = passphrase;
  return options;
}

function postSoap(url, { body, headers, tls }) {
  const target = new URL(url);
  const isHttps = target.protocol === "https:";
  const lib = isHttps ? https : http;
  const options = {
    protocol: target.protocol,
    hostname: target.hostname,
    port: target.port || (isHttps ? 443 : 80),
    path: `${target.pathname}${target.search}`,
    method: "POST",
    headers: {
      ...headers,
      "Content-Length": Buffer.byteLength(body),
    },
  };
  if (isHttps && tls && tls.pfx) {
    options.pfx = tls.pfx;
    if (tls.passphrase) options.passphrase = tls.passphrase;
  }
  return new Promise((resolve, reject) => {
    const req = lib.request(options, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        resolve({
          status: res.statusCode || 0,
          text: Buffer.concat(chunks).toString("utf8"),
        });
      });
    });
    req.on("error", reject);
    req.end(body);
  });
}

function asStuf(settings) {
  if (!settings) return {};
  if (settings.dcaUrl != null && !settings.baseUrl) return settings;
  return settings.stufDcr || settings;
}

function configured(settings) {
  return Boolean(asStuf(settings).dcaUrl);
}

function enabled(settings) {
  const stuf = asStuf(settings);
  return Boolean(stuf.dcaUrl && stuf.active !== false);
}

function stufSummary(settings) {
  if (!configured(settings)) return "—";
  const stuf = asStuf(settings);
  try {
    return new URL(stuf.dcaUrl).host;
  } catch {
    return stuf.dcaUrl.replace(/^https?:\/\//, "");
  }
}

function publicOrigin(req, store) {
  const stuf = stufSettings(store);
  if (stuf.publicBaseUrl) return stuf.publicBaseUrl;
  const createMeta = store.meta().create || {};
  const fromCreate = stripSlash(createMeta.publicBaseUrl || process.env.PUBLIC_BASE_URL || "");
  if (fromCreate) return fromCreate;
  if (!req || typeof req.get !== "function") return "";
  const proto = String(req.get("x-forwarded-proto") || req.protocol || "http").split(",")[0].trim();
  const host = String(req.get("x-forwarded-host") || req.get("host") || "").split(",")[0].trim();
  return host ? stripSlash(`${proto}://${host}`) : "";
}

function publicCallbackUrl(origin, slug) {
  const base = stripSlash(origin || "");
  if (!base || !slug) return "";
  return `${base}/api/stuf-dcr/${encodeURIComponent(slug)}`;
}

function clipXml(xml, max = 8000) {
  const text = String(xml || "");
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n…`;
}

function xmlValue(xml, names) {
  const list = Array.isArray(names) ? names : [names];
  const source = String(xml || "");
  for (const name of list) {
    const local = String(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`<(?:[\\w.-]+:)?${local}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w.-]+:)?${local}>`, "i");
    const match = source.match(re);
    if (match) return decodeXml(match[1]);
  }
  return "";
}

function hasLocalName(xml, name) {
  const local = String(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`<(?:[\\w.-]+:)?${local}(?:\\s|/|>)`, "i").test(String(xml || ""));
}

function normalizeJobStatus(value) {
  const status = String(value || "").trim().toLowerCase();
  switch (status) {
    case JOB_STATUS.ontvangen:
    case JOB_STATUS.bezig:
    case JOB_STATUS.onderbroken:
    case JOB_STATUS.geannuleerd:
    case JOB_STATUS.klaar:
    case JOB_STATUS.onbekend:
    case JOB_STATUS.fout:
      return status;
    default:
      return status ? JOB_STATUS.onbekend : "";
  }
}

function jobOutcome(status) {
  switch (normalizeJobStatus(status)) {
    case JOB_STATUS.klaar:
      return "ready";
    case JOB_STATUS.geannuleerd:
    case JOB_STATUS.fout:
      return "failed";
    case JOB_STATUS.ontvangen:
    case JOB_STATUS.bezig:
    case JOB_STATUS.onderbroken:
    case JOB_STATUS.onbekend:
      return "pending";
    default:
      return "pending";
  }
}

function mimeFromFormaat(formaat, buffer) {
  const hint = String(formaat || "").toLowerCase();
  if (hint.includes("pdf") || hint === "application/pdf") return "application/pdf";
  if (hint.includes("docx")) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (hint.includes("doc")) return "application/msword";
  if (hint.includes("xlsx")) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (buffer?.[0] === 0x25 && buffer?.[1] === 0x50) return "application/pdf";
  if (buffer?.[0] === 0x50 && buffer?.[1] === 0x4b) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  return "application/octet-stream";
}

function fileFromBlob({ inhoud, formaat, titel, naam }) {
  const raw = String(inhoud || "").replace(/\s+/g, "");
  if (!raw) return null;
  let buffer;
  try {
    buffer = Buffer.from(raw, "base64");
  } catch {
    return null;
  }
  if (!buffer.length) return null;
  const mime = mimeFromFormaat(formaat, buffer);
  const ext = mime === "application/pdf" ? ".pdf" : mime.includes("wordprocessing") ? ".docx" : "";
  const base = String(titel || naam || "document").replace(/[\\/:*?"<>|]+/g, " ").trim() || "document";
  return {
    buffer,
    mime,
    naam: /\.[a-z0-9]+$/i.test(base) ? base : `${base}${ext}`,
  };
}

function parseResult(xml) {
  const body = String(xml || "");
  const fault = xmlValue(body, ["faultstring", "omschrijving", "Fo03Bericht"]);
  if (hasLocalName(body, "Fault") || hasLocalName(body, "Fo03Bericht")) {
    return {
      kind: "fault",
      message: fault || "StUF-DCR SOAP fault",
      jobidentificatie: xmlValue(body, "jobidentificatie"),
      referentienummer: xmlValue(body, ["referentienummer", "crossRefnummer"]),
    };
  }
  const kind = hasLocalName(body, "verstrekDocumentcreatieResultaatDi01")
    ? "di01"
    : hasLocalName(body, "leverDocumentcreatieResultaatDu02")
      ? "du02"
      : hasLocalName(body, "Bv03Bericht")
        ? "bv03"
        : "unknown";
  const status = normalizeJobStatus(xmlValue(body, "creatiejobStatus"));
  const inhoud = xmlValue(body, "inhoud");
  const resultUrl = xmlValue(body, ["resultaatURL", "resultaatUrl"]);
  let outcome = jobOutcome(status);
  if (outcome !== "failed" && (inhoud || resultUrl) && (!status || status === JOB_STATUS.klaar || status === JOB_STATUS.onbekend)) {
    outcome = "ready";
  }
  return {
    kind,
    status,
    outcome,
    jobidentificatie: xmlValue(body, "jobidentificatie"),
    referentienummer: xmlValue(body, ["referentienummer", "crossRefnummer"]),
    presentUrl: xmlValue(body, ["gebruikersinteractieURL", "gebruikersInteractieURL"]),
    resultUrl,
    titel: xmlValue(body, "titel"),
    formaat: xmlValue(body, "formaat"),
    inhoud,
    file: fileFromBlob({
      inhoud,
      formaat: xmlValue(body, "formaat"),
      titel: xmlValue(body, "titel"),
    }),
  };
}

function partyFromTarget(target, werknemer) {
  if (target?.persoon) {
    return { soort: "persoon", persoon: target.persoon, bedrijf: target.bedrijf || target.persoon.bedrijf || null };
  }
  if (target?.bedrijf) return { soort: "bedrijf", persoon: null, bedrijf: target.bedrijf };
  if (werknemer) return { soort: "persoon", persoon: werknemer, bedrijf: null };
  return { soort: "", persoon: null, bedrijf: null };
}

function stufEl(name, value) {
  if (value == null || value === "") return "";
  return `<${name} xmlns="${NS.stuf}">${escapeXml(value)}</${name}>`;
}

function zknEl(name, value, { nil = true } = {}) {
  if (value == null || value === "") {
    return nil ? `<${name} d4p1:noValue="geenWaarde" xmlns="${NS.zkn}" xsi:nil="true" />` : `<${name} xmlns="${NS.zkn}" />`;
  }
  return `<${name} xmlns="${NS.zkn}">${escapeXml(value)}</${name}>`;
}

function extraElement(naam, value) {
  if (value == null || value === "") {
    return `<d4p1:extraElement d4p1:noValue="geenWaarde" naam="${escapeXml(naam)}" xsi:nil="true" />`;
  }
  return `<d4p1:extraElement naam="${escapeXml(naam)}">${escapeXml(value)}</d4p1:extraElement>`;
}

function voorletters(value) {
  const letters = String(value || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
  return letters || "-";
}

function geslachtCode(value) {
  const code = String(value || "").trim().toLowerCase();
  if (["m", "man", "heer", "male"].includes(code)) return "M";
  if (["v", "vrouw", "mevrouw", "female"].includes(code)) return "V";
  return code ? "O" : "";
}

function statusOmschrijving(zaak) {
  return zaak?.statusLabel || zaak?.status || "Ontvangen";
}

function medewerkerXml(person, { toelichtingEmpty = true } = {}) {
  if (!person) return "";
  const achternaam = person.achternaam || person.naam || "";
  const roepnaam = person.voornaam || person.roepnaam || "";
  return `<medewerker d4p1:entiteittype="MDW">
                    ${zknEl("identificatie", person.personeelsnummer || person.id || "")}
                    ${zknEl("achternaam", achternaam, { nil: false })}
                    ${zknEl("voorletters", voorletters(roepnaam), { nil: false })}
                    ${zknEl("voorvoegselAchternaam", person.tussenvoegsel || "", { nil: false })}
                    ${zknEl("roepnaam", roepnaam, { nil: false })}
                    ${zknEl("geslachtsaanduiding", geslachtCode(person.geslacht || person.aanhef), { nil: false })}
                    ${zknEl("functie", person.functiebenaming || person.rolLabel || "", { nil: false })}
                    ${zknEl("datumUitDienst", "")}
                    ${zknEl("telefoonnummer", person.telefoon || "")}
                    ${zknEl("emailadres", person.email || "", { nil: false })}
                    ${toelichtingEmpty ? zknEl("toelichting", "", { nil: false }) : zknEl("toelichting", "")}
                  </medewerker>`;
}

function initiatorXml(party) {
  if (party?.persoon) {
    const persoon = party.persoon;
    const huis = splitHuisnummer(persoon.huisnummer);
    return `<heeftAlsInitiator d4p1:entiteittype="ZAKBTRINI" xmlns="${NS.zkn}">
              <gerelateerde d4p1:entiteittype="BTR">
                <natuurlijkPersoon d4p1:entiteittype="NPS">
                  ${zknEl("inp.bsn", persoon.bsn || "")}
                  ${zknEl("geslachtsnaam", persoon.achternaam || persoon.naam || "", { nil: false })}
                  ${zknEl("voorvoegselGeslachtsnaam", persoon.tussenvoegsel || "")}
                  ${zknEl("voornamen", persoon.voornaam || "", { nil: false })}
                  ${zknEl("geslachtsaanduiding", geslachtCode(persoon.geslacht), { nil: false })}
                  ${zknEl("geboortedatum", stufDate(persoon.geboortedatum))}
                  ${zknEl("sub.emailadres", persoon.email || "")}
                  ${zknEl("sub.telefoonnummer", persoon.telefoon || "")}
                  <verblijfsadres>
                    ${zknEl("wpl.woonplaatsNaam", persoon.plaats || "")}
                    ${zknEl("gor.openbareRuimteNaam", persoon.straat || "")}
                    ${zknEl("aoa.postcode", String(persoon.postcode || "").replace(/\s+/g, "").toUpperCase())}
                    ${zknEl("aoa.huisnummer", huis.huisnummer)}
                    ${zknEl("aoa.huisletter", huis.huisletter)}
                    ${zknEl("aoa.huisnummertoevoeging", huis.toevoeging)}
                  </verblijfsadres>
                </natuurlijkPersoon>
              </gerelateerde>
              <omschrijving>Initiator</omschrijving>
              ${zknEl("toelichting", "")}
            </heeftAlsInitiator>`;
  }
  if (party?.bedrijf) {
    const bedrijf = party.bedrijf;
    return `<heeftAlsInitiator d4p1:entiteittype="ZAKBTRINI" xmlns="${NS.zkn}">
              <gerelateerde d4p1:entiteittype="BTR">
                <nietNatuurlijkPersoon d4p1:entiteittype="NNP">
                  ${zknEl("inn.nnpId", bedrijf.kvk || bedrijf.nummer || bedrijf.id || "")}
                  ${zknEl("statutaireNaam", bedrijf.handelsnaam || bedrijf.naam || "", { nil: false })}
                  ${zknEl("sub.emailadres", bedrijf.email || "")}
                  ${zknEl("sub.telefoonnummer", bedrijf.telefoon || "")}
                  ${zknEl("sub.verblijfAdres", bedrijf.adres || [bedrijf.straat, bedrijf.huisnummer].filter(Boolean).join(" "))}
                </nietNatuurlijkPersoon>
              </gerelateerde>
              <omschrijving>Initiator</omschrijving>
              ${zknEl("toelichting", "")}
            </heeftAlsInitiator>`;
  }
  return "";
}

function extraElementenXml(zaak, party, data) {
  const extras = [
    ["Kenmerk afzender", zaak?.referentie || ""],
    ["zaak.zaaknummer", zaak?.zaaknummer || ""],
    ["zaak.titel", zaak?.titel || ""],
    ["zaak.omschrijving", zaak?.omschrijving || ""],
  ];
  const persoon = party?.persoon;
  const bedrijf = party?.bedrijf;
  if (persoon) {
    extras.push(
      ["betrokkene.naam", persoon.naam || [persoon.voornaam, persoon.tussenvoegsel, persoon.achternaam].filter(Boolean).join(" ")],
      ["betrokkene.voornaam", persoon.voornaam || ""],
      ["betrokkene.achternaam", persoon.achternaam || ""],
      ["betrokkene.email", persoon.email || ""],
      ["betrokkene.telefoon", persoon.telefoon || ""],
      ["betrokkene.straat", persoon.straat || ""],
      ["betrokkene.huisnummer", persoon.huisnummer || ""],
      ["betrokkene.postcode", persoon.postcode || ""],
      ["betrokkene.plaats", persoon.plaats || ""]
    );
  }
  if (bedrijf) {
    extras.push(
      ["betrokkene.handelsnaam", bedrijf.handelsnaam || bedrijf.naam || ""],
      ["betrokkene.kvk", bedrijf.kvk || ""],
      ["betrokkene.email", persoon?.email ? "" : bedrijf.email || ""],
      ["betrokkene.plaats", persoon?.plaats ? "" : bedrijf.plaats || ""]
    );
  }
  const org = data?.organisatie;
  if (org && typeof org === "object") {
    extras.push(
      ["organisatie.naam", org.naam || ""],
      ["organisatie.kvk", org.kvk || ""],
      ["organisatie.btw", org.btw || ""],
      ["organisatie.email", org.email || ""],
      ["organisatie.telefoon", org.telefoon || ""],
      ["organisatie.website", org.website || ""],
      ["organisatie.adres", org.adres || ""],
      ["organisatie.postcode", org.postcode || ""],
      ["organisatie.plaats", org.plaats || ""],
      ["organisatie.land", org.land || ""]
    );
  }
  const seen = new Set(extras.map(([naam]) => naam));
  const flat = { ...(data?.zaak || {}), ...(data?.betrokkene || {}) };
  for (const [key, value] of Object.entries(flat)) {
    if (value == null || typeof value === "object" || seen.has(key)) continue;
    extras.push([key, value]);
  }
  return `<d4p1:extraElementen>
              ${extras.map(([naam, value]) => extraElement(naam, value)).join("\n              ")}
            </d4p1:extraElementen>`;
}

function zaaktypeXml(zaak) {
  const naam = zaak?.zaaktype || "";
  if (!naam) return "";
  return `<isVan d4p1:entiteittype="ZAKZKT" xmlns="${NS.zkn}">
              <gerelateerde d4p1:entiteittype="ZKT">
                ${zknEl("omschrijving", naam, { nil: false })}
                ${zknEl("code", zaak.zaaktypeId || "", { nil: false })}
                ${zknEl("omschrijvingGeneriek", naam, { nil: false })}
                ${zknEl("doorlooptijd", "", { nil: false })}
              </gerelateerde>
            </isVan>`;
}

function uitvoerendeXml(zaak) {
  const behandelaar = zaak?.behandelaar;
  if (!behandelaar) return "";
  return `<heeftAlsUitvoerende d4p1:entiteittype="ZAKBTRUTV" xmlns="${NS.zkn}">
              <gerelateerde d4p1:entiteittype="BTR">
                ${medewerkerXml(behandelaar)}
              </gerelateerde>
              <omschrijving>Behandelaar</omschrijving>
              ${zknEl("toelichting", "")}
            </heeftAlsUitvoerende>`;
}

function verantwoordelijkeXml(org) {
  const naam = org?.naam || org?.orgName || "";
  if (!naam) return "";
  return `<heeftAlsVerantwoordelijke d4p1:entiteittype="ZAKBTRVRA" xmlns="${NS.zkn}">
              <gerelateerde d4p1:entiteittype="BTR">
                <organisatorischeEenheid d4p1:entiteittype="OEH">
                  ${zknEl("identificatie", org.slug || naam, { nil: false })}
                  ${zknEl("naam", naam, { nil: false })}
                  ${zknEl("naamVerkort", naam, { nil: false })}
                  ${zknEl("omschrijving", "")}
                  ${zknEl("toelichting", "")}
                </organisatorischeEenheid>
              </gerelateerde>
              <omschrijving>Verantwoordelijke</omschrijving>
              ${zknEl("toelichting", "")}
            </heeftAlsVerantwoordelijke>`;
}

function statusXml(zaak) {
  const gezet = stufTimestamp(zaak?.updatedAt ? new Date(zaak.updatedAt) : new Date()).slice(0, 14);
  return `<heeft d4p1:entiteittype="ZAKSTT" xmlns="${NS.zkn}">
              <gerelateerde d4p1:entiteittype="STT">
                ${zknEl("zkt.omschrijving", zaak?.zaaktype || "")}
                ${zknEl("volgnummer", "1", { nil: false })}
                ${zknEl("omschrijving", statusOmschrijving(zaak), { nil: false })}
                ${zknEl("omschrijvingGeneriek", "")}
              </gerelateerde>
              ${zknEl("toelichting", "")}
              <datumStatusGezet>${escapeXml(gezet)}</datumStatusGezet>
              <indicatieLaatsteStatus>J</indicatieLaatsteStatus>
            </heeft>`;
}

function zaakXml(zaak, party, data, org) {
  if (!zaak) return "";
  return `<heeftBetrekkingOp d4p1:entiteittype="DCSZAK">
          <gerelateerde d4p1:entiteittype="ZAK">
            ${zknEl("identificatie", zaak.zaaknummer || zaak.id || "", { nil: false })}
            ${zknEl("omschrijving", zaak.titel || "", { nil: false })}
            ${zknEl("toelichting", zaak.omschrijving || "")}
            <resultaat xmlns="${NS.zkn}">
              ${zknEl("omschrijving", "")}
              ${zknEl("toelichting", "", { nil: false })}
            </resultaat>
            ${zknEl("startdatum", stufDate(zaak.startdatum), { nil: false })}
            ${zknEl("registratiedatum", stufDate(zaak.createdAt || zaak.startdatum), { nil: false })}
            ${zknEl("publicatiedatum", "")}
            ${zknEl("einddatumGepland", stufDate(zaak.deadline))}
            ${zknEl("uiterlijkeEinddatum", stufDate(zaak.deadline))}
            ${zknEl("einddatum", "")}
            <opschorting xmlns="${NS.zkn}">
              ${zknEl("indicatie", "")}
              ${zknEl("reden", "")}
            </opschorting>
            <verlenging xmlns="${NS.zkn}">
              ${zknEl("duur", "")}
              ${zknEl("reden", "")}
            </verlenging>
            ${zknEl("betalingsIndicatie", "N.v.t.", { nil: false })}
            ${zknEl("laatsteBetaaldatum", "")}
            ${zknEl("archiefnominatie", "")}
            ${zknEl("datumVernietigingDossier", "")}
            ${zknEl("zaakniveau", "1", { nil: false })}
            ${zknEl("deelzakenIndicatie", "N", { nil: false })}
            ${extraElementenXml(zaak, party, data)}
            ${zaaktypeXml(zaak)}
            ${initiatorXml(party)}
            ${uitvoerendeXml(zaak)}
            ${verantwoordelijkeXml(org)}
            ${statusXml(zaak)}
          </gerelateerde>
        </heeftBetrekkingOp>`;
}

function documentXml(recipe, zaak, actor, job) {
  const today = stufDate(new Date().toISOString().slice(0, 10));
  const auteur = actor?.naam || [actor?.voornaam, actor?.achternaam].filter(Boolean).join(" ") || actor?.email || "";
  return `<isSpecificatieVan d4p1:entiteittype="DCSEDC">
          <gerelateerde d4p1:entiteittype="EDC">
            ${zknEl("identificatie", job?.id || "", { nil: false })}
            ${zknEl("dct.omschrijving", recipe?.name || "", { nil: false })}
            ${zknEl("creatiedatum", today, { nil: false })}
            ${zknEl("titel", recipe?.name || zaak?.titel || "", { nil: false })}
            ${zknEl("beschrijving", recipe?.name || zaak?.omschrijving || "", { nil: false })}
            ${zknEl("versie", "0.1", { nil: false })}
            ${zknEl("status", "In bewerking", { nil: false })}
            ${zknEl("vertrouwelijkAanduiding", "INTERN", { nil: false })}
            ${zknEl("auteur", auteur, { nil: false })}
          </gerelateerde>
        </isSpecificatieVan>`;
}

function actorGebruiker(actor) {
  if (!actor || typeof actor !== "object") return "";
  const naam = [actor.voornaam, actor.achternaam].filter(Boolean).join(" ").trim();
  return String(actor.email || actor.azureEmail || actor.personeelsnummer || actor.naam || naam || "").trim();
}

function resolveZenderGebruiker(settings, actor) {
  const configured = String(asStuf(settings).zenderGebruiker || "").trim();
  return configured || actorGebruiker(actor);
}

function stuurgegevensXml(settings, { berichtcode, functie, referentienummer, crossRef, actor } = {}) {
  const stuf = asStuf(settings);
  const gebruiker = resolveZenderGebruiker(stuf, actor);
  return `<stuurgegevens>
        ${stufEl("berichtcode", berichtcode)}
        <zender xmlns="${NS.stuf}">
          ${stufEl("organisatie", stuf.zenderOrganisatie)}
          ${stufEl("applicatie", stuf.zenderApplicatie || "Zaakhub")}
          ${stufEl("administratie", stuf.zenderAdministratie)}
          ${stufEl("gebruiker", gebruiker)}
        </zender>
        <ontvanger xmlns="${NS.stuf}">
          ${stufEl("organisatie", stuf.ontvangerOrganisatie)}
          ${stufEl("applicatie", stuf.ontvangerApplicatie || "OmniDocs Create")}
        </ontvanger>
        ${stufEl("referentienummer", referentienummer)}
        ${stufEl("crossRefnummer", crossRef)}
        ${stufEl("tijdstipBericht", stufTimestamp())}
        ${stufEl("functie", functie)}
      </stuurgegevens>`;
}

function soapEnvelope(inner) {
  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="${NS.soap}" xmlns:xsi="${NS.xsi}" xmlns:xsd="${NS.xsd}">
  <soap:Body>
    ${inner}
  </soap:Body>
</soap:Envelope>`;
}

function buildStartRequest({ settings, job, recipe, zaak, party, data, actor, org, referentienummer }) {
  const jobId = job?.id || "";
  const specId = randomUUID();
  const inner = `<verzoekStartenDocumentcreatieDi02 xmlns="${NS.dcr}">
      ${stuurgegevensXml(settings, {
        berichtcode: "Di02",
        functie: "StartenDocumentcreatie",
        referentienummer,
        actor,
      })}
      <parameters>
        <sjabloonidentificatie>${escapeXml(recipe?.itemId || "")}</sjabloonidentificatie>
        <jobidentificatie>${escapeXml(jobId)}</jobidentificatie>
      </parameters>
      <documentspecificatie d4p1:entiteittype="DCS" xmlns:d4p1="${NS.stuf}">
        <identificatie>${escapeXml(specId)}</identificatie>
        ${zaakXml(zaak, party, data, org)}
        ${documentXml(recipe, zaak, actor, job)}
      </documentspecificatie>
    </verzoekStartenDocumentcreatieDi02>`;
  return soapEnvelope(inner);
}

function buildBv03({ settings, referentienummer, crossRef, actor }) {
  return soapEnvelope(`<Bv03Bericht xmlns="${NS.stuf}">
      ${stuurgegevensXml(settings, {
        berichtcode: "Bv03",
        functie: "OntvangDocumentcreatieResultaat",
        referentienummer,
        crossRef,
        actor,
      })}
    </Bv03Bericht>`);
}

function buildFault(message, code = "soap:Client") {
  return soapEnvelope(`<soap:Fault>
      <faultcode>${escapeXml(code)}</faultcode>
      <faultstring>${escapeXml(message || "StUF-DCR fout")}</faultstring>
    </soap:Fault>`);
}

function soapResponse(xml, status = 200) {
  return {
    status,
    contentType: "text/xml; charset=utf-8",
    body: xml,
  };
}

async function startDocumentcreatie(settings, xml, extraHeaders = {}) {
  const stuf = asStuf(settings);
  if (!stuf.dcaUrl) throw new Error("StUF-DCR DCA-endpoint ontbreekt");
  const headers = {
    "Content-Type": "text/xml; charset=utf-8",
    Accept: "text/xml, application/xml, application/soap+xml",
    SOAPAction: `"${stuf.soapAction || SOAP_ACTION_START}"`,
    ...extraHeaders,
  };
  const posted = await postSoap(stuf.dcaUrl, {
    body: xml,
    headers,
    tls: outboundTlsOptions(stuf),
  });
  const parsed = parseResult(posted.text);
  if (posted.status < 200 || posted.status >= 300 || parsed.kind === "fault") {
    throw new Error(parsed.message || posted.text.slice(0, 400) || `StUF-DCR ${posted.status}`);
  }
  return parsed;
}

function inboundKind(xml) {
  const parsed = parseResult(xml);
  return parsed.kind;
}

module.exports = {
  NS,
  SOAP_ACTION_START,
  JOB_STATUS,
  readSettings,
  stufSettings,
  fromInput,
  saveStufSettings,
  verifyInboundClientCert,
  asStuf,
  configured,
  enabled,
  stufSummary,
  publicOrigin,
  publicCallbackUrl,
  clipXml,
  parseResult,
  jobOutcome,
  partyFromTarget,
  buildStartRequest,
  resolveZenderGebruiker,
  buildBv03,
  buildFault,
  soapResponse,
  startDocumentcreatie,
  inboundKind,
  fileFromBlob,
  mimeFromFormaat,
  parseTemplateLines,
  templatesText,
};
