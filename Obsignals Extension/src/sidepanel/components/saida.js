import { t } from "../../i18n/index.js";
import { createIcon } from "./icons.js";

/**
 * O cartao de resposta das duas ferramentas.
 *
 * O catalogador e o checklist fazem perguntas diferentes e recebem a mesma
 * forma de resposta: um cabecalho que diz o que foi perguntado e quando, um
 * botao de copiar, uma tabela, um estado vazio e uma paginacao. Era tudo
 * escrito duas vezes, e as duas copias ja tinham comecado a andar separadas —
 * uma ganhou um comentario que a outra nao tem, e o proximo ajuste feito em
 * uma so teria passado despercebido.
 *
 * O checklist mostra um placar entre o cabecalho e a tabela; e a unica
 * diferenca de estrutura, e entra por `aposCabeca`.
 */

/** Vinte por pagina, como o site entrega. */
export const POR_PAGINA = 20;

/** Uma celula de tabela. Nao e a `cell()` da tabela de sinais: aquela exige
 *  classe e escreve texto; esta aceita qualquer no e a classe e opcional. */
export function celula(tipo, conteudo, classe) {
  const elemento = document.createElement(tipo);
  if (classe) elemento.className = classe;
  elemento.append(conteudo);
  return elemento;
}

/**
 * @param {object} opcoes
 * @param {Element} [opcoes.aposCabeca]  entra entre o cabecalho e a tabela
 * @param {() => void} opcoes.aoMudarPagina  a tela redesenha
 * @param {() => string|null} opcoes.aoCopiar  o texto, ou `null` para nao copiar
 */
