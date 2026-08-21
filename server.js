const path = require("path");
const express = require("express");
const layouts = require("express-ejs-layouts");
const cookieParser = require("cookie-parser");
const config = require("./config");
const { store, seedIfEmpty } = require("./lib/db");
const { formatDate, formatDateTime, fullName } = require("./lib/format");
const { currentUser, canWriteMaster } = require("./lib/auth");
const { i18nMiddleware } = require("./lib/i18n");
const { isHr, isCases, appProfile } = require("./lib/profile");
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
app.use(cookieParser());
app.use(i18nMiddleware);
app.use(layouts);
app.use("/public", express.static(path.join(__dirname, "public")));

app.use((req, res, next) => {
  const user = currentUser(req);
  req.user = user;
  res.locals.user = user;
  res.locals.meta = store.meta();
  res.locals.isHr = isHr(store.meta());
  res.locals.isCases = isCases(store.meta());
  res.locals.appProfile = appProfile(store.meta());
  res.locals.canWriteEmployees = isHr(store.meta()) ? canWriteMaster(user) : user?.rol === "admin";
  res.locals.toast = req.query.toast || "";
  res.locals.path = req.path;
  res.locals.formatDate = (value) => formatDate(value, req.lang);
  res.locals.formatDateTime = (value) => formatDateTime(value, req.lang);
  res.locals.fullName = fullName;
  res.locals.navActive = (prefix) => (req.path === prefix || req.path.startsWith(`${prefix}/`) ? "is-active" : "");
  next();
});

app.use(routes());

app.use((_req, res) => {
  res.status(404).render("fout", { title: res.locals.t("error.notFound"), message: res.locals.t("error.notFoundPage") });
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).render("fout", {
    title: res.locals.t("error.title"),
    message: res.locals.t("error.server"),
  });
});

app.listen(config.port, () => {
  console.log(`Zaakhub luistert op poort ${config.port}`);
});
