import { OPCOES, PADRAO, checar, linhasPedidas, placar } from "../../core/checklist.js";
import { CHECAGEM, LIMITE_FREE, liberado } from "../../core/cotas.js";
import { formatDate, formatGmt, getTimeZone, listDay } from "../../core/timezone.js";
import { getLocale, t } from "../../i18n/index.js";
import { createContadorCota } from "../components/contador-cota.js";
import { createFormulario } from "../components/formulario.js";
import { createIcon } from "../components/icons.js";
import { createResultPill } from "../components/result-pill.js";
import { celula, createSaida } from "../components/saida.js";
import { createTrava } from "../components/trava.js";

/**
 * The checklist screen.
 *
 * The cataloguer asks "which minutes repeat"; this one asks "how did the list I
 * already have actually go". Same shape on screen because it is the same kind
 * of answer — a scoreboard and a table — and the two live one tab apart.
 *
 * The timezone comes from the top bar, like everywhere else.
 */

export function createChecklistScreen(root, { onUpgrade } = {}) {
  const escolhas = { ...PADRAO, data: listDay() };

  const cotaLinha = createContadorCota(CHECAGEM);
  const trava = createTrava({ onUpgrade });

  /** `yyyy-mm-dd` na zona escolhida, que e o que `<input type="date">` fala. */
  const form = createFormulario({
    prefixo: "checklist.",
    escolhas,
    aoTrocar: () => desenhar(),
  });
  const formulario = form.element;
  const bloco = form.bloco;

  // --- data ------------------------------------------------------------------

  const campoData = document.createElement("input");
  campoData.type = "date";
  campoData.className = "campo-data";
  campoData.value = escolhas.data;
  campoData.addEventListener("change", () => {
    escolhas.data = campoData.value;
  });
  bloco("date").append(campoData);

  // --- escolhas de linha -----------------------------------------------------

  /* O mesmo rotulo das abas de Sinais, e nao o valor cru em maiusculas. */
  form.grupo("timeframe", OPCOES.timeframe, { texto: (v) => t(`tabs.${v}`) });
  form.grupo("gale", OPCOES.gale, { rotulo: "martingale", texto: (v) => "G" + v });

  // --- a lista ---------------------------------------------------------------

  const campoLista = document.createElement("textarea");
  campoLista.className = "campo-lista";
  campoLista.rows = 6;
  campoLista.addEventListener("input", () => {
    escolhas.lista = campoLista.value;
    desenhar();
  });
  bloco("list").append(campoLista);

  const acoes = document.createElement("div");
  acoes.className = "checklist__acoes";

  const enviar = document.createElement("button");
  enviar.type = "submit";
  enviar.className = "catalogo__enviar";


  /* So aparece quando ha o que limpar: um botao permanentemente inutil ensina
     a ignorar aquele canto da tela. */
  const limpar = document.createElement("button");
  limpar.type = "button";
  limpar.className = "checklist__limpar";
  limpar.addEventListener("click", () => {
    campoLista.value = "";
    escolhas.lista = "";
    resultado = null;
    desenhar();
  });

  acoes.append(enviar, limpar);
  formulario.append(acoes, cotaLinha.element);

  // --- o placar --------------------------------------------------------------

  const painelPlacar = document.createElement("div");
  painelPlacar.className = "placar";

  function medida(classe) {
    const caixa = document.createElement("div");
    caixa.className = "placar__medida " + classe;

    const rotulo = document.createElement("span");
    rotulo.className = "placar__rotulo";

    const valor = document.createElement("strong");
    valor.className = "placar__valor";

    caixa.append(rotulo, valor);
    return { caixa, rotulo, valor };
  }

  const vitorias = medida("placar__medida--win");
  const derrotas = medida("placar__medida--loss");
  const esperando = medida("placar__medida--wait");
  const taxa = medida("placar__medida--taxa");

  const trio = document.createElement("div");
  trio.className = "placar__trio";
  trio.append(vitorias.caixa, derrotas.caixa, esperando.caixa);

  painelPlacar.append(trio, taxa.caixa);

  // --- a resposta ------------------------------------------------------------

  /* Mesmo cartao do catalogador; o placar entra entre o cabecalho e a tabela,
     que e a unica diferenca de estrutura entre as duas telas. */
  const saida = createSaida({
    aposCabeca: painelPlacar,
    aoMudarPagina: () => desenhar(),
    aoCopiar: () => (resultado?.length ? textoParaCopiar() : null),
  });

  /* Contador logo abaixo do titulo da tela; o cadeado no lugar do formulario,
     com a ultima verificacao continuando abaixo dele. */
  root.append(formulario, trava.element, saida.element);

  // --- estado ----------------------------------------------------------------

  let carregando = false;
  let resultado = null;
  let falha = null;
  let sumirAviso = 0;

  function desenharTabela() {
    const cabecalho = document.createElement("tr");
    cabecalho.append(
      ...[
        t("table.time"),
        t("table.asset"),
        t("table.direction"),
        t("table.expiry"),
        /* Abreviado como as vizinhas: numa coluna estreita "Resultado" quebra
           antes de qualquer outra. */
        t("checklist.resultShort"),
      ].map((texto) => celula("th", texto))
    );
    saida.cabecalhoTabela.replaceChildren(cabecalho);

    saida.corpoTabela.replaceChildren(
      ...saida.fatia(resultado).map(({ hora, ativo, direcao, resultado, gale }) => {
        const linha = document.createElement("tr");

        linha.append(
          celula("td", hora, "catalogo__hora"),
          celula("td", ativo),
          celula("td", direcao),
          celula("td", t(`tabs.${escolhas.timeframe}`)),
          /* A mesma pilula da tabela de sinais, com o mesmo verde, o mesmo
             sufixo de gale e o mesmo travessao para o que ainda corre. */
          celula("td", createResultPill(resultado, { gale, waiting: true }), "cell--result")
        );

        return linha;
      })
    );
  }

  function desenharSaida() {
    /* O mesmo paragrafo serve a falha e ao aviso de linhas descartadas; o
       atributo e o que decide se ele sai em vermelho ou em cinza. */
    const descartadas = resultado ? linhasPedidas(escolhas.lista) - resultado.length : 0;
    saida.aviso.hidden = !falha && descartadas <= 0;
    saida.aviso.toggleAttribute("data-erro", Boolean(falha));

    if (falha) {
      saida.element.hidden = false;
      saida.aviso.textContent = falha;
      saida.cabeca.hidden = painelPlacar.hidden = saida.tabela.hidden = true;
      saida.rodape.hidden = saida.vazio.hidden = true;
      return;
    }

    if (!resultado) {
      saida.element.hidden = true;
      return;
    }

    saida.element.hidden = false;
    saida.cabeca.hidden = false;

    /* Nunca some sozinho: quem colou vinte e recebeu dezessete precisa saber
       que o placar nao e sobre a lista inteira. */
    if (descartadas > 0) {
      saida.aviso.textContent = t("checklist.dropped", { n: String(descartadas) });
    }

    saida.titulo.textContent = t("checklist.results");
    saida.data.lastElementChild.textContent = formatDate(
      Date.parse(escolhas.data + "T12:00:00Z"),
      getLocale(),
      "UTC"
    );
    saida.copiar.lastElementChild.textContent = t("cataloguer.copy");
    saida.avisoCopia.lastElementChild.textContent = t("cataloguer.copied");

    const nada = resultado.length === 0;
    painelPlacar.hidden = saida.tabela.hidden = nada;
    saida.vazio.hidden = !nada;
    saida.copiar.disabled = nada;

    if (nada) {
      saida.vazioTitulo.textContent = t("checklist.empty");
      saida.vazioDica.textContent = t("checklist.emptyHint");
      saida.rodape.hidden = true;
      return;
    }

    const conta = placar(resultado);
    vitorias.rotulo.textContent = t("checklist.wins");
    vitorias.valor.textContent = conta.vitorias;
    derrotas.rotulo.textContent = t("checklist.losses");
    derrotas.valor.textContent = conta.derrotas;
    esperando.rotulo.textContent = t("checklist.waiting");
    esperando.valor.textContent = conta.esperando;
    taxa.rotulo.textContent = t("checklist.accuracy");
    taxa.valor.textContent = conta.taxa + "%";

    desenharTabela();

    saida.desenharPaginacao(resultado.length);
  }

  function desenhar() {
    cotaLinha.atualizar();

    const podeUsar = liberado(CHECAGEM);
    trava.element.hidden = podeUsar;
    formulario.hidden = !podeUsar;

    if (!podeUsar) {
      trava.escrever({
        titulo: t("locked.checklistTitle"),
        texto: t("locked.checklistText", { total: String(LIMITE_FREE) }),
        acao: t("settings.upgrade"),
      });
    }

    form.desenhar();

    campoLista.placeholder = t("checklist.placeholder");
    enviar.textContent = t(carregando ? "checklist.checking" : "checklist.submit");
    enviar.disabled = carregando || !escolhas.lista.trim();

    limpar.textContent = t("checklist.clear");
    limpar.hidden = !escolhas.lista.trim();

    desenharSaida();
  }

  // --- acoes -----------------------------------------------------------------

  function textoParaCopiar() {
    const conta = placar(resultado);

    const linhas = resultado
      .map(
        ({ hora, ativo, direcao, resultado: desfechoDaLinha, gale }) =>
          t(`tabs.${escolhas.timeframe}`).padEnd(4) +
          ativo.padEnd(12) +
          hora.padEnd(7) +
          direcao.padEnd(6) +
          t(desfechoDaLinha === "PENDING" ? "result.wait" : `result.${desfechoDaLinha.toLowerCase()}`) +
          (desfechoDaLinha === "WIN" && gale ? ` G${gale}` : "")
      )
      .join("\n");

    const topo =
      "▪️Obsignals / " + t("abas.checklist") + "\n" +
      "▪️" + formatDate(Date.parse(escolhas.data + "T12:00:00Z"), getLocale(), "UTC") + "\n" +
      "▪️" + formatGmt() + "\n" +
      "▪️" + t("checklist.results") + ":\n\n";

    const resumo =
      "\n\n🔰 " + conta.vitorias + " x " + conta.derrotas +
      "\n🎯 " + t("checklist.accuracy") + ": " + conta.taxa + "%";

    return topo + linhas + resumo + "\n\n" + t("cataloguer.visit") + " ➔ obsignals.com";
  }

  formulario.addEventListener("submit", async (evento) => {
    evento.preventDefault();
    if (carregando || !escolhas.lista.trim() || !liberado(CHECAGEM)) return;

    carregando = true;
    falha = null;
    resultado = null;
    saida.reiniciar();
    desenhar();

    try {
      /* A cota e cobrada pelo proprio servidor que confere, no mesmo pedido. */
      resultado = await checar({ ...escolhas, timezone: getTimeZone() });
    } catch (erro) {
      if (erro?.key !== "cota.esgotada") {
        console.error("checklist_failed", erro);
        falha = t("checklist.failed");
      }
    } finally {
      carregando = false;
      desenhar();
    }
  });

  desenhar();

  /**
   * Chamada quando a aba volta a ser aberta.
   *
   * O resultado sobrevive a troca de aba de proposito: quem acabou de gerar
   * quer poder ir ver os sinais e voltar sem perder a lista. Mas depois que a
   * cota acabou ela nao pode virar moradora — o formulario ja saiu de cena, e
   * uma tabela parada embaixo do cadeado, sem nenhum jeito de gerar outra, e
   * resto de tela e nao informacao.
   */
  function aoEntrar() {
    if (!liberado(CHECAGEM)) {
      resultado = null;
      falha = null;
      saida.reiniciar();
    }
    desenhar();
  }

  return { render: desenhar, aoEntrar };
}
