import {
  detectTimeZone,
  getTimeZone,
  setTimeZone,
  timeZoneOptions,
  formatGmt,
  cityName,
} from "../../core/timezone.js";

/**
 * Time zone picker with search, mirroring the one in Obtraders.
 *
 * A native <select> was the first attempt and it does not hold up here: 419
 * zones with no way to search means scrolling to find "Lisbon". This is a
 * combobox — a trigger showing the current offset, a search field, and a
 * filtered list. Preferred markets sit at the top; the rest follow ordered by
 * UTC offset.
 *
 * Keyboard: ArrowUp/ArrowDown move, Enter selects, Esc closes.
 */

const VISIBLE_WITHOUT_QUERY = 80;

export function createTimezonePicker(root, { onChange }) {
  const { preferred, rest } = timeZoneOptions();
  const all = [...preferred, ...rest];

  let open = false;
  let activeIndex = 0;
  let filtered = [];

  // --- trigger ---
  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "tz__trigger";
  trigger.setAttribute("aria-haspopup", "listbox");
  trigger.setAttribute("aria-expanded", "false");
  trigger.dataset.i18nLabel = "header.timezoneLabel";

  // --- popover ---
  const popover = document.createElement("div");
  popover.className = "tz__popover";
  popover.hidden = true;

  const search = document.createElement("input");
  search.type = "search";
  search.className = "tz__search";
  search.autocomplete = "off";
  search.dataset.i18nPlaceholder = "header.timezoneSearch";

  const list = document.createElement("ul");
  list.className = "tz__list";
  list.setAttribute("role", "listbox");

  popover.append(search, list);
  root.append(trigger, popover);

  // --- behaviour ---
  /**
   * Typing "-4" must match "UTC-4". Both the query and the offset are
   * normalized so the typographic minus (−, U+2212) and the ASCII hyphen are
   * treated as the same character — nobody types U+2212.
   */
  function normalize(text) {
    return String(text).toLowerCase().replace(/[−–—]/g, "-").replace(/\s+/g, "");
  }

  function optionsFor(query) {
    const q = normalize(query.trim());
    if (!q) return all.slice(0, VISIBLE_WITHOUT_QUERY);

    return all.filter(
      (option) =>
        normalize(option.city).includes(q) ||
        normalize(option.value).includes(q) ||
        normalize(option.offset).includes(q)
    );
  }

  function renderList() {
    filtered = optionsFor(search.value);
    activeIndex = Math.min(activeIndex, Math.max(filtered.length - 1, 0));

    const active = getTimeZone();
    const fragment = document.createDocumentFragment();

    filtered.forEach((option, index) => {
      const item = document.createElement("li");
      item.className = "tz__option";
      item.setAttribute("role", "option");
      item.dataset.value = option.value;
      item.setAttribute("aria-selected", String(option.value === active));
      if (index === activeIndex) item.dataset.active = "true";

      const city = document.createElement("span");
      city.className = "tz__city";
      city.textContent = option.city;

      const offset = document.createElement("span");
      offset.className = "tz__offset";
      offset.textContent = option.gmt;

      item.append(city, offset);
      item.addEventListener("mousedown", (event) => {
        event.preventDefault(); // keep focus in the search field
        choose(option.value);
      });

      fragment.append(item);
    });

    list.replaceChildren(fragment);
  }

  function choose(zone) {
    // The detected zone is stored as "automatic" so travelling still works.
    setTimeZone(zone === detectTimeZone() ? null : zone);
    renderTrigger();
    close();
    onChange();
  }

  /** "GMT +01:00 Lisbon ⌄" — same shape Obtraders shows. */
  function renderTrigger() {
    const zone = getTimeZone();

    const text = document.createElement("span");
    text.className = "tz__value";
    text.textContent = `${formatGmt(zone)} ${cityName(zone)}`;

    trigger.replaceChildren(text, chevron());
    trigger.title = zone.replace(/_/g, " ");
  }

  function chevron() {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", "14");
    svg.setAttribute("height", "14");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    svg.classList.add("tz__chevron");

    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "m6 9 6 6 6-6"); // lucide/chevron-down
    svg.append(path);

    return svg;
  }

  function openPopover() {
    open = true;
    popover.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    search.value = "";
    activeIndex = Math.max(
      all.findIndex((option) => option.value === getTimeZone()),
      0
    );
    renderList();
    search.focus();
    list.querySelector('[data-active="true"]')?.scrollIntoView({ block: "center" });
  }

  function close() {
    open = false;
    popover.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
  }

  function move(step) {
    if (!filtered.length) return;
    activeIndex = (activeIndex + step + filtered.length) % filtered.length;
    renderList();
    list.querySelector('[data-active="true"]')?.scrollIntoView({ block: "nearest" });
  }

  trigger.addEventListener("click", () => (open ? close() : openPopover()));
  search.addEventListener("input", () => {
    activeIndex = 0;
    renderList();
  });

  search.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") { event.preventDefault(); move(1); }
    else if (event.key === "ArrowUp") { event.preventDefault(); move(-1); }
    else if (event.key === "Enter") {
      event.preventDefault();
      if (filtered[activeIndex]) choose(filtered[activeIndex].value);
    } else if (event.key === "Escape") { close(); trigger.focus(); }
  });

  document.addEventListener("click", (event) => {
    if (open && !root.contains(event.target)) close();
  });

  renderTrigger();

  return { render: renderTrigger };
}
