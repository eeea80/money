import { createStore } from "../core/store.js";
import { createApiSource } from "../core/sources/api-source.js";
import { setLocale, savedLocale, translateDocument } from "../i18n/index.js";
import { createSettingsScreen } from "./screens/settings.js";
import { createPremiumScreen } from "./screens/premium.js";
import { createContactScreen } from "./screens/contact.js";
import { createFaqScreen } from "./screens/faq.js";
import { createSignInScreen } from "./screens/signin.js";
import { createVerifyScreen } from "./screens/verify.js";
import { createDeleteAccountScreen } from "./screens/delete-account.js";
import { createChangePasswordScreen } from "./screens/change-password.js";
import { createCataloguerScreen } from "./screens/cataloguer.js";
import { createChecklistScreen } from "./screens/checklist.js";
import { refresh, signOut } from "../core/auth.js";
import { canSee, getAccount } from "../core/account.js";
import { createIcon } from "./components/icons.js";
import { createTabs } from "./components/tabs.js";
import { createSignalsTable } from "./components/signals-table.js";
import { createTimezonePicker } from "./components/timezone-picker.js";
import { createBrokerBanner } from "./components/broker-banner.js";
import { createBrokerGrid } from "./components/broker-grid.js";
import { createAppTabs, ABAS } from "./components/app-tabs.js";

/**
 * Side panel entry point.
 *
 * Wires three pieces and nothing more: a data source that produces signals,
 * a store that holds them, and components that render a snapshot of the store.
 * Swapping the mock feed for the real one is the single line marked below.
 */

const elements = {
  tabs: document.getElementById("tabs"),
  panel: document.getElementById("panel"),
};

// A saved choice wins; otherwise follow the browser.
setLocale(savedLocale() ?? navigator.language);

// The badge counts what arrived while nobody was looking — opening the panel is
// exactly the moment that stops being true. Guarded so the panel still runs on
// a plain page, where `chrome.runtime` is not there to answer.
if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
  chrome.runtime.sendMessage({ type: "panel-opened" }).catch(() => {});
}
translateDocument();

/**
 * The token lasts a day and the plan changes while the panel is closed — which
 * is exactly what subscribing does. Asking the server on open is what keeps the
 * screen from showing a plan the account no longer has.
 */
/* Deliberately not awaited here: the gate opens below on what is already
   stored, and this corrects it a moment later if the server disagrees. */
refresh()
  .then(() => {
    redrawScreens();
    openGate();
  })
  .catch((error) => console.error("session_refresh_failed", error));

// The badge follows the same rule as the table: it never counts a signal this
// account is not allowed to open.
const store = createStore(undefined, { canSee });
const tabs = createTabs(elements.tabs, {
  onSelect: (timeframe) => store.setActiveTimeframe(timeframe),
});
createBrokerBanner(document.getElementById("banner"));

const table = createSignalsTable(elements.panel, { onUpgrade: () => show("premium") });

// Changing the zone only affects rendering: stored signals are absolute
// instants, so a re-render is enough.
createTimezonePicker(document.getElementById("timezone"), {
  onChange: () => table.render(store.getState().signals),
});

// The picker builds its own nodes, so translate again to reach them.
translateDocument();

const corretoras = createBrokerGrid(document.getElementById("corretoras"));

const barraDeTopo = document.getElementById("barra-topo");
const barraDeAbas = document.getElementById("abas-app");
let abaAtual = "signals";
const abas = createAppTabs(barraDeAbas, { onSelect: (aba) => show(aba) });

const cataloguerScreen = createCataloguerScreen(
  document.getElementById("cataloguer-body"),
  { onUpgrade: () => show("premium") }
);

const checklistScreen = createChecklistScreen(
  document.getElementById("checklist-body"),
  { onUpgrade: () => show("premium") }
);

/** As abas que tem tela propria, para avisa-las quando voltam a aparecer. */
const TELAS_DE_ABA = {
  cataloguer: cataloguerScreen,
  checklist: checklistScreen,
};

store.subscribe((state) => {
  tabs.render(state);
  table.render(state.signals);
});

/**
 * A running signal walks into its martingales on the clock, without anything
 * arriving to trigger a redraw — so the table is refreshed on a timer too.
 *
 * Short relative to the grace in `resultAt`: a slower tick would add its own
 * delay on top, and the stage would land later than the grace says it should.
 */
setInterval(() => table.render(store.getState().signals), 5000);

/**
 * Connection state is not rendered anywhere. It is kept on the root element so
 * styling or a future indicator can hook into it without touching the data
 * layer.
 */
function setStatus(state) {
  document.documentElement.dataset.connection = state;
}

// --- data source -----------------------------------------------------------
// The Telegram channels, by way of the Obsignals feed.
const source = createApiSource();
let streaming = false;

function startFeed() {
  if (streaming) return;
  streaming = true;

  source.start({
    onSignal: (signal) => store.addSignal(signal),
    onResult: (id, result, gale) => store.updateResult(id, result, gale),
    onStatus: setStatus,
  });
}

function stopFeed() {
  if (!streaming) return;
  streaming = false;
  source.stop();
}

window.addEventListener("pagehide", stopFeed);

// --- screens ---------------------------------------------------------------

const screens = {
  signals: document.getElementById("screen-signals"),
  cataloguer: document.getElementById("screen-cataloguer"),
  checklist: document.getElementById("screen-checklist"),
  settings: document.getElementById("screen-settings"),
  premium: document.getElementById("screen-premium"),
  contact: document.getElementById("screen-contact"),
  faq: document.getElementById("screen-faq"),
  signin: document.getElementById("screen-signin"),
  verify: document.getElementById("screen-verify"),
  danger: document.getElementById("screen-danger"),
  password: document.getElementById("screen-password"),
};

