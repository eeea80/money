function addSetupScanEmojiToLine(line) {
  if (!String(line || "").trim() || lineHasSetupScanEmoji(line)) return line;

  const emoji = getSetupScanEmojiForLine(line);
  if (!emoji) return line;

  return line.replace(
    /^(\s*(?:#{1,3}\s*|[-*•]\s+|\d+\.\s*|\*\*)?)/,
    `$1${emoji} `,
  );
}

const MESSAGE_HTML_ENTITIES = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeMessageHtml(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (character) => MESSAGE_HTML_ENTITIES[character],
  );
}

function formatSafeInline(value) {
  const escaped = escapeMessageHtml(value);
  return escaped.replace(/\*\*([^*\r\n]+)\*\*/g, "<strong>$1</strong>");
}

const MARKDOWN_TABLE_MAX_COLUMNS = 4;
const MARKDOWN_TABLE_MAX_BODY_ROWS = 12;

// Strips one leading/trailing pipe (the optional outer rail of a Markdown
// table row) then splits on the remaining pipes. Deliberately simple: table
// cells in mentor output are short plain values, never escaped pipes.
function splitMarkdownTableRow(line) {
  let text = line.trim();
  if (text.startsWith("|")) text = text.slice(1);
  if (text.endsWith("|")) text = text.slice(0, -1);
  return text.split("|");
}

function isMarkdownTableSeparatorRow(line) {
  const cells = splitMarkdownTableRow(line);
  if (!cells.length) return false;
  return cells.every((cell) => /^\s*:?-{3,}:?\s*$/.test(cell));
}

function findNextMarkdownTableLine(lines, startIndex) {
  let index = startIndex;
  while (index < lines.length && !lines[index].trim()) index += 1;
  return index;
}

function formatMessageContent(content) {
  content = String(content ?? "");
  content = content.replace(/SIGNAL:\s*NONE/gim, "").replace(/\r\n?/g, "\n");

  const blocks = [];
  let paragraphLines = [];
  let listTag = "";
  let listItems = [];

  const flushParagraph = () => {
    if (!paragraphLines.length) return;
    blocks.push(`<p>${formatSafeInline(paragraphLines.join(" "))}</p>`);
    paragraphLines = [];
  };

  const flushList = () => {
    if (!listTag || !listItems.length) return;
    const items = listItems
      .map((item) => `<li>${formatSafeInline(item)}</li>`)
      .join("");
    blocks.push(`<${listTag}>${items}</${listTag}>`);
    listTag = "";
    listItems = [];
  };

  const lines = content.split("\n");
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed) {
      flushParagraph();
      flushList();
      index += 1;
      continue;
    }

    const headingMatch = line.match(
      /^ {0,3}(#{1,3})[ \t]+(\S(?:.*\S)?)\s*$/,
    );
    if (headingMatch) {
      flushParagraph();
      flushList();
      const level = headingMatch[1].length;
      const headingText = addSetupScanEmojiToLine(line).replace(
        /^ {0,3}#{1,3}[ \t]+/,
        "",
      );
      blocks.push(
        `<h${level}>${formatSafeInline(headingText)}</h${level}>`,
      );
      index += 1;
      continue;
    }

    const unorderedMatch = line.match(
      /^ {0,3}[-*•][ \t]+(\S(?:.*\S)?)\s*$/,
    );
    const orderedMatch = line.match(
      /^ {0,3}\d+\.[ \t]+(\S(?:.*\S)?)\s*$/,
    );
    const listMatch = unorderedMatch || orderedMatch;
    if (listMatch) {
      flushParagraph();
      const nextListTag = unorderedMatch ? "ul" : "ol";
      if (listTag && listTag !== nextListTag) flushList();
      listTag = nextListTag;
      listItems.push(listMatch[1]);
      index += 1;
      continue;
    }

    if (/^ {0,3}\*\*[^*]{2,48}\*\*/.test(line)) {
      flushParagraph();
      flushList();
      blocks.push(
        `<p class="message-section-label">${formatSafeInline(addSetupScanEmojiToLine(trimmed))}</p>`,
      );
      index += 1;
      continue;
    }

    // A table is only ever recognized as a pipe row followed by a valid
    // separator row (dashes, optional colons, same column count). Blank lines
    // are tolerated for legacy persisted responses produced before the backend
    // formatter kept table rows contiguous.
    // Anything short of that - a lone pipe-containing line, a separator with
    // no header, a mismatched column count - falls through to plain escaped
    // paragraph text below, same as any other malformed input.
    if (trimmed.includes("|") && index + 1 < lines.length) {
      const headerCells = splitMarkdownTableRow(trimmed);
      const separatorIndex = findNextMarkdownTableLine(lines, index + 1);
      const nextLine = lines[separatorIndex]?.trim() || "";
      if (
        headerCells.length > 1 &&
        nextLine &&
        isMarkdownTableSeparatorRow(nextLine) &&
        splitMarkdownTableRow(nextLine).length === headerCells.length
      ) {
        flushParagraph();
        flushList();
        const columns = headerCells
          .slice(0, MARKDOWN_TABLE_MAX_COLUMNS)
          .map((cell) => cell.trim());
        const bodyRows = [];
        let bodyIndex = separatorIndex + 1;
        while (bodyIndex < lines.length) {
          const rowIndex = findNextMarkdownTableLine(lines, bodyIndex);
          if (rowIndex >= lines.length) {
            bodyIndex = rowIndex;
            break;
          }
          const rowTrimmed = lines[rowIndex].trim();
          if (!rowTrimmed.includes("|")) {
            bodyIndex = rowIndex;
            break;
          }
          if (bodyRows.length < MARKDOWN_TABLE_MAX_BODY_ROWS) {
            bodyRows.push(
              splitMarkdownTableRow(rowTrimmed)
                .slice(0, MARKDOWN_TABLE_MAX_COLUMNS)
                .map((cell) => cell.trim()),
            );
          }
          bodyIndex = rowIndex + 1;
        }
        const headHtml = `<thead><tr>${columns
          .map((cell) => `<th>${formatSafeInline(cell)}</th>`)
          .join("")}</tr></thead>`;
        const bodyHtml = bodyRows.length
          ? `<tbody>${bodyRows
              .map(
                (cells) =>
                  `<tr>${columns
                    .map(
                      (_, columnIndex) =>
                        `<td>${formatSafeInline(cells[columnIndex] ?? "")}</td>`,
                    )
                    .join("")}</tr>`,
              )
              .join("")}</tbody>`
          : "";
        blocks.push(`<table>${headHtml}${bodyHtml}</table>`);
        index = bodyIndex;
        continue;
      }
    }

    flushList();
    paragraphLines.push(trimmed);
    index += 1;
  }

  flushParagraph();
  flushList();
  return blocks.join("");
}

