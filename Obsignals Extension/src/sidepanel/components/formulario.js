import { t } from "../../i18n/index.js";

/**
 * O formulario das duas ferramentas.
 *
 * Rotulo em cima, escolhas embaixo — e nao a linha `.field` que as abas de
 * tempo usam: cinco opcoes dentro de 176px teriam de encolher ate o texto
 * cortar.
 *
 * O catalogador e o checklist montavam este mesmo bloco cada um do seu jeito, e
 * ja tinham divergido: um redesenhava o texto dos botoes a cada troca de idioma
 * e o outro o fixava na construcao. Aqui vale o comportamento do primeiro, que
 * e o correto — hoje nao muda nada, porque "M1" e "G2" nao se traduzem, mas
 * fica certo no dia em que uma opcao traduzida entrar.
 *
 * O prefixo de traducao e o unico parametro que separa as duas telas.
 */
export function createFormulario({ prefixo, escolhas, aoTrocar }) {
  const element = document.createElement("form");
  element.className = "catalogo";
  element.noValidate = true;

  const desenhos = [];

  /** Uma secao com titulo, para quem precisa montar o proprio conteudo. */
  function bloco(rotulo) {
    const secao = document.createElement("section");
    secao.className = "catalogo__grupo";

    const titulo = document.createElement("h2");
    titulo.className = "catalogo__rotulo";

    secao.append(titulo);
    element.append(secao);

    desenhos.push(() => {
      titulo.textContent = t(prefixo + rotulo);
    });

    return secao;
  }

  /** Uma secao de escolha unica: o valor marcado vive em `escolhas[chave]`. */
  function grupo(chave, opcoes, { rotulo = chave, texto = String } = {}) {
    const secao = bloco(rotulo);

    const linha = document.createElement("div");
    linha.className = "catalogo__opcoes";

    const botoes = opcoes.map((valor) => {
      const botao = document.createElement("button");
      botao.type = "button";
      botao.className = "escolha";
      botao.addEventListener("click", () => {
        escolhas[chave] = valor;
        aoTrocar();
      });
      linha.append(botao);
      return { botao, valor };
    });

    secao.append(linha);

    desenhos.push(() => {
      botoes.forEach(({ botao, valor }) => {
        botao.textContent = texto(valor);
        botao.setAttribute("aria-pressed", String(escolhas[chave] === valor));
      });
    });
  }

  /** Registra um desenho proprio da tela, junto dos que os grupos criaram. */
  function aoDesenhar(fn) {
    desenhos.push(fn);
  }

  return {
    element,
    bloco,
    grupo,
    aoDesenhar,
    desenhar: () => desenhos.forEach((fn) => fn()),
  };
}