const openButton = document.getElementById("open-settings");
const backButton = document.getElementById("close-settings");
openButton.append(createIcon("settings", 18));
backButton.append(createIcon("arrowLeft", 18));

document.getElementById("premium-bolt").append(createIcon("zap", 20));
document.getElementById("close-premium").append(createIcon("x", 18));
document
  .getElementById("close-premium")
  .addEventListener("click", () => show("settings"));

const premiumScreen = createPremiumScreen(document.getElementById("premium-body"), {
  onClose: () => show("settings"),
});

/**
 * O FAQ mora na barra de cima, que as tres abas dividem, e mostra as perguntas
 * da aba onde a pessoa esta. Sao tres FAQs paralelas: quem abre tem uma duvida
 * sobre uma tela so, e ver as outras duas no caminho e ruido.
 */
document.getElementById("open-faq").append(createIcon("helpCircle", 18));
document.getElementById("close-faq").append(createIcon("x", 18));

const faqScreen = createFaqScreen(
  document.getElementById("faq-body"),
  document.getElementById("faq-titulo")
);

document.getElementById("open-faq").addEventListener("click", () => {
  faqScreen.render(abaAtual);
  show("faq");
});

// Volta para a aba de onde veio, e nao para uma tela fixa.
document.getElementById("close-faq").addEventListener("click", () => show(abaAtual));

document.getElementById("close-contact").append(createIcon("arrowLeft", 18));
document
  .getElementById("close-contact")
  .addEventListener("click", () => show("settings"));

const contactScreen = createContactScreen(document.getElementById("contact-body"));

document.getElementById("close-password").append(createIcon("arrowLeft", 18));
document
  .getElementById("close-password")
  .addEventListener("click", () => show("settings"));

const passwordScreen = createChangePasswordScreen(
  document.getElementById("password-body"),
  { onChanged: redrawScreens }
);

document.getElementById("close-danger").append(createIcon("arrowLeft", 18));
document
  .getElementById("close-danger")
  .addEventListener("click", () => show("settings"));

const dangerScreen = createDeleteAccountScreen(document.getElementById("danger-body"), {
  onDeleted: () => {
    redrawScreens();
    openGate();
  },
});

const signInScreen = createSignInScreen(document.getElementById("signin-body"), {
  onSignedIn: () => {
    redrawScreens();
    openGate();
  },
});

const verifyScreen = createVerifyScreen(document.getElementById("verify-body"), {
  onVerified: () => {
    redrawScreens();
    openGate();
  },
  onSignOut: () => {
    redrawScreens();
    openGate();
  },
});

const settingsScreen = createSettingsScreen(document.getElementById("settings-body"), {
  onContact: () => show("contact"),
  onUpgrade: () => show("premium"),
  onSignOut: () => {
    signOut();
    redrawScreens();
    openGate();
  },
  onChangePassword: () => {
    passwordScreen.render(); // the fields start empty every time it is opened
    show("password");
  },
  onDeleteAccount: () => {
    dangerScreen.render();
    show("danger");
  },
  // Locale strings are read at render time, so redraw what is already on
  // screen after a language change.
  // Every screen builds its labels imperatively, so all of them have to be
  // redrawn — not just the one currently visible.
  onLanguageChange: redrawScreens,
});

/**
 * Every screen builds its labels imperatively, so anything that changes what
 * they should say — the locale, or who is signed in — has to redraw all of
 * them, not just the one on screen.
 */
function redrawScreens() {
  tabs.render(store.getState());
  table.render(store.getState().signals);
  corretoras.render();
  abas.render(abaAtual);
  cataloguerScreen.render();
  checklistScreen.render();
  settingsScreen.render();
  premiumScreen.render();
  dangerScreen.render();
  contactScreen.render();
  translateDocument();
}

/**
 * The bar shows for the three tabs and hides for everything else.
 *
 * Settings, billing and the sign-in flow are opened on top of a tab, not beside
 * it — leaving the bar up would invite someone to switch away in the middle of
 * a subscription and wonder where the form went.
 */
function show(name) {
  Object.entries(screens).forEach(([key, element]) => {
    element.hidden = key !== name;
  });

  /* As duas barras aparecem e somem juntas: sao as bordas da area de abas, e
     uma sem a outra deixa a tela desequilibrada. */
  const ehAba = ABAS.includes(name);
  barraDeTopo.hidden = !ehAba;
  barraDeAbas.hidden = !ehAba;
  if (ehAba) {
    abaAtual = name;
    abas.render(abaAtual);
    /* A tela sabe o que fazer ao ser reaberta — o catalogador e o checklist
       descartam a lista antiga quando a cota gratuita ja acabou. */
    TELAS_DE_ABA[name]?.aoEntrar();
  }
}

/**
 * Two questions before anything is shown: who, and are they reachable.
 *
 * The account is not a section of the app, it is the door to it, so this is a
 * gate rather than a screen someone navigates to. Which also means the feed has
 * no reason to be connected while nobody is through it.
 *
 * The second question is not ceremony. A subscription is claimed by address, so
 * an unproved address is one that could be claimed by whoever typed it.
 */
function openGate() {
  const account = getAccount();

  if (!account.signedIn) {
    stopFeed();
    signInScreen.render(); // always opens on the sign-in side, never mid-signup
    return show("signin");
  }

  if (!account.verified) {
    stopFeed();
    verifyScreen.reset(); // a fresh visit asks for a fresh code
    verifyScreen.render();
    return show("verify");
  }

  startFeed();
  show("signals");
}

openButton.addEventListener("click", () => show("settings"));
backButton.addEventListener("click", () => show("signals"));

translateDocument();
openGate();
