function isPdf(file, name) {
  return /pdf/i.test(file?.mime || "") || /\.pdf$/i.test(file?.naam || name || "");
}

function isImage(file, name) {
  return /^image\//i.test(file?.mime || "") || /\.(jpe?g|png|gif|webp)$/i.test(file?.naam || name || "");
}

function formatFileSize(n) {
  const bytes = Number(n) || 0;
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0).replace(".0", "")} kB`;
  return `${(bytes / 1048576).toFixed(1).replace(".0", "")} MB`;
}

function documentRows(owner, { basePath }) {
  const bijlagen = owner?.bijlagen || [];
  const jobs = owner?.documentJobs || [];
  const linked = new Set();
  const rows = [];
  for (const job of jobs) {
    const file = job.bijlageId ? bijlagen.find((item) => item.id === job.bijlageId) : null;
    if (file) linked.add(file.id);
    const done = Boolean(file);
    let status = job.status;
    if (done) status = "success";
    else if (job.status === "error") status = "error";
    else if (job.webhookAt) status = job.webhookStatus === "empty" ? "webhook-empty" : "webhook";
    else if (job.status === "generating") status = "generating";
    else status = "prepared";
    rows.push({
      id: file?.id || job.id,
      name: file
        ? file.naam
        : job.stakeholderName
          ? `${job.recipeName} · ${job.stakeholderName}`
          : job.recipeName,
      size: file ? file.size : 0,
      at: file ? file.at : job.webhookAt || job.updatedAt || job.createdAt,
      fileHref: file ? `${basePath}/bijlagen/${file.id}` : "",
      downloadHref: file ? `${basePath}/bijlagen/${file.id}?download=1` : "",
      isPdf: isPdf(file, job.recipeName),
      isImage: isImage(file, job.recipeName),
      createUrl: done ? "" : job.finalizeUrl || "",
      status,
      webhookUrl: job.webhookUrl || "",
      error: job.status === "error" || job.webhookStatus === "empty" || job.webhookStatus === "auth"
        ? (job.error || job.webhookDetail || "")
        : "",
      deleteHref: file
        ? `${basePath}/bijlagen/${file.id}/verwijderen`
        : `${basePath}/documenten/${job.id}/verwijderen`,
    });
  }
  for (const file of bijlagen) {
    if (linked.has(file.id)) continue;
    rows.push({
      id: file.id,
      name: file.naam,
      size: file.size,
      at: file.at,
      fileHref: `${basePath}/bijlagen/${file.id}`,
      downloadHref: `${basePath}/bijlagen/${file.id}?download=1`,
      isPdf: isPdf(file),
      isImage: isImage(file),
      createUrl: "",
      status: "uploaded",
      error: "",
      deleteHref: `${basePath}/bijlagen/${file.id}/verwijderen`,
    });
  }
  rows.sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")));
  return rows;
}

module.exports = { documentRows, formatFileSize };