export function createSaida({ aposCabeca = null, aoMudarPagina, aoCopiar }) {
  const element = document.createElement("section");
  element.className = "catalogo__saida";
  element.hidden = true;

  // --- o cabecalho -----------------------------------------------------------

  const cabeca = document.createElement("header");
  cabeca.className = "saida__cabeca";

  const identificacao = document.createElement("div");

  const titulo = document.createElement("h2");
  titulo.className = "saida__titulo";

  const data = document.createElement("p");
  data.className = "saida__data";
  data.append(createIcon("calendar", 13), document.createElement("span"));

  identificacao.append(titulo, data);

  const copiar = document.createElement("button");
  copiar.type = "button";
  copiar.className = "saida__copiar";
  copiar.append(createIcon("clipboard", 14), document.createElement("span"));

  /**
   * O aviso de copiado.
   *
   * Flutua sobre o cabecalho em vez de virar texto no botao: quem acabou de
   * clicar esta olhando para o botao, e trocar o rotulo dele apaga a unica
   * coisa que confirma o que foi copiado.
   */
  const avisoCopia = document.createElement("output");
  avisoCopia.className = "copiado";
  avisoCopia.hidden = true;
  avisoCopia.append(createIcon("check", 13), document.createElement("span"));

  cabeca.append(identificacao, copiar, avisoCopia);

  // --- a tabela --------------------------------------------------------------

  /* Uma `<table>` de verdade, e nao uma grade fingindo de tabela: com colunas
     iguais o conteudo desigual abria buracos — "17:51" e "M1" nao pedem a
     largura de "EURGBP". `table-layout: auto` reparte pelo conteudo sozinho,
     que e a mesma escolha da tabela de sinais. */
  const tabela = document.createElement("table");
  tabela.className = "catalogo__tabela";

  const cabecalhoTabela = document.createElement("thead");
  const corpoTabela = document.createElement("tbody");
  tabela.append(cabecalhoTabela, corpoTabela);

  /* O cartao recorta o proprio raio com `overflow: hidden`, e as celulas nao
     quebram linha — junto, isso cortava em silencio o que passasse da largura.
     Aparecia primeiro em arabe e alemao, onde os rotulos sao mais longos. Aqui
     a tabela rola dentro do cartao em vez de perder a ultima coluna. */
  const rolagem = document.createElement("div");
  rolagem.className = "catalogo__rolagem";
  rolagem.append(tabela);

  // --- o que sobra -----------------------------------------------------------

  const aviso = document.createElement("p");
  aviso.className = "catalogo__resumo";
  aviso.hidden = true;

  /* Ocupa o lugar da paginacao, e nao o da tabela: o cabecalho continua
     dizendo o que foi perguntado e quando, que e a informacao de que a pessoa
     precisa para saber o que mudar. */
  const vazio = document.createElement("div");
  vazio.className = "catalogo__vazio";
  vazio.hidden = true;

  const vazioTitulo = document.createElement("p");
  vazioTitulo.className = "catalogo__vazio-titulo";

  const vazioDica = document.createElement("p");
  vazioDica.className = "catalogo__vazio-dica";

  vazio.append(vazioTitulo, vazioDica);

  const rodape = document.createElement("nav");
  rodape.className = "paginas";

  const anterior = document.createElement("button");
  anterior.type = "button";
  anterior.className = "paginas__passo";
  /* O glifo lido em voz alta e um sinal de pontuacao. O nome vem do rotulo,
     como ja acontece com o menos e o mais do contador de dias. */
  anterior.textContent = "‹";

  const contagem = document.createElement("span");
  contagem.className = "paginas__conta";

  const proxima = document.createElement("button");
  proxima.type = "button";
  proxima.className = "paginas__passo";
  proxima.textContent = "›";

  rodape.append(anterior, contagem, proxima);

  element.append(aviso, cabeca, ...(aposCabeca ? [aposCabeca] : []), rolagem, vazio, rodape);

  // --- a paginacao -----------------------------------------------------------

  let pagina = 0;
  let sumirAviso = 0;

  anterior.addEventListener("click", () => {
    pagina = Math.max(0, pagina - 1);
    aoMudarPagina();
  });

  proxima.addEventListener("click", () => {
    pagina = Math.min(paginasDe(ultimoTotal) - 1, pagina + 1);
    aoMudarPagina();
  });

  /* Guardado porque o handler do "proxima" precisa do teto e so a tela sabe
     quantas linhas existem. Atualizado a cada desenho. */
  let ultimoTotal = 0;

  const paginasDe = (total) => Math.max(1, Math.ceil(total / POR_PAGINA));

  copiar.addEventListener("click", async () => {
    /* A guarda de cada tela vira "nao devolveu texto": o catalogador exige
       linhas marcadas, o checklist exige resultado. */
    const texto = aoCopiar();
    if (!texto) return;

    try {
      await navigator.clipboard.writeText(texto);
      avisoCopia.hidden = false;
      clearTimeout(sumirAviso);
      sumirAviso = setTimeout(() => {
        avisoCopia.hidden = true;
      }, 2200);
    } catch (erro) {
      console.error("clipboard_failed", erro);
    }
  });

  return {
    element,
    aviso,
    cabeca,
    titulo,
    data,
    copiar,
    avisoCopia,
    tabela: rolagem,
    cabecalhoTabela,
    corpoTabela,
    vazio,
    vazioTitulo,
    vazioDica,
    rodape,

    /** A pagina volta ao topo a cada consulta nova. */
    reiniciar() {
      pagina = 0;
    },

    /** As linhas desta pagina. */
    fatia(lista) {
      return (lista ?? []).slice(pagina * POR_PAGINA, (pagina + 1) * POR_PAGINA);
    },

    desenharPaginacao(total) {
      ultimoTotal = total;
      anterior.setAttribute("aria-label", t("paginas.anterior"));
      proxima.setAttribute("aria-label", t("paginas.proxima"));
      const paginas = paginasDe(total);
      /* Some com uma pagina so: um contador que sempre diz "1 / 1" e ruido. */
      contagem.textContent = pagina + 1 + " / " + paginas;
      anterior.disabled = pagina === 0;
      proxima.disabled = pagina >= paginas - 1;
      rodape.hidden = paginas === 1;
    },
  };
}
