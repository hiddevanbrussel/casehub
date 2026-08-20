const config = require("../config");
const { readSession, signSession } = require("../lib/crypto");
const { store } = require("../lib/db");

function currentUser(req) {
  const token = req.cookies?.[config.cookieName];
  const id = readSession(token);
  if (!id) return null;
  return store.werknemer(id);
}

function requireAuth(req, res, next) {
  const user = currentUser(req);
  if (!user) {
    const nextUrl = encodeURIComponent(req.originalUrl || "/");
    return res.redirect(`/login?next=${nextUrl}`);
  }
  req.user = user;
  res.locals.user = user;
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.rol)) {
      return res.status(403).render("fout", {
        title: req.t("error.forbidden"),
        message: req.t("error.forbiddenMsg"),
      });
    }
    next();
  };
}

function setSessionCookie(res, werknemerId) {
  const exp = Date.now() + config.sessionDays * 86400000;
  res.cookie(config.cookieName, signSession(werknemerId, exp), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.COOKIE_SECURE === "true",
    expires: new Date(exp),
  });
}

function clearSessionCookie(res) {
  res.clearCookie(config.cookieName);
}

function canWriteMaster(user) {
  return user && ["admin", "zaakmanager"].includes(user.rol);
}

module.exports = {
  currentUser,
  requireAuth,
  requireRole,
  setSessionCookie,
  clearSessionCookie,
  canWriteMaster,
};
