const STRUCTURED_FOLLOW_UP_SECTION_LABELS = {
  answer: "💬 Answer",
  evidence: "🧭 Evidence",
  key_levels: "📍 Key levels",
  risk: "⚠️ Risk",
  next_step: "🎯 Next step",
  comparison: "⚖️ Comparison",
};
const STRUCTURED_FOLLOW_UP_TABLE_LABELS = {
  levels: "📊 Levels",
  comparison: "⚖️ Comparison",
};

function cleanStructuredFollowUpText(value, maxLength) {
  let sanitized = "";
  for (const character of String(value ?? "")) {
    const codePoint = character.codePointAt(0) ?? 0;
    sanitized += codePoint <= 31 || codePoint === 127 ? " " : character;
  }
  return sanitized
    .replace(/^\s*(?:#{1,6}|[-*+]\s+|\d+[.)]\s+)/, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function normalizeStructuredFollowUpTable(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (!STRUCTURED_FOLLOW_UP_TABLE_LABELS[value.type]) return null;
  const columns = Array.isArray(value.columns)
    ? value.columns
        .slice(0, 4)
        .map((cell) => cleanStructuredFollowUpText(cell, 80))
    : [];
  if (columns.length < 2 || columns.some((cell) => !cell)) return null;
  const rows = Array.isArray(value.rows)
    ? value.rows
        .slice(0, 12)
        .filter(Array.isArray)
        .map((row) =>
          row
            .slice(0, columns.length)
            .map((cell) => cleanStructuredFollowUpText(cell, 120)),
        )
        .filter(
          (row) => row.length === columns.length && row.some((cell) => cell),
        )
    : [];
  return rows.length ? { type: value.type, columns, rows } : null;
}

function normalizeStructuredFollowUp(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const lead = cleanStructuredFollowUpText(value.lead, 280);
  const sections = Array.isArray(value.sections)
    ? value.sections
        .slice(0, 3)
        .map((section) => {
          const type = String(section?.type || "");
          const bullets = Array.isArray(section?.bullets)
            ? section.bullets
                .slice(0, 4)
                .map((bullet) => cleanStructuredFollowUpText(bullet, 320))
                .filter(Boolean)
            : [];
          return STRUCTURED_FOLLOW_UP_SECTION_LABELS[type] && bullets.length
            ? { type, bullets }
            : null;
        })
        .filter(Boolean)
    : [];
  if (!lead) return null;
  return {
    lead,
    sections,
    table: normalizeStructuredFollowUpTable(value.table),
  };
}

function appendStructuredFollowUpTable(contentEl, tableData) {
  if (!tableData) return;
  const heading = document.createElement("h2");
  heading.textContent = STRUCTURED_FOLLOW_UP_TABLE_LABELS[tableData.type];
  contentEl.appendChild(heading);

  const table = document.createElement("table");
  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");
  tableData.columns.forEach((value) => {
    const cell = document.createElement("th");
    cell.textContent = value;
    headerRow.appendChild(cell);
  });
  thead.appendChild(headerRow);

  const tbody = document.createElement("tbody");
  tableData.rows.forEach((row) => {
    const rowEl = document.createElement("tr");
    row.forEach((value) => {
      const cell = document.createElement("td");
      cell.textContent = value;
      rowEl.appendChild(cell);
    });
    tbody.appendChild(rowEl);
  });
  table.append(thead, tbody);
  contentEl.appendChild(table);
}

function renderStructuredFollowUpContent(contentEl, value) {
  if (!contentEl) return false;
  const normalized = normalizeStructuredFollowUp(value);
  if (!normalized) return false;

  contentEl.dataset.structuredFollowUp = "true";
  const lead = document.createElement("p");
  lead.className = "structured-follow-up-lead";
  lead.textContent = normalized.lead;
  contentEl.appendChild(lead);

  normalized.sections.forEach((section) => {
    const heading = document.createElement("h2");
    heading.textContent = STRUCTURED_FOLLOW_UP_SECTION_LABELS[section.type];
    contentEl.appendChild(heading);
    const list = document.createElement("ul");
    section.bullets.forEach((bullet) => {
      const item = document.createElement("li");
      item.textContent = bullet;
      list.appendChild(item);
    });
    contentEl.appendChild(list);
  });
  appendStructuredFollowUpTable(contentEl, normalized.table);
  return true;
}
