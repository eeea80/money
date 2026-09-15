import { createIcon } from "./icons.js";

/**
 * O bloco do cadeado.
 *
 * Tres telas trancam: a tabela de sinais quando so ha OTC rodando, e as duas
 * ferramentas quando a conta gratuita gastou o que tinha. Mesma forma e mesmo
 * motivo — e isto que o Premium compra — entao e construido uma vez.
 *
 * Nao e uma cortina sobre o conteudo desfocado: mostrar a lista que a pessoa
 * nao pode gerar e um negocio pior do que dizer com todas as letras o que
 * aconteceu. O motivo e a oferta.
 */
export function createTrava({ onUpgrade }) {
  const bloco = document.createElement("div");
  bloco.className = "empty";
  bloco.hidden = true;

  const titulo = document.createElement("p");
  titulo.className = "empty__title";

  const texto = document.createElement("p");

  const acao = document.createElement("button");
  acao.type = "button";
  acao.className = "empty__action";
  acao.addEventListener("click", onUpgrade);

  bloco.append(createIcon("lock", 22), titulo, texto, acao);

  return {
    element: bloco,

    /** Os textos mudam com o idioma, entao sao escritos a cada desenho. */
    escrever({ titulo: cabeca, texto: corpo, acao: botao }) {
      titulo.textContent = cabeca;
      texto.textContent = corpo;
      acao.textContent = botao;
    },
  };
}
