const NS = {
  soap: "http://schemas.xmlsoap.org/soap/envelope/",
  stuf: "http://www.egem.nl/StUF/StUF0301",
  zkn: "http://www.egem.nl/StUF/sector/zkn/0310",
  bg: "http://www.egem.nl/StUF/sector/bg/0310",
  dcr: "http://www.egem.nl/StUF/sector/dcr/0310",
  xsi: "http://www.w3.org/2001/XMLSchema-instance",
};

const SOAP_ACTION_START =
  "http://www.egem.nl/StUF/sector/dcr/0310/verzoekStartenDocumentcreatieDi02";

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

function xmlName(key) {
  const raw = String(key || "").replace(/[^\w.-]/g, "");
  if (!raw) return "";
  return /^\d/.test(raw) ? `n${raw}` : raw;
}

function tag(name, value) {
  if (value == null || value === false) return "";
  if (value === "") return "";
  if (Array.isArray(value)) return value.map((item) => tag(name, item)).join("");
  if (typeof value === "object") {
    const inner = Object.entries(value)
      .map(([key, item]) => tag(xmlName(key), item))
      .join("");
    return inner ? `<${name}>${inner}</${name}>` : "";
  }
  return `<${name}>${escapeXml(value)}</${name}>`;
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

function readSettings(meta = {}) {
  const stuf = meta.stufDcr || {};
  return {
    enabled: stuf.enabled === true,
    dcaUrl: stripSlash(stuf.dcaUrl || process.env.STUF_DCR_DCA_URL || ""),
    soapAction: String(stuf.soapAction || process.env.STUF_DCR_SOAP_ACTION || "").trim(),
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
  };
}

function fromInput(input, current = {}) {
  const enabledValue = Array.isArray(input.stufEnabled) ? input.stufEnabled[input.stufEnabled.length - 1] : input.stufEnabled;
  return {
    enabled: enabledValue === true || enabledValue === "1" || enabledValue === "on" || enabledValue === "ja",
    dcaUrl: stripSlash(input.stufDcaUrl || ""),
    soapAction: String(input.stufSoapAction || "").trim(),
    ontvangerOrganisatie: String(input.stufOntvangerOrganisatie || "").trim(),
    ontvangerApplicatie: String(input.stufOntvangerApplicatie || current.ontvangerApplicatie || "OmniDocs Create").trim(),
    zenderOrganisatie: String(input.stufZenderOrganisatie || "").trim(),
    zenderApplicatie: String(input.stufZenderApplicatie || current.zenderApplicatie || "Zaakhub").trim(),
    zenderAdministratie: String(input.stufZenderAdministratie || "").trim(),
    zenderGebruiker: String(input.stufZenderGebruiker || "").trim(),
    lastResultAt: current.lastResultAt || "",
    lastResultStatus: current.lastResultStatus || "",
    lastResultPath: current.lastResultPath || "",
    lastResultDetail: current.lastResultDetail || "",
  };
}

function enabled(settings) {
  const stuf = settings?.stufDcr || {};
  return Boolean(stuf.enabled && stuf.dcaUrl);
}

function publicCallbackUrl(origin, slug) {
  const base = stripSlash(origin || "");
  if (!base || !slug) return "";
  return `${base}/api/stuf-dcr/${encodeURIComponent(slug)}`;
}

function clipXml(xml, max = 4000) {
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

function adresXml(prefix, source) {
  if (!source) return "";
  const huis = splitHuisnummer(source.huisnummer);
  return [
    tag(`${prefix}:aoa.identificatie`, source.nummer || source.id || ""),
    tag(`${prefix}:wpl.woonplaatsNaam`, source.plaats || ""),
    tag(`${prefix}:gor.openbareRuimteNaam`, source.straat || ""),
    tag(`${prefix}:aoa.postcode`, String(source.postcode || "").replace(/\s+/g, "").toUpperCase()),
    tag(`${prefix}:aoa.huisnummer`, huis.huisnummer),
    tag(`${prefix}:aoa.huisletter`, huis.huisletter),
    tag(`${prefix}:aoa.huisnummertoevoeging`, huis.toevoeging),
  ].join("");
}

function betrokkeneXml(party) {
  if (party.persoon) {
    const persoon = party.persoon;
    return `<DCR:heeft><StUF:entiteittype>DCSSUB</StUF:entiteittype><ZKN:gerelateerde StUF:entiteittype="BTR">
      <BG:inp.bsn xsi:nil="true"/>
      <BG:geslachtsnaam>${escapeXml(persoon.achternaam || "")}</BG:geslachtsnaam>
      ${tag("BG:voorvoegselGeslachtsnaam", persoon.tussenvoegsel || "")}
      ${tag("BG:voornamen", persoon.voornaam || "")}
      ${tag("BG:geslachtsaanduiding", persoon.geslacht || "")}
      ${tag("BG:geboortedatum", stufDate(persoon.geboortedatum))}
      ${tag("BG:sub.emailadres", persoon.email || "")}
      ${tag("BG:sub.telefoonnummer", persoon.telefoon || "")}
      <BG:verblijfsadres>${adresXml("BG", persoon)}</BG:verblijfsadres>
    </ZKN:gerelateerde>${tag("DCR:aard", "Betrokkene")}</DCR:heeft>`;
  }
  if (party.bedrijf) {
    const bedrijf = party.bedrijf;
    return `<DCR:heeft><StUF:entiteittype>DCSSUB</StUF:entiteittype><ZKN:gerelateerde StUF:entiteittype="BTR">
      ${tag("BG:sub.nnpId", bedrijf.kvk || bedrijf.nummer || bedrijf.id || "")}
      ${tag("BG:statutaireNaam", bedrijf.handelsnaam || bedrijf.naam || "")}
      ${tag("BG:sub.emailadres", bedrijf.email || "")}
      ${tag("BG:sub.telefoonnummer", bedrijf.telefoon || "")}
      <BG:bezoekadres>${adresXml("BG", bedrijf)}</BG:bezoekadres>
    </ZKN:gerelateerde>${tag("DCR:aard", "Betrokkene")}</DCR:heeft>`;
  }
  return "";
}

function zaakXml(zaak) {
  if (!zaak) return "";
  return `<DCR:heeftBetrekkingOp><ZKN:gerelateerde StUF:entiteittype="ZAK">
    ${tag("ZKN:identificatie", zaak.zaaknummer || zaak.id || "")}
    ${tag("ZKN:omschrijving", zaak.titel || "")}
    ${tag("ZKN:startdatum", stufDate(zaak.startdatum))}
    ${tag("ZKN:einddatumGepland", stufDate(zaak.deadline))}
    ${tag("ZKN:registratiedatum", stufDate(zaak.createdAt || zaak.startdatum))}
  </ZKN:gerelateerde></DCR:heeftBetrekkingOp>`;
}

function documentXml(recipe, zaak) {
  return `<DCR:isSpecificatieVan><ZKN:gerelateerde StUF:entiteittype="EDC">
    ${tag("ZKN:identificatie", recipe?.itemId || "")}
    ${tag("ZKN:dct.omschrijving", recipe?.name || "")}
    ${tag("ZKN:titel", recipe?.name || zaak?.titel || "")}
    ${tag("ZKN:beschrijving", zaak?.omschrijving || "")}
    ${tag("ZKN:formaat", "pdf")}
    ${tag("ZKN:creatiedatum", stufDate(new Date().toISOString().slice(0, 10)))}
  </ZKN:gerelateerde></DCR:isSpecificatieVan>`;
}

function flattenData(value, prefix = "", out = {}) {
  if (value == null || value === "") return out;
  if (Array.isArray(value)) {
    value.forEach((item, index) => flattenData(item, `${prefix}${prefix ? "." : ""}${index}`, out));
    return out;
  }
  if (typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      flattenData(item, `${prefix}${prefix ? "." : ""}${key}`, out);
    }
    return out;
  }
  out[prefix] = value;
  return out;
}

function vrijeInhoudXml(data) {
  const flat = flattenData(data);
  const nodes = Object.entries(flat)
    .filter(([, value]) => value != null && value !== "")
    .map(([key, value]) => `<element naam="${escapeXml(key)}">${escapeXml(value)}</element>`)
    .join("");
  const nested = tag("zaak", data?.zaak || {}) + tag("betrokkene", data?.betrokkene || {});
  return `<DCR:vrijeInhoud>${nested}${nodes}</DCR:vrijeInhoud>`;
}

function stuurgegevensXml(settings, { berichtcode, functie, referentienummer, crossRef, actor, ns = "DCR" } = {}) {
  const stuf = settings.stufDcr || {};
  const gebruiker = stuf.zenderGebruiker || actor?.email || actor?.naam || "";
  return `<${ns}:stuurgegevens>
    <StUF:berichtcode>${escapeXml(berichtcode)}</StUF:berichtcode>
    <StUF:zender>
      ${tag("StUF:organisatie", stuf.zenderOrganisatie)}
      ${tag("StUF:applicatie", stuf.zenderApplicatie || "Zaakhub")}
      ${tag("StUF:administratie", stuf.zenderAdministratie)}
      ${tag("StUF:gebruiker", gebruiker)}
    </StUF:zender>
    <StUF:ontvanger>
      ${tag("StUF:organisatie", stuf.ontvangerOrganisatie)}
      ${tag("StUF:applicatie", stuf.ontvangerApplicatie || "OmniDocs Create")}
    </StUF:ontvanger>
    ${tag("StUF:referentienummer", referentienummer)}
    ${tag("StUF:crossRefnummer", crossRef)}
    <StUF:tijdstipBericht>${stufTimestamp()}</StUF:tijdstipBericht>
    ${tag("StUF:functie", functie)}
  </${ns}:stuurgegevens>`;
}

function soapEnvelope(inner) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="${NS.soap}" xmlns:StUF="${NS.stuf}" xmlns:ZKN="${NS.zkn}" xmlns:BG="${NS.bg}" xmlns:DCR="${NS.dcr}" xmlns:xsi="${NS.xsi}">
  <soapenv:Header/>
  <soapenv:Body>
    ${inner}
  </soapenv:Body>
</soapenv:Envelope>`;
}

function buildStartRequest({ settings, job, recipe, zaak, party, data, actor, referentienummer }) {
  const jobId = job?.id || "";
  const inner = `<DCR:verzoekStartenDocumentcreatieDi02>
    ${stuurgegevensXml(settings, {
      berichtcode: "Di02",
      functie: "StartenDocumentcreatie",
      referentienummer,
      actor,
    })}
    <DCR:parameters>
      ${tag("DCR:sjabloonidentificatie", recipe?.itemId || "")}
      ${tag("DCR:jobidentificatie", jobId)}
    </DCR:parameters>
    <DCR:documentspecificatie StUF:entiteittype="DCS">
      ${tag("DCR:identificatie", jobId)}
      ${tag("DCR:uwKenmerk", zaak?.zaaknummer || "")}
      ${tag("DCR:betreft", recipe?.name || zaak?.titel || "")}
      ${betrokkeneXml(party)}
      ${zaakXml(zaak)}
      ${documentXml(recipe, zaak)}
      ${vrijeInhoudXml(data)}
    </DCR:documentspecificatie>
  </DCR:verzoekStartenDocumentcreatieDi02>`;
  return soapEnvelope(inner);
}

function buildBv03({ settings, referentienummer, crossRef, actor }) {
  return soapEnvelope(`<StUF:Bv03Bericht>
    ${stuurgegevensXml(settings, {
      berichtcode: "Bv03",
      functie: "OntvangDocumentcreatieResultaat",
      referentienummer,
      crossRef,
      actor,
      ns: "StUF",
    })}
  </StUF:Bv03Bericht>`);
}

function buildFault(message, code = "soap:Client") {
  return soapEnvelope(`<soapenv:Fault>
    <faultcode>${escapeXml(code)}</faultcode>
    <faultstring>${escapeXml(message || "StUF-DCR fout")}</faultstring>
  </soapenv:Fault>`);
}

function soapResponse(xml, status = 200) {
  return {
    status,
    contentType: "text/xml; charset=utf-8",
    body: xml,
  };
}

async function startDocumentcreatie(settings, xml, extraHeaders = {}) {
  const stuf = settings.stufDcr || {};
  if (!stuf.dcaUrl) throw new Error("StUF-DCR DCA-endpoint ontbreekt");
  const headers = {
    "Content-Type": "text/xml; charset=utf-8",
    Accept: "text/xml, application/xml, application/soap+xml",
    SOAPAction: `"${stuf.soapAction || SOAP_ACTION_START}"`,
    ...extraHeaders,
  };
  const res = await fetch(stuf.dcaUrl, { method: "POST", headers, body: xml });
  const text = await res.text();
  const parsed = parseResult(text);
  if (!res.ok || parsed.kind === "fault") {
    throw new Error(parsed.message || text.slice(0, 400) || `StUF-DCR ${res.status}`);
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
  fromInput,
  enabled,
  publicCallbackUrl,
  clipXml,
  parseResult,
  jobOutcome,
  partyFromTarget,
  buildStartRequest,
  buildBv03,
  buildFault,
  soapResponse,
  startDocumentcreatie,
  inboundKind,
  fileFromBlob,
  mimeFromFormaat,
};
