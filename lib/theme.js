const THEMES = ["light", "dark"];
const CHROMES = ["paper", "sage"];

function parseTheme(value) {
  return THEMES.includes(String(value || "").toLowerCase()) ? String(value).toLowerCase() : "light";
}

function parseChrome(value) {
  return CHROMES.includes(String(value || "").toLowerCase()) ? String(value).toLowerCase() : "paper";
}

function themeMiddleware(req, res, next) {
  const theme = parseTheme(req.cookies?.theme);
  req.theme = theme;
  res.locals.theme = theme;
  next();
}

module.exports = { THEMES, CHROMES, parseTheme, parseChrome, themeMiddleware };
