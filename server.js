const path = require("path");
const express = require("express");
const layouts = require("express-ejs-layouts");
const cookieParser = require("cookie-parser");
const config = require("./config");
const {
  seedIfEmpty,
  resolveSlug,
  openTenant,
  runWithStore,
  workspace,
  workspaces,
} = require("./lib/db");
const { formatDate, formatDateLong, formatDateTime, formatDateTimeShort, formatTime, dayBucket, fullName } = require("./lib/format");
const { currentUser, canWriteMaster, isAdmin, isGlobalAdmin } = require("./lib/auth");
const { i18nMiddleware } = require("./lib/i18n");
const { icon } = require("./lib/icon");
const { documentRows, formatFileSize } = require("./lib/docs");
const { themeMiddleware, parseChrome } = require("./lib/theme");
const { isHr, isCases, appProfile } = require("./lib/profile");
const { tourPayload } = require("./lib/tour");
const { routes } = require("./routes");

if (["1", "true", "yes"].includes(String(process.env.SEED_DEMO || "").toLowerCase())) {
  seedIfEmpty();
}

const app = express();
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.set("layout", "layout");
app.set("trust proxy", 1);

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.text({
  type: (req) => /xml|soap/i.test(String(req.headers["content-type"] || "")),
  limit: "25mb",
}));
app.use(cookieParser());
app.use(i18nMiddleware);
app.use(themeMiddleware);
app.use(layouts);
app.use("/public", express.static(path.join(__dirname, "public")));

app.use((req, res, next) => {
  const slug = resolveSlug(req);
  req.workspaceSlug = slug;
  req.workspace = slug ? workspace(slug) : null;
  req.store = slug ? openTenant(slug) : null;
  res.locals.workspace = req.workspace;
  res.locals.workspaces = workspaces();
  const continueRequest = () => {
    const meta = (req.store && req.store.meta()) || { orgName: config.orgName };
    const user = currentUser(req);
    req.user = user;
    res.locals.user = user;
    res.locals.meta = meta;
    res.locals.isHr = isHr(meta);
    res.locals.isCases = isCases(meta);
    res.locals.appProfile = appProfile(meta);
    res.locals.isAdmin = isAdmin(user);
    res.locals.isGlobalAdmin = isGlobalAdmin(user);
    res.locals.canWriteEmployees = isHr(meta) ? canWriteMaster(user) : isAdmin(user);
    res.locals.quickStatusChange = meta.quickStatusChange !== false;
    res.locals.chrome = parseChrome(meta.chrome);
    res.locals.toast = req.query.toast || "";
    res.locals.path = req.path;
    res.locals.formatDate = (value) => formatDate(value, req.lang);
    res.locals.formatDateLong = (value) => formatDateLong(value, req.lang);
    res.locals.formatDateTime = (value) => formatDateTime(value, req.lang);
    res.locals.formatDateTimeShort = (value) => formatDateTimeShort(value, req.lang);
    res.locals.formatTime = (value) => formatTime(value, req.lang);
    res.locals.dayBucket = dayBucket;
    res.locals.fullName = fullName;
    res.locals.navActive = (prefix) => (req.path === prefix || req.path.startsWith(`${prefix}/`) ? "is-active" : "");
    res.locals.icon = icon;
    res.locals.documentRows = documentRows;
    res.locals.formatFileSize = formatFileSize;
    res.locals.tour = tourPayload(req, res.locals);
    next();
  };
  if (req.store) return runWithStore(req.store, continueRequest);
  continueRequest();
});

app.use(routes());

app.use((_req, res) => {
  res.status(404).render("fout", { title: res.locals.t("error.notFound"), message: res.locals.t("error.notFoundPage") });
});

app.use((err, req, res, _next) => {
  console.error(err);
  if (res.headersSent) return;
  if (String(req.path || "").startsWith("/api/stuf-dcr")) {
    const status = err.status || err.statusCode || 500;
    return res.status(status).type("text/xml; charset=utf-8").send(
      `<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body><soapenv:Fault><faultcode>soap:Server</faultcode><faultstring>${String(err.message || "StUF-DCR fout").replace(/[<>&]/g, "")}</faultstring></soapenv:Fault></soapenv:Body></soapenv:Envelope>`
    );
  }
  if (String(req.path || "").startsWith("/api/create/webhook")) {
    const status = err.status || err.statusCode || 500;
    return res.status(status).json({
      ok: false,
      error: err.type === "entity.parse.failed" ? "invalid json" : err.message || "error",
    });
  }
  const translate = typeof res.locals.t === "function" ? res.locals.t : (key) => key;
  if (!res.locals.meta) res.locals.meta = { orgName: config.orgName };
  res.status(500).render("fout", {
    title: translate("error.title"),
    message: translate("error.server"),
    t: translate,
  });
});

app.listen(config.port, () => {
  console.log(`Zaakhub luistert op poort ${config.port}`);
});
