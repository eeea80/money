import { ATIVOS } from "../../core/ativos.js";
import { DIAS, OPCOES, PADRAO, catalogar } from "../../core/cataloger.js";
import { CATALOGO, LIMITE_FREE, liberado } from "../../core/cotas.js";
import { dayToEpoch, formatDate, formatGmt, getTimeZone, listDay } from "../../core/timezone.js";
import { getLocale, t } from "../../i18n/index.js";
import { createContadorCota } from "../components/contador-cota.js";
import { createFormulario } from "../components/formulario.js";
import { createIcon } from "../components/icons.js";
import { celula, createSaida } from "../components/saida.js";
import { createTrava } from "../components/trava.js";

/**
 * The cataloguer screen.
 *
 * A form and a table. Every calculation belongs to the server; what lives here
 * is the question and the answer.
 *
 * The timezone is deliberately absent from the form even though the API asks
 * for one: the header already carries the zone the user reads everything else
 * in, and asking twice invites the two to disagree.
 */

export function createCataloguerScreen(root, { onUpgrade } = {}) {
  const escolhas = { ...PADRAO };

  const cotaLinha = createContadorCota(CATALOGO);
  const trava = createTrava({ onUpgrade });

  const form = createFormulario({
    prefixo: "cataloguer.",
    escolhas,
    aoTrocar: () => desenhar(),
  });
  const formulario = form.element;
  const grupo = form.grupo;

  /** Um so controle repartido em tres: menos, valor, mais. */
  function contador(chave, { min, max }, { rotulo = chave }) {
    const secao = form.bloco(rotulo);

    const caixa = document.createElement("div");
    caixa.className = "contador";

    const valor = document.createElement("output");
    valor.className = "contador__valor";

    function passo(delta, sinal) {
      const botao = document.createElement("button");
      botao.type = "button";
      botao.className = "contador__passo";
      botao.textContent = sinal;
      botao.addEventListener("click", () => {
        escolhas[chave] = Math.min(max, Math.max(min, escolhas[chave] + delta));
        desenhar();
      });
      return botao;
    }

    const menos = passo(-1, "−");
    const mais = passo(1, "+");

    caixa.append(menos, valor, mais);
    secao.append(caixa);

    form.aoDesenhar(() => {
      valor.value = escolhas[chave];
      /* Desabilitar nas pontas em vez de deixar clicar sem efeito: um botao que
         nao faz nada parece quebrado. */
      menos.disabled = escolhas[chave] <= min;
      mais.disabled = escolhas[chave] >= max;
      menos.setAttribute("aria-label", t("cataloguer.less"));
      mais.setAttribute("aria-label", t("cataloguer.more"));
    });
  }

  // --- a pergunta ------------------------------------------------------------

  grupo("amanha", [false, true], {
    rotulo: "when",
    texto: (valor) => t(valor ? "cataloguer.tomorrow" : "cataloguer.today"),
  });

  grupo("mercado", OPCOES.mercado, {
    rotulo: "market",
    texto: (valor) => t("cataloguer." + valor),
  });

  /* Os ativos sao o unico grupo de escolha multipla, e o unico cujo conteudo
     muda: trocar de mercado troca a lista inteira. */
  const blocoAtivos = document.createElement("section");
  blocoAtivos.className = "catalogo__grupo";

  const tituloAtivos = document.createElement("h2");
  tituloAtivos.className = "catalogo__rotulo";

  const listaAtivos = document.createElement("div");
  listaAtivos.className = "catalogo__ativos";

  blocoAtivos.append(tituloAtivos, listaAtivos);
  formulario.append(blocoAtivos);

  grupo("direcao", OPCOES.direcao, {
    rotulo: "direction",
    texto: (valor) => t("cataloguer." + valor),
  });

  grupo("timeframe", OPCOES.timeframe, {
    rotulo: "timeframe",
    /* O mesmo rotulo das abas de Sinais. Formatar aqui por conta era o que
       fazia o painel dizer "M1" numa tela e "1M" na outra. */
    texto: (valor) => t(`tabs.${valor}`),
  });

  grupo("assertividade", OPCOES.assertividade, {
    rotulo: "accuracy",
    texto: (valor) => valor + "%",
  });

  contador("dias", DIAS, { rotulo: "days" });

  grupo("gale", OPCOES.gale, {
    rotulo: "martingale",
    texto: (valor) => "G" + valor,
  });

  const enviar = document.createElement("button");
  enviar.type = "submit";
  enviar.className = "catalogo__enviar";

  /* O contador logo abaixo do botao que o gasta. */
  formulario.append(enviar, cotaLinha.element);

  // --- a resposta ------------------------------------------------------------

  /* Cabecalho, copia, tabela, estado vazio e paginacao sao os mesmos do
     checklist, e moram em `components/saida.js`. */
  const saida = createSaida({
    aoMudarPagina: () => desenhar(),
    aoCopiar: () => (marcados.size ? textoParaCopiar() : null),
  });

  /* O contador vem antes do formulario para ficar logo abaixo do titulo da
     tela, que mora no cabecalho em index.html. O cadeado ocupa o lugar do
     formulario, e nao o da saida: a lista ja gerada continua abaixo dele. */
  root.append(formulario, trava.element, saida.element);

  /**
   * A data que a lista carrega — hoje, ou amanha quando foi isso que se pediu.
   *
   * O cabecalho e o texto copiado precisam dizer a mesma coisa: uma lista de
   * amanha carimbada com a data de hoje e publicada errada no grupo de quem
   * colou. O servidor nao ajuda aqui — ele devolve `timeUnix` no dia de hoje
   * mesmo quando a consulta pediu amanha.
   */
  function dataDaLista() {
    const dia = listDay(escolhas.amanha ? 1 : 0);
    return formatDate(dayToEpoch(dia), getLocale(), "UTC");
  }

  // --- estado ----------------------------------------------------------------

  let carregando = false;
  let resultado = null;
  let falha = null;
  /** Guardado por chave e nao por indice: a pagina muda, a escolha nao. */
  let marcados = new Set();
  let sumirAviso = 0;

  const chaveDe = ({ hora, ativo, direcao }) => hora + "|" + ativo + "|" + direcao;

  function alternarAtivo(ativo) {
    const dentro = escolhas.ativos.includes(ativo);
    escolhas.ativos = dentro
      ? escolhas.ativos.filter((outro) => outro !== ativo)
      : [...escolhas.ativos, ativo];
    desenhar();
  }

  function desenharAtivos() {
    tituloAtivos.textContent = t("cataloguer.assets");

    const todos = document.createElement("button");
    todos.type = "button";
    todos.className = "escolha";
    todos.textContent = t("cataloguer.all");
    /* Vazio significa "o mercado inteiro" para a API, entao limpar a selecao e
       o proprio "todos" — nao ha um terceiro estado a manter. */
    todos.setAttribute("aria-pressed", String(escolhas.ativos.length === 0));
    todos.addEventListener("click", () => {
      escolhas.ativos = [];
      desenhar();
    });

    listaAtivos.replaceChildren(
      todos,
      ...ATIVOS[escolhas.mercado].map((ativo) => {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "escolha";
        chip.textContent = ativo.replace("-OTC", "");
        chip.setAttribute("aria-pressed", String(escolhas.ativos.includes(ativo)));
        chip.addEventListener("click", () => alternarAtivo(ativo));
        return chip;
      })
    );
  }

  // --- a tabela --------------------------------------------------------------

  function caixaDeMarcar(marcada, aoTrocar) {
    const caixa = document.createElement("input");
    caixa.type = "checkbox";
    caixa.className = "marcar";
    caixa.checked = marcada;
    caixa.addEventListener("change", () => aoTrocar(caixa.checked));
    return caixa;
  }

  function alternarMarcado(chave) {
    if (marcados.has(chave)) marcados.delete(chave);
    else marcados.add(chave);
    desenhar();
  }

  function desenharTabela() {
    const visiveis = saida.fatia(resultado);
    const todosMarcados =
      visiveis.length > 0 && visiveis.every((linha) => marcados.has(chaveDe(linha)));

    const cabecalho = document.createElement("tr");
    cabecalho.append(
      celula(
        "th",
        caixaDeMarcar(todosMarcados, (marcar) => {
          visiveis.forEach((linha) => {
            if (marcar) marcados.add(chaveDe(linha));
            else marcados.delete(chaveDe(linha));
          });
          desenhar();
        }),
        "col--marcar"
      ),
      ...[
        t("table.time"),
        t("table.asset"),
        /* Abreviado como na tabela de sinais: `directionFull` e o que o leitor
           de tela anuncia, nao o que cabe numa coluna estreita. */
        t("table.direction"),
        /* "Exp." e como a tabela de sinais ja chama esta coluna. Duas tabelas
           no mesmo painel nomeando o mesmo valor de dois jeitos e ruido. */
        t("table.expiry"),
      ].map((texto) => celula("th", texto))
    );
    saida.cabecalhoTabela.replaceChildren(cabecalho);

    saida.corpoTabela.replaceChildren(
      ...visiveis.map((linha) => {
        const { hora, ativo, direcao } = linha;
        const chave = chaveDe(linha);

        const elemento = document.createElement("tr");
        /* Clicar em qualquer ponto da linha marca. O clique na propria caixa
           volta por aqui tambem, e seria desfeito no mesmo gesto — dai o
           desvio. */
        elemento.addEventListener("click", (evento) => {
          if (!evento.target.classList.contains("marcar")) alternarMarcado(chave);
        });

        elemento.append(
          celula(
            "td",
            caixaDeMarcar(marcados.has(chave), () => alternarMarcado(chave)),
            "col--marcar"
          ),
          celula("td", hora, "catalogo__hora"),
          /* O nome inteiro, com o sufixo: sem ele um resultado OTC lia como
             mercado normal, e a lista inteira parecia estar errada. Na lista de
             ativos acima o sufixo e omitido de proposito — la a aba de mercado
             ja diz qual e, e treze "-OTC" repetidos so roubam largura. */
          celula("td", ativo),
          celula("td", direcao),
          celula("td", t(`tabs.${escolhas.timeframe}`))
        );

        return elemento;
      })
    );
  }

  function desenharSaida() {
    saida.aviso.hidden = !falha;

    if (falha) {
      saida.element.hidden = false;
      saida.aviso.textContent = falha;
      saida.cabeca.hidden = saida.tabela.hidden = saida.rodape.hidden = saida.vazio.hidden = true;
      return;
    }

    if (!resultado) {
      saida.element.hidden = true;
      return;
    }

    saida.element.hidden = false;

    saida.titulo.textContent = t("cataloguer.results");
    saida.data.lastElementChild.textContent = dataDaLista();
    saida.copiar.lastElementChild.textContent = t("cataloguer.copy");
    saida.copiar.disabled = marcados.size === 0;
    saida.avisoCopia.lastElementChild.textContent = t("cataloguer.copied");

    const nada = resultado.length === 0;
    saida.cabeca.hidden = false;
    saida.tabela.hidden = nada;
    saida.vazio.hidden = !nada;

    if (nada) {
      saida.vazioTitulo.textContent = t("cataloguer.empty");
      saida.vazioDica.textContent = t("cataloguer.emptyHint");
      saida.rodape.hidden = true;
      saida.copiar.disabled = true;
      return;
    }

    desenharTabela();

    saida.desenharPaginacao(resultado.length);
  }

  function desenhar() {
    cotaLinha.atualizar();

    /* Gastou o que tinha: o formulario sai de cena e o cadeado toma o lugar
       dele. A lista ja gerada fica — a terceira foi conquistada, e escondê-la
       no instante em que aparece seria cobrar por algo ja entregue. */
    const podeUsar = liberado(CATALOGO);
    trava.element.hidden = podeUsar;
    formulario.hidden = !podeUsar;

    if (!podeUsar) {
      trava.escrever({
        titulo: t("locked.cataloguerTitle"),
        texto: t("locked.cataloguerText", { total: String(LIMITE_FREE) }),
        acao: t("settings.upgrade"),
      });
    }

    form.desenhar();
    desenharAtivos();

    enviar.textContent = t(carregando ? "cataloguer.loading" : "cataloguer.submit");
    enviar.disabled = carregando;

    desenharSaida();
  }

  // --- acoes -----------------------------------------------------------------

  /**
   * The same text the site hands out: columns aligned by padding rather than by
   * tabs, because the destination is a chat box where a tab does not survive.
   */
  function textoParaCopiar() {
    const linhas = resultado
      .filter((linha) => marcados.has(chaveDe(linha)))
      .sort((a, b) => a.hora.localeCompare(b.hora))
      .map(
        ({ hora, ativo, direcao }) =>
          t(`tabs.${escolhas.timeframe}`).padEnd(4) +
          /* 12 e nao 10: "EURGBP-OTC" tem exatamente 10, e o preenchimento
             sumia — o ativo colava no horario. */
          ativo.padEnd(12) +
          hora.padEnd(7) +
          direcao
      )
      .join("\n");

    const topo =
      "▪️Obsignals / " + t("abas.cataloguer") + "\n" +
      "▪️" + dataDaLista() + "\n" +
      "▪️" + formatGmt() + "\n" +
      "▪️" + t("cataloguer.results") + ":\n\n";

    return topo + linhas + "\n\n" + t("cataloguer.visit") + " ➔ obsignals.com";
  }

  formulario.addEventListener("submit", async (evento) => {
    evento.preventDefault();
    if (carregando) return;

    if (!liberado(CATALOGO)) return;

    carregando = true;
    falha = null;
    resultado = null;
    saida.reiniciar();
    marcados = new Set();
    desenhar();

    try {
      /* A cota e cobrada pelo proprio servidor que cataloga, no mesmo pedido:
         nao ha como pedir a lista sem pagar por ela, nem pagar sem receber. */
      const bruto = await catalogar({ ...escolhas, timezone: getTimeZone() });
      /* Ordenado por hora: a resposta vem agrupada por ativo, e quem cataloga
         le a lista como a agenda do dia. */
      resultado = bruto.sort((a, b) => a.hora.localeCompare(b.hora));
    } catch (erro) {
      /* "Acabou" nao e falha: o desenho seguinte ja encontra o cadeado, com a
         sessao atualizada pela propria resposta. */
      if (erro?.key !== "cota.esgotada") {
        console.error("cataloguer_failed", erro);
        falha = t("cataloguer.failed");
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
    if (!liberado(CATALOGO)) {
      resultado = null;
      falha = null;
      saida.reiniciar();
      marcados = new Set();
    }
    desenhar();
  }

  return { render: desenhar, aoEntrar };
}
