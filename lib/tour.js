function step(id, target, place, title, body) {
  return { id, target, place, title, body };
}

function tourSteps(req, locals) {
  const t = req.t;
  const steps = [
    step("dash", "[data-tour='dash']", "right", t("tour.dashTitle"), t("tour.dashBody")),
  ];
  if (locals.isCases) {
    steps.push(step("cases", "[data-tour='cases']", "right", t("tour.casesTitle"), t("tour.casesBody")));
  }
  if (locals.isHr || (locals.isAdmin && !locals.isHr)) {
    steps.push(step("employees", "[data-tour='employees']", "right", t("tour.employeesTitle"), t("tour.employeesBody")));
  }
  if (locals.isCases) {
    steps.push(step("persons", "[data-tour='persons']", "right", t("tour.personsTitle"), t("tour.personsBody")));
  }
  steps.push(step("search", "[data-tour='search']", "bottom", t("tour.searchTitle"), t("tour.searchBody")));
  if (locals.isCases) {
    steps.push(step("newCase", "[data-tour='new-case']", "left", t("tour.newCaseTitle"), t("tour.newCaseBody")));
  } else if (locals.canWriteEmployees) {
    steps.push(step("newEmployee", "[data-tour='new-employee']", "left", t("tour.newEmployeeTitle"), t("tour.newEmployeeBody")));
  }
  if (locals.isAdmin) {
    steps.push(step("settings", "[data-tour='settings']", "right", t("tour.settingsTitle"), t("tour.settingsBody")));
  }
  return steps;
}

function tourPayload(req, locals) {
  const user = req.user;
  if (!user) return null;
  if (locals.isGlobalAdmin) return null;
  if (req.path !== "/") return null;
  const force = String(req.query.tour || "") === "1";
  if (user.tourDone && !force) return null;
  const steps = tourSteps(req, locals);
  if (!steps.length) return null;
  return {
    skip: req.t("tour.skip"),
    next: req.t("tour.next"),
    back: req.t("tour.back"),
    done: req.t("tour.done"),
    step: req.t("tour.step", { n: "{n}", total: "{total}" }),
    steps,
  };
}

module.exports = { tourPayload, tourSteps };
