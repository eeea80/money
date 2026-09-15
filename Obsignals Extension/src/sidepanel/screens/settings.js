import { t, getLocale, setLocale, translateDocument } from "../../i18n/index.js";
import { LOCALE_NAMES } from "../../i18n/index.js";
import { createIcon } from "../components/icons.js";
import { LINKS } from "../../core/links.js";
import { openBilling } from "../../core/auth.js";
import { getAccount, PLAN } from "../../core/account.js";
import { isEnabled, setEnabled } from "../../core/notifications.js";

/**
 * Settings screen.
 *
 * Grouped rows on cards — ACCOUNT / APP / SUPPORT — the shape people already
 * know from mobile settings. Rendered once and rebuilt only when the locale
 * changes, since every label has to be retranslated then.
 *
 * The account rows are placeholders until sign-in exists; they show the real
 * state ("Not signed in") rather than fake data.
 */

export function createSettingsScreen(root, {
  onLanguageChange,
  onUpgrade,
  onChangePassword = () => {},
  onContact = () => {},
  onSignOut = () => {},
  onDeleteAccount = () => {},
}) {
  render();

  function render() {
    root.replaceChildren(
      section(t("settings.sectionAccount"), accountRows()),

      section(t("settings.sectionApp"), [
        languageRow(),
        toggleRow("bell", t("settings.notifications"), {
          read: isEnabled,
          write: setEnabled,
        }),
        actionRow("star", t("settings.rateUs"), LINKS.rate),
      ]),

      section(t("settings.sectionSupport"), [
        buttonRow("messageCircle", t("contact.open"), onContact),
        actionRow("fileText", t("settings.terms"), LINKS.terms),
        actionRow("shield", t("settings.privacy"), LINKS.privacy),
      ]),

      // On its own at the end, away from everything it could be mistaken for.
      section("", [buttonRow("logOut", t("auth.signOut"), onSignOut)]),

      versionNote()
    );
  }

  /**
   * The account rows depend on the plan:
   *
   *   free     → Subscription is a static "Free Plan", plus an Upgrade row
   *   premium  → Subscription opens Stripe's customer portal, no Upgrade row
   *
   * One row that changes meaning, instead of "Manage" and "Upgrade" competing
   * on the same screen.
   */
  function accountRows() {
    const account = getAccount();
    const premium = account.plan === PLAN.PREMIUM;

    // Nobody reaches this screen signed out — the gate is before it — so the
    // email row only ever reports, it never offers a way in.
    const rows = [
      staticRow("mail", t("settings.email"), account.email ?? t("settings.emailEmpty")),
      buttonRow("lock", t("settings.changePassword"), onChangePassword),
    ];

    if (premium) {
      /* Not a link: the address is a one-time Stripe session created for this
         account, so it only exists once someone asks for it.

         The plan goes on the right, where every other row keeps its value and
         where the eye lands first — it is the answer to "what do I have". What
         the row *does* goes underneath, with the date it is about. */
      /* One line, like every other: the value on the right says what the plan
         is, the chevron says the row opens something. Clicking lands the user
         inside their own subscription at Stripe. */
      rows.push(
        buttonRow("plusSquare", t("settings.subscription"), openPortal, {
          value: t("settings.planPremium"),
        })
      );
    } else {
      rows.push(
        staticRow(
          "plusSquare",
          t("settings.subscription"),
          t("settings.planFree")
        ),
        buttonRow("zap", t("settings.upgrade"), onUpgrade, { accent: true })
      );
    }

    // Last in the card, and the only destructive row in the panel — which is
    // why it does not act here, it opens a screen that asks.
    rows.push(buttonRow("trash", t("danger.open"), onDeleteAccount, { danger: true }));

    return rows;
  }

  /**
   * Straight into their own subscription at Stripe, already signed in.
   *
   * The row reports failure in place rather than opening an empty tab — a
   * billing screen that does not appear is worse than one that says why.
   */
  /**
   * Straight into their own subscription at Stripe, already signed in.
   *
   * The address is a session created for this account, so it only exists once
   * someone asks for it — which is why the row is a button and not a link.
   */
  async function openPortal(event) {
    const row = event.currentTarget;
    const label = row.querySelector(".row__value");
    const was = label.textContent;

    row.disabled = true;
    label.textContent = t("auth.working");

    try {
      window.open(await openBilling(), "_blank", "noopener,noreferrer");
    } catch {
      // One word: a sentence would not fit beside the label.
      label.textContent = t("settings.manageFailed");
      await new Promise((done) => setTimeout(done, 2500));
    }

    label.textContent = was;
    row.disabled = false;
  }

  /** Card with an uppercase caption above it. */
  function section(caption, rows) {
    const wrapper = document.createElement("section");
    wrapper.className = "set";

    const label = document.createElement("p");
    label.className = "set__caption";
    label.textContent = caption;
    label.hidden = !caption;

    const card = document.createElement("div");
    card.className = "set__card";
    card.append(...rows);

    wrapper.append(label, card);
    return wrapper;
  }

  function rowBase(icon, label) {
    const left = document.createElement("span");
    left.className = "row__left";
    left.append(createIcon(icon), textNode(label));
    return left;
  }

  /** Label on the left, read-only value on the right. */
  function staticRow(icon, label, value) {
    const row = document.createElement("div");
    row.className = "row";

    const right = document.createElement("span");
    right.className = "row__value";
    right.textContent = value;

    row.append(rowBase(icon, label), right);
    return row;
  }

  /** Navigates inside the panel. */
  function buttonRow(icon, label, onClick, { accent = false, danger = false, value } = {}) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "row";
    if (accent) row.classList.add("row--accent");
    if (danger) row.classList.add("row--danger");
    row.addEventListener("click", onClick);

    const right = document.createElement("span");
    right.className = "row__right";
    if (value) {
      const text = document.createElement("span");
      text.className = "row__value";
      text.textContent = value;
      right.append(text);
    }
    right.append(createIcon("chevronRight", 15));

    row.append(rowBase(icon, label), right);
    return row;
  }

  /** Opens an external page, optionally showing a value before the arrow. */
  function actionRow(icon, label, href, { accent = false, value } = {}) {
    const row = document.createElement("a");
    row.className = accent ? "row row--accent" : "row";
    row.href = href;
    row.target = "_blank";
    row.rel = "noopener noreferrer";

    const right = document.createElement("span");
    right.className = "row__right";
    if (value) {
      const text = document.createElement("span");
      text.className = "row__value";
      text.textContent = value;
      right.append(text);
    }
    right.append(createIcon("externalLink", 15));

    row.append(rowBase(icon, label), right);
    return row;
  }

  /**
   * Language picker — the only control that rebuilds the whole screen.
   *
   * Buttons in a popover, not a `<select>`. The option list of a native select
   * is drawn by the operating system — white panel, system font, system
   * highlight — and it is the one widget a page cannot style. On a dark panel
   * it was the only thing on screen that did not look like the product. The
   * website's picker is built the same way, so the two match.
   *
   * `popover` rather than an absolutely positioned div: the list has to escape
   * two ancestors that clip it — the settings card, which hides overflow to
   * keep its rounded corners, and the panel itself, which scrolls. No `z-index`
   * gets a child out of a clipping ancestor; the top layer does, and it comes
   * with dismissal on outside click and on Escape already wired.
   *
   * Safe here in a way it would not be on the open web: the manifest declares
   * `minimum_chrome_version: 114`, which is the version `popover` shipped in.
   */
  function languageRow() {
    const row = document.createElement("div");
    row.className = "row";

    const caixa = document.createElement("div");
    caixa.className = "idiomas";

    const lista = document.createElement("div");
    lista.className = "idiomas__lista";
    lista.id = "idiomas-lista";
    lista.popover = "auto";
    lista.setAttribute("role", "group");
    // The label lives on the list, not on the button: an `aria-label` there
    // would give the control an accessible name ("Language") different from the
    // text on screen ("English"), and voice control speaks what it reads.
    lista.setAttribute("aria-label", t("settings.language"));

    const atual = document.createElement("button");
    atual.type = "button";
    atual.className = "idiomas__atual";
    atual.textContent = LOCALE_NAMES[getLocale()];
    atual.setAttribute("popovertarget", lista.id);
    atual.setAttribute("aria-expanded", "false");

    Object.entries(LOCALE_NAMES).forEach(([code, name]) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "idiomas__item";
      item.textContent = name;
      item.lang = code;
      if (code === getLocale()) item.setAttribute("aria-current", "true");
      item.addEventListener("click", () => {
        lista.hidePopover();
        if (code === getLocale()) return;
        setLocale(code, { persist: true });
        translateDocument();
        render(); // labels here are set imperatively, so redraw
        onLanguageChange();
      });
      lista.append(item);
    });

    /*
     * The top layer has no parent, so the list has to be told where to sit.
     *
     * Measured at the moment it opens, not once at build time: the panel
     * scrolls, and a position taken earlier would be stale by the time anyone
     * clicked. Right edge aligned with the button, because this control lives
     * against the panel's right margin and a list hanging the other way would
     * run off screen. Flipped above the button when there is not enough room
     * below.
     */
    lista.addEventListener("beforetoggle", (evento) => {
      const abrindo = evento.newState === "open";
      atual.setAttribute("aria-expanded", String(abrindo));
      if (!abrindo) return;

      // Escondido no primeiro quadro: as medidas so existem depois que o
      // navegador poe o elemento na camada de topo, e sem isto ele piscaria uma
      // vez no canto onde a folha do navegador o deixa.
      lista.style.visibility = "hidden";
      requestAnimationFrame(() => {
        const r = atual.getBoundingClientRect();
        const { offsetWidth: largo, offsetHeight: alto } = lista;
        const cabeAbaixo = r.bottom + 8 + alto <= innerHeight - 8;
        const topo = cabeAbaixo ? r.bottom + 8 : Math.max(8, r.top - 8 - alto);
        // Preso pela direita ao botao, e nunca ultrapassando a borda do painel
        // dos dois lados — 360px nao perdoam um popup que sai pela margem.
        const esquerda = Math.min(
          Math.max(8, r.right - largo),
          Math.max(8, innerWidth - 8 - largo)
        );
        lista.style.top = `${topo}px`;
        lista.style.left = `${esquerda}px`;
        lista.style.visibility = "";
      });
    });

    caixa.append(atual, lista);
    row.append(rowBase("globe", t("settings.language")), caixa);
    return row;
  }

  /** Boolean preference, read and written through the module that owns it. */
  function toggleRow(icon, label, { read, write }) {
    const row = document.createElement("label");
    row.className = "row";

    const input = document.createElement("input");
    input.type = "checkbox";
    input.className = "switch";
    input.role = "switch";
    input.checked = read();
    input.addEventListener("change", () => write(input.checked));

    row.append(rowBase(icon, label), input);
    return row;
  }

  function versionNote() {
    const note = document.createElement("p");
    note.className = "set__version";
    const version = chrome?.runtime?.getManifest?.().version ?? "1.0.0";
    note.textContent = `${t("settings.version")} ${version}`;
    return note;
  }

  function textNode(text) {
    const span = document.createElement("span");
    span.textContent = text;
    return span;
  }

  return { render };
}
