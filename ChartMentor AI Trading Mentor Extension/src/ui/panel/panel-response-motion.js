const CHARTMENTOR_THINKING_EXIT_MS = 160;
const RESPONSE_REVEAL_MAX_ROOTS = 16;
const RESPONSE_REVEAL_MAX_CHUNKS = 48;
const RESPONSE_REVEAL_MAX_DELAY_MS = 620;

function createChartMentorThinkingIndicator() {
  const indicator = document.createElement("span");
  indicator.className = "chartmentor-thinking-indicator";
  indicator.setAttribute("aria-hidden", "true");
  for (let index = 0; index < 3; index += 1) {
    indicator.appendChild(document.createElement("span"));
  }
  return indicator;
}

function completeActiveAssistantReveals() {
  document
    .querySelectorAll(".message.response-revealing")
    .forEach((message) => message.classList.add("response-reveal-complete"));
}

function updateChartMentorThinking(id, label) {
  const element = document.getElementById(id);
  const labelEl = element?.querySelector(".loading-phase");
  const nextLabel = String(label || "Thinking with your context").trim();
  if (!labelEl || labelEl.textContent === nextLabel) return element || null;

  labelEl.textContent = nextLabel;
  if (!prefersReducedMotion()) {
    labelEl.classList.remove("is-changing");
    void labelEl.offsetWidth;
    labelEl.classList.add("is-changing");
  }
  return element;
}

function showChartMentorThinking({ id, label, parent, className = "" }) {
  if (!id || !parent) return null;
  completeActiveAssistantReveals();

  const existing = document.getElementById(id);
  if (existing && !existing.classList.contains("is-leaving")) {
    updateChartMentorThinking(id, label);
    return existing;
  }
  existing?.remove();

  const element = document.createElement("div");
  element.id = id;
  element.className = [
    "message assistant loading chartmentor-thinking",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  element.setAttribute("role", "status");
  element.setAttribute("aria-live", "polite");
  element.setAttribute("aria-atomic", "true");

  const content = document.createElement("div");
  content.className = "message-content";
  content.appendChild(createChartMentorThinkingIndicator());

  const phase = document.createElement("span");
  phase.className = "loading-phase";
  phase.textContent = String(label || "Thinking with your context").trim();
  content.appendChild(phase);
  element.appendChild(content);
  parent.appendChild(element);
  return element;
}

function dismissChartMentorThinking(id, { animate = false } = {}) {
  const element = document.getElementById(id);
  if (!element) return null;
  if (element.classList.contains("is-leaving")) return element;
  if (!animate || prefersReducedMotion()) {
    element.remove();
    return null;
  }

  element.classList.add("is-leaving");
  element.setAttribute("aria-live", "off");
  const remove = () => element.remove();
  element.addEventListener("animationend", remove, { once: true });
  window.setTimeout(remove, CHARTMENTOR_THINKING_EXIT_MS + 40);
  return element;
}

function splitResponseRevealText(value, maxChunks = 5) {
  const text = String(value || "");
  if (!text.trim()) return [text];

  const leadingSpace = text.match(/^\s+/)?.[0] || "";
  const words = text.slice(leadingSpace.length).match(/\S+\s*/g) || [];
  const chunks = [];
  let chunk = leadingSpace;
  let wordCount = 0;

  words.forEach((word, index) => {
    chunk += word;
    wordCount += 1;
    const closesPhrase = /[.!?;:]\s*$/.test(word);
    const hasMoreWords = index < words.length - 1;
    if (
      hasMoreWords &&
      chunks.length < maxChunks - 1 &&
      ((closesPhrase && wordCount >= 2) || wordCount >= 4)
    ) {
      chunks.push(chunk);
      chunk = "";
      wordCount = 0;
    }
  });
  if (chunk) chunks.push(chunk);
  return chunks;
}

function getResponseRevealTextNodes(root) {
  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        if (!node.textContent?.trim()) return NodeFilter.FILTER_REJECT;
        if (
          node.parentElement?.closest(
            "table, code, button, .response-text-chunk",
          )
        ) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    },
  );
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  return nodes;
}

function setResponseRevealDelay(element, index) {
  const delay = Math.min(52 + index * 28, RESPONSE_REVEAL_MAX_DELAY_MS);
  element.style.setProperty("--response-reveal-delay", `${delay}ms`);
}

function prepareAssistantResponseReveal(message, { restored = false } = {}) {
  if (!message || restored || prefersReducedMotion()) return false;
  const content = message.querySelector(".message-content");
  if (!content) return false;

  message.classList.add("response-revealing");
  const roots = Array.from(
    content.querySelectorAll("h1, h2, h3, p, li, blockquote"),
  );
  if (roots.length === 0 && content.textContent?.trim()) roots.push(content);

  let revealIndex = 0;
  roots.forEach((root, rootIndex) => {
    if (rootIndex >= RESPONSE_REVEAL_MAX_ROOTS) {
      root.classList.add("response-reveal-block");
      setResponseRevealDelay(root, revealIndex);
      revealIndex += 1;
      return;
    }

    const plans = getResponseRevealTextNodes(root).map((node) => ({
      node,
      chunks: splitResponseRevealText(node.textContent),
    }));
    const chunkCount = plans.reduce(
      (total, plan) => total + plan.chunks.length,
      0,
    );
    if (!chunkCount || revealIndex + chunkCount > RESPONSE_REVEAL_MAX_CHUNKS) {
      root.classList.add("response-reveal-block");
      setResponseRevealDelay(root, revealIndex);
      revealIndex += 1;
      return;
    }

    plans.forEach(({ node, chunks }) => {
      const fragment = document.createDocumentFragment();
      chunks.forEach((chunk) => {
        const span = document.createElement("span");
        span.className = "response-text-chunk";
        span.textContent = chunk;
        setResponseRevealDelay(span, revealIndex);
        revealIndex += 1;
        fragment.appendChild(span);
      });
      node.replaceWith(fragment);
    });
  });

  content.querySelectorAll("table").forEach((table) => {
    table.classList.add("response-reveal-block");
    setResponseRevealDelay(table, revealIndex);
    revealIndex += 1;
  });
  message.querySelectorAll(":scope > .chat-action-card").forEach((actions) => {
    actions.classList.add("response-reveal-block");
    setResponseRevealDelay(actions, revealIndex);
    revealIndex += 1;
  });
  return revealIndex > 0;
}
