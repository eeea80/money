function sanitizeScanResultText(value) {
  if (typeof value !== "string") return "";
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^\s{0,3}#{1,6}\s*/g, "")
    .replace(
      /^(?:setup\s*scan|chart\s*scan|scan|analysis|mentor\s*summary)\s*[:\-–—]?\s*/i,
      "",
    )
    .replace(
      /^(?:watch\s*trigger|no\s*clean\s*trigger|signal)\b\s*[:\-–—]?\s*/i,
      "",
    )
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^\s*[-*]\s+/gm, "")
    .replace(/[#*_`]+/g, "")
    .replace(/^\s*[:;|,\-–—]+\s*/, "")
    .replace(/\.{3,}|…/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[:;|,\-–—\s]+$/, "")
    .trim();
}

function toCompleteScanSentence(value, fallback = "", maxLength = 320) {
  const clean =
    sanitizeScanResultText(value) || sanitizeScanResultText(fallback);
  if (!clean) return "";

  const complete = clean.match(/^(.+?[.!?])(?:\s|$)/)?.[1]?.trim();
  if (complete && complete.length <= maxLength) return complete;
  if (clean.length <= maxLength) {
    return /[.!?]$/.test(clean) ? clean : `${clean}.`;
  }

  const clipped = clean.slice(0, maxLength + 1);
  const punctuation = Math.max(
    clipped.lastIndexOf(". "),
    clipped.lastIndexOf("! "),
    clipped.lastIndexOf("? "),
  );
  if (punctuation >= 80) return clipped.slice(0, punctuation + 1).trim();
  const wordBoundary = clipped.lastIndexOf(" ");
  const shortened = clipped
    .slice(0, wordBoundary >= 120 ? wordBoundary : maxLength)
    .replace(/[,:;\-–—\s]+$/, "")
    .trim();
  return shortened ? `${shortened}.` : "";
}

function scanTextsMatch(left, right) {
  const normalize = (value) =>
    sanitizeScanResultText(value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  const a = normalize(left);
  const b = normalize(right);
  return Boolean(a && b && (a === b || a.includes(b) || b.includes(a)));
}

function normalizeExactScanPrice(value) {
  const raw = typeof value === "string" ? value.trim().replace(/\s/g, "") : "";
  if (!raw) return "";
  const normalized = raw.includes(".")
    ? raw.replace(/,/g, "")
    : /^\d{1,3}(?:,\d{3})+$/.test(raw)
      ? raw.replace(/,/g, "")
      : raw;
  return /^\d+(?:\.\d+)?$/.test(normalized) ? normalized : "";
}

function getFirstVisiblePriceLevel(text) {
  const cleanText = normalizePanelText(text);
  const match = cleanText.match(
    /\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b|\b\d+(?:\.\d+)?\b/,
  );
  return match ? match[0] : "";
}

