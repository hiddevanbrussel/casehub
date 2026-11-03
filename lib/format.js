const { DateTimeFormat } = Intl;

const INTLmap = { en: "en-GB", da: "da-DK", de: "de-DE", nl: "nl-NL" };

function nowIso() {
  return new Date().toISOString();
}

function formatDate(value, lang = "en") {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new DateTimeFormat(INTLmap[lang] || "en-GB", { day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
}

function formatDateLong(value, lang = "en") {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new DateTimeFormat(INTLmap[lang] || "en-GB", { day: "numeric", month: "short", year: "numeric" })
    .format(date)
    .replace(".", "");
}

function formatDateTime(value, lang = "en") {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new DateTimeFormat(INTLmap[lang] || "en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

function formatDateTimeShort(value, lang = "en") {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new DateTimeFormat(INTLmap[lang] || "en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function formatTime(value, lang = "en") {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new DateTimeFormat(INTLmap[lang] || "en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function dayBucket(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "other";
  const start = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((start(new Date()) - start(date)) / 86400000);
  if (diff === 0) return "today";
  if (diff === 1) return "yesterday";
  return "other";
}

function slugFile(name) {
  return String(name || "bestand")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .slice(0, 120);
}

function ymdToday() {
  const date = new Date();
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function ymdAddDays(ymd, days) {
  const match = String(ymd || "").slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return "";
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  date.setDate(date.getDate() + (Number(days) || 0));
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function includesQ(haystack, q) {
  if (!q) return true;
  return String(haystack || "")
    .toLowerCase()
    .includes(String(q).toLowerCase());
}

function fullName(record) {
  if (!record) return "—";
  return [record.voornaam, record.tussenvoegsel, record.achternaam].filter(Boolean).join(" ") || "—";
}

function firstName(record) {
  if (!record) return "";
  if (record.voornaam) return String(record.voornaam).trim();
  return String(record.naam || "")
    .split(/\s+/)
    .filter(Boolean)[0] || "";
}

function monthLabel(year, monthIndex, lang = "en") {
  return new DateTimeFormat(INTLmap[lang] || "en-GB", { month: "short" })
    .format(new Date(year, monthIndex, 1))
    .replace(".", "");
}

function parseStreet(adres) {
  const text = String(adres || "").trim();
  if (!text) return { straat: "", huisnummer: "" };
  const match = text.match(/^(.*?)[\s,]+(\d+[a-zA-Z]?)$/);
  if (match) return { straat: match[1].trim(), huisnummer: match[2].trim() };
  return { straat: text, huisnummer: "" };
}

const STATUSSEN = [
  { id: "nieuw", label: "New" },
  { id: "in_behandeling", label: "In progress" },
  { id: "wacht_op_info", label: "Waiting" },
  { id: "afgerond", label: "Closed" },
  { id: "geannuleerd", label: "Cancelled" },
];

const PRIORITEITEN = [
  { id: "laag", label: "Low" },
  { id: "normaal", label: "Normal" },
  { id: "hoog", label: "High" },
  { id: "urgent", label: "Urgent" },
];

const ROLLEN = [
  { id: "admin", label: "Administrator" },
  { id: "zaakmanager", label: "Case manager" },
  { id: "medewerker", label: "Employee" },
];

function overviewGroup(status) {
  if (status === "in_behandeling") return "progress";
  if (status === "afgerond" || status === "geannuleerd") return "closed";
  return "open";
}

function progressOf(zaak) {
  if (zaak.voortgang === 0 || zaak.voortgang) return Math.max(0, Math.min(100, Number(zaak.voortgang) || 0));
  if (zaak.status === "afgerond") return 100;
  if (zaak.status === "in_behandeling") return 55;
  if (zaak.status === "wacht_op_info") return 25;
  return 0;
}

const OVERVIEW_GROUPS = [
  { id: "open", label: "Open", statuses: ["nieuw", "wacht_op_info"] },
  { id: "progress", label: "In progress", statuses: ["in_behandeling"] },
  { id: "closed", label: "Closed", statuses: ["afgerond", "geannuleerd"] },
];

const PERSON_GROUPS = [
  { id: "active", label: "Active" },
  { id: "anon", label: "Anonymised" },
];

const COMPANY_GROUPS = [
  { id: "linked", label: "With cases" },
  { id: "idle", label: "No cases" },
];

function parseView(value) {
  return value === "board" || value === "table" ? value : "overview";
}

function labelOf(list, id) {
  return list.find((item) => item.id === id)?.label || id || "—";
}

module.exports = {
  nowIso,
  formatDate,
  formatDateLong,
  formatDateTime,
  formatDateTimeShort,
  formatTime,
  dayBucket,
  slugFile,
  ymdToday,
  ymdAddDays,
  includesQ,
  fullName,
  firstName,
  monthLabel,
  parseStreet,
  STATUSSEN,
  PRIORITEITEN,
  ROLLEN,
  OVERVIEW_GROUPS,
  PERSON_GROUPS,
  COMPANY_GROUPS,
  overviewGroup,
  progressOf,
  parseView,
  labelOf,
};
