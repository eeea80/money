import { t } from "../../i18n/index.js";

/**
 * The bar at the bottom of the panel.
 *
 * Three destinations and nothing else: signals, cataloguer, checklist. Settings,
 * billing and the sign-in flow are not peers of these — they are opened on top
 * and the bar hides while they are up, so nobody switches tabs halfway through
 * a subscription.
 *
 * It lives outside the screens because it is the one thing that survives the
 * swap; putting it inside each screen would mean three copies drifting apart.
 */

export const ABAS = ["signals", "cataloguer", "checklist"];

export function createAppTabs(root, { onSelect }) {
  const botoes = ABAS.map((aba) => {
    const botao = document.createElement("button");
    botao.type = "button";
    botao.className = "aba-app";
    botao.dataset.aba = aba;
    botao.addEventListener("click", () => onSelect(aba));
    root.append(botao);
    return botao;
  });

  function render(ativa) {
    botoes.forEach((botao) => {
      botao.textContent = t(`abas.${botao.dataset.aba}`);
      botao.setAttribute("aria-current", String(botao.dataset.aba === ativa));
    });
  }

  return { render };
}
