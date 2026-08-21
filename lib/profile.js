function appProfile(meta) {
  const value = String(meta?.appProfile || "cases");
  return ["cases", "hr", "both"].includes(value) ? value : "cases";
}

function isHr(meta) {
  const profile = appProfile(meta);
  return profile === "hr" || profile === "both";
}

function isCases(meta) {
  const profile = appProfile(meta);
  return profile === "cases" || profile === "both";
}

module.exports = { appProfile, isHr, isCases };