function getActiveLoadingPhases() {
  const mode = normalizeStoredReviewMode(
    state.currentReviewMode || state.settings?.reviewMode || "signal_generator",
  );
  return LOADING_SEQUENCES[mode] || LOADING_SEQUENCES.signal_generator;
}

function updateLoadingUi(phase) {
  updateChartMentorThinking(
    "chartmentor-typing-bubble",
    phase || "Reading market structure",
  );
}

function removeAnalysisTypingBubble({ animate = false } = {}) {
  dismissChartMentorThinking("chartmentor-typing-bubble", { animate });
}

function showAnalysisTypingBubble() {
  if (!elements.chatMessages) return;

  clearReviewPlaceholder();
  setReviewContentMode(true);
  const phases = getActiveLoadingPhases();
  showChartMentorThinking({
    id: "chartmentor-typing-bubble",
    label: phases[state.loadingPhaseIndex] || phases[0],
    parent: elements.chatMessages,
    className: "analysis-typing-bubble",
  });
  scrollReviewToEnd();
}

function startLoadingSequence() {
  stopLoadingSequence();

  const phases = getActiveLoadingPhases();
  state.loadingPhaseIndex = 0;
  updateLoadingUi(phases[0]);

  state.loadingIntervalId = window.setInterval(() => {
    state.loadingPhaseIndex = (state.loadingPhaseIndex + 1) % phases.length;
    updateLoadingUi(phases[state.loadingPhaseIndex]);
  }, 1_800);
}

function stopLoadingSequence({ animate = false } = {}) {
  if (state.loadingIntervalId) {
    window.clearInterval(state.loadingIntervalId);
    state.loadingIntervalId = null;
  }

  removeAnalysisTypingBubble({ animate });
}

function getPreferredScrollBehavior() {
  const reducedMotionQuery = window.matchMedia?.(
    "(prefers-reduced-motion: reduce)",
  );
  return reducedMotionQuery?.matches ? "auto" : "smooth";
}

function getReviewScrollContainer() {
  const reviewTab = document.getElementById("review-tab");
  if (reviewTab && reviewTab.scrollHeight > reviewTab.clientHeight) {
    return reviewTab;
  }

  return elements.chatMessages || reviewTab;
}

function scrollPanelChildIntoView(child, options = {}) {
  const container = getReviewScrollContainer();
  if (!container || !child) return;

  const containerRect = container.getBoundingClientRect();
  const childRect = child.getBoundingClientRect();
  const targetTop =
    container.scrollTop + childRect.top - containerRect.top - 10;
  const maxTop = Math.max(0, container.scrollHeight - container.clientHeight);

  container.scrollTo({
    top: Math.min(Math.max(0, targetTop), maxTop),
    behavior: options.behavior || getPreferredScrollBehavior(),
  });
}

function scrollReviewToEnd() {
  const container = getReviewScrollContainer();
  if (!container) return;

  container.scrollTo({
    top: container.scrollHeight,
    behavior: getPreferredScrollBehavior(),
  });
}

function shouldKeepNewResponseInView(resultEl) {
  const container = getReviewScrollContainer();
  if (!container || !container.contains(resultEl)) return true;
  const distanceFromEnd =
    container.scrollHeight - container.scrollTop - container.clientHeight;
  const newResultHeight = resultEl.getBoundingClientRect().height;
  return distanceFromEnd - newResultHeight <= 96;
}

function revealAssistantResult(resultEl, options = {}) {
  if (!resultEl) return;

  const shouldAlign = shouldKeepNewResponseInView(resultEl);

  applySequentialReveal(resultEl);
  resultEl.classList.add("response-ready");
  if (!shouldAlign) return;

  const alignResultToStart = () => {
    scrollPanelChildIntoView(resultEl, {
      behavior: options.behavior || "auto",
    });
  };

  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(alignResultToStart);
  });
}

function applySequentialReveal(container) {
  if (!container) return;

  const revealSelector = [
    ".mentor-bubble",
    ".verdict-upgrade-nudge",
    ".mentor-voice-prompt",
    ".scan-result-surface",
    ".situational-awareness-note",
    ".scan-supporting-details",
    ".mentor-message",
    ".feedback-row",
  ].join(",");

  let revealIndex = 0;
  Array.from(container.children).forEach((child) => {
    if (!child.matches(revealSelector)) return;
    child.classList.add("response-reveal-item");
    child.style.setProperty("--response-reveal-index", String(revealIndex));
    revealIndex += 1;
  });
}
