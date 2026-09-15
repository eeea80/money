import { BROKERS, OTC_BROKERS } from "../../core/brokers.js";
import { t } from "../../i18n/index.js";
import { createIcon } from "./icons.js";
import { createTooltip } from "./tooltip.js";

/**
 * Where to trade these signals.
 *
 * Replaces the footer that named the compatible brokers in a tooltip. The names
 * were already the answer to a question people have — "which broker do I use
 * with this?" — so they stop being a footnote and become the answer, with the
 * partner link attached to each one.
 *
 * Nothing here tags anything. A broker is reached only by clicking its box, and
 * the line underneath says who gets paid for it.
 */

/** Two rows fit; the rest scrolls. The CSS owns the arithmetic. */
const MERCADOS = [
  { chave: "standard", corretoras: BROKERS },
  { chave: "otc", corretoras: OTC_BROKERS },
];

export function createBrokerGrid(root) {
  const secao = document.createElement("section");
  secao.className = "corretoras";

  const cabeca = document.createElement("div");
  cabeca.className = "corretoras__cabeca";

  const titulo = document.createElement("h2");
  titulo.className = "corretoras__titulo";

  /* O titulo cabe numa palavra para o controle segmentado respirar ao lado
     dele. O resto da frase — que sao as corretoras onde estes sinais funcionam,
     e o que separa os dois mercados — vive aqui.

     O aviso de comissao continua fora daqui, na linha de baixo: divulgacao que
     depende de um clique nao alcanca quem nao clicou. */
  const gatilho = document.createElement("button");
  gatilho.type = "button";
  gatilho.className = "info";
  gatilho.setAttribute("aria-describedby", "corretoras-tip");

  const iInclinado = document.createElement("span");
  iInclinado.setAttribute("aria-hidden", "true");
  iInclinado.textContent = "i";
  gatilho.append(iInclinado);

  const bolha = document.createElement("div");
  bolha.className = "tooltip";
  bolha.id = "corretoras-tip";
  bolha.setAttribute("role", "tooltip");
  bolha.hidden = true;

  const explicacao = document.createElement("p");
  const grupos = MERCADOS.map(({ chave }) => {
    const grupo = document.createElement("div");
    grupo.className = "tooltip__group";

    const rotulo = document.createElement("span");
    rotulo.className = "tooltip__label";

    const valor = document.createElement("span");
    valor.className = "tooltip__value";

    grupo.append(rotulo, valor);
    bolha.append(grupo);
    return { chave, rotulo, valor };
  });
  bolha.prepend(explicacao);

  /* O mesmo controle segmentado do Timeframe, pela classe e nao por uma
     copia: dois seletores parecidos divergem no primeiro ajuste que alguem
     fizer num deles. */
  const mercados = document.createElement("div");
  mercados.className = "tabs";
  mercados.setAttribute("role", "tablist");

  const botoes = MERCADOS.map(({ chave }) => {
    const botao = document.createElement("button");
    botao.type = "button";
    botao.className = "tabs__item";
    botao.setAttribute("role", "tab");
    botao.dataset.mercado = chave;
    botao.addEventListener("click", () => escolher(chave));
    mercados.append(botao);
    return botao;
  });

  /* Nome e aviso empilhados a esquerda, controle a direita: assim o segmentado
     fica centrado entre as duas linhas em vez de alinhado so com a primeira. */
  const linhaNome = document.createElement("div");
  linhaNome.className = "corretoras__linha";
  linhaNome.append(titulo, gatilho);

  const aviso = document.createElement("p");
  aviso.className = "corretoras__aviso";

  const nome = document.createElement("div");
  nome.className = "corretoras__nome";
  nome.append(linhaNome, aviso);

  cabeca.append(nome, mercados);

  const lista = document.createElement("div");
  lista.className = "corretoras__lista";

  secao.append(bolha, cabeca, lista);
  root.append(secao);

  createTooltip(gatilho, bolha);

  let ativo = MERCADOS[0].chave;

  /**
   * Eight boxes at most, so the list is rebuilt instead of hidden and shown.
   * Keeping two lists alive would mean two copies of every link in the DOM to
   * save a rebuild nobody can perceive.
   */
  function desenhar() {
    const { corretoras } = MERCADOS.find(({ chave }) => chave === ativo);

    lista.replaceChildren(
      ...corretoras.map(({ name, url }) => {
        const caixa = document.createElement("a");
        caixa.className = "corretora";
        caixa.href = url;
        caixa.target = "_blank";
        /* `noopener` is what keeps the broker's page from reaching back into
           the panel through `window.opener`. */
        caixa.rel = "noopener noreferrer";

        const nome = document.createElement("span");
        nome.textContent = name;

        const seta = createIcon("external", 12);
        seta.classList.add("corretora__seta");
        seta.setAttribute("aria-hidden", "true");

        caixa.append(nome, seta);
        return caixa;
      })
    );
  }

  function escolher(chave) {
    ativo = chave;
    render();
  }

  function render() {
    titulo.textContent = t("brokers.title");
    aviso.textContent = t("brokers.disclosure");
    gatilho.setAttribute("aria-label", t("brokers.infoLabel"));

    explicacao.textContent = t("brokers.about");
    grupos.forEach(({ chave, rotulo, valor }) => {
      rotulo.textContent = t(`brokers.${chave}Long`);
      /* Os nomes, e nao uma descricao do que os nomes seriam: quem abre isto
         quer saber se a corretora dele esta na lista de sabado. */
      valor.textContent = MERCADOS.find((m) => m.chave === chave)
        .corretoras.map(({ name }) => name)
        .join(", ");
    });

    botoes.forEach((botao) => {
      botao.textContent = t(`brokers.${botao.dataset.mercado}`);
      botao.setAttribute("aria-selected", String(botao.dataset.mercado === ativo));
    });

    desenhar();
  }

  render();

  return { render };
}
