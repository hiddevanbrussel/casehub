const THEMES = ["light", "dark"];

function parseTheme(value) {
  return THEMES.includes(String(value || "").toLowerCase()) ? String(value).toLowerCase() : "light";
}

function themeMiddleware(req, res, next) {
  const theme = parseTheme(req.cookies?.theme);
  req.theme = theme;
  res.locals.theme = theme;
  next();
}

module.exports = { THEMES, parseTheme, themeMiddleware };
