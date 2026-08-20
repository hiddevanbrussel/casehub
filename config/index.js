const path = require("path");

const root = path.join(__dirname, "..");

module.exports = {
  port: Number(process.env.PORT) || 3000,
  sessionSecret: process.env.SESSION_SECRET || "zaakhub-dev-secret-wijzig-in-productie",
  dataDir: process.env.DATA_DIR || path.join(root, "data"),
  orgName: process.env.ORG_NAME || "Zaakhub",
  cookieName: "zaakhub",
  sessionDays: 7,
};