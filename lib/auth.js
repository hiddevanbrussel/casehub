const config = require("../config");
const { readSession, signSession } = require("../lib/crypto");
const {
  currentStore,
  PLATFORM_SESSION,
  platformUser,
  publicPlatformUser,
} = require("../lib/db");

function isGlobalAdmin(user) {
  return Boolean(user && user.rol === "global_admin");
}

function isWorkspaceAdmin(user) {
  return Boolean(user && user.rol === "admin");
}

function isAdmin(user) {
  return isWorkspaceAdmin(user) || isGlobalAdmin(user);
}

function currentUser(req) {
  const token = req.cookies?.[config.cookieName];
  const session = readSession(token);
  if (!session) return null;
  if (session.tenant === PLATFORM_SESSION) {
    return publicPlatformUser(platformUser(session.id));
  }
  const tenant = req.store || currentStore();
  if (!tenant) return null;
  if (session.tenant && tenant.slug && session.tenant !== tenant.slug) return null;
  return tenant.werknemer(session.id);
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
    if (isGlobalAdmin(req.user)) return next();
    if (!req.user || !roles.includes(req.user.rol)) {
      return res.status(403).render("fout", {
        title: req.t("error.forbidden"),
        message: req.t("error.forbiddenMsg"),
      });
    }
    next();
  };
}

function requireGlobalAdmin(req, res, next) {
  if (!isGlobalAdmin(req.user)) {
    return res.status(403).render("fout", {
      title: req.t("error.forbidden"),
      message: req.t("error.forbiddenMsg"),
    });
  }
  next();
}

function setSessionCookie(res, werknemerId, tenant) {
  const exp = Date.now() + config.sessionDays * 86400000;
  res.cookie(config.cookieName, signSession(werknemerId, exp, tenant), {
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
  return Boolean(user && (["admin", "zaakmanager"].includes(user.rol) || isGlobalAdmin(user)));
}

module.exports = {
  currentUser,
  requireAuth,
  requireRole,
  requireGlobalAdmin,
  setSessionCookie,
  clearSessionCookie,
  canWriteMaster,
  isAdmin,
  isWorkspaceAdmin,
  isGlobalAdmin,
};
