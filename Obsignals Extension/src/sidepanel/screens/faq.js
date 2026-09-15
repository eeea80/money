import { BROKERS, OTC_BROKERS } from "../../core/brokers.js";
import { t } from "../../i18n/index.js";

/**
 * As perguntas frequentes de cada aba.
 *
 * Tres FAQs paralelas, e nao uma com secoes: quem abre o botao esta numa tela
 * so, com uma duvida sobre aquela tela. Ver as perguntas das outras duas no
 * meio do caminho e ruido no momento em que a pessoa menos quer procurar.
 *
 * A tela e uma so, e o conteudo troca com a aba — o botao mora na barra de
 * cima, que as tres compartilham.
 *
 * O sanfonado e `<details>`: abrir e fechar, o teclado e o leitor de tela ja
 * vem do navegador. Escrever isso a mao seria trocar comportamento pronto e
 * correto por comportamento nosso e por manter.
 */

/** Quantas perguntas cada aba tem. As chaves seguem `faq.<aba><n>P` e `...R`. */
const QUANTAS = {
  signals: 9,
  cataloguer: 22,
  checklist: 16,
};

/**
 * A pergunta das corretoras responde com a lista de verdade, e nao com nomes
 * escritos a mao na traducao: sao os mesmos dados que desenham a grade no
 * rodape, entao entrar ou sair uma corretora nao deixa a resposta para tras em
 * oito idiomas.
 */
const CORRETORAS = {
  normal: BROKERS.map((c) => c.name).join(", "),
  otc: OTC_BROKERS.map((c) => c.name).join(", "),
};

export function createFaqScreen(root, cabecalho) {
  /* O nome da aba e "Perguntas frequentes" juntos, no cabecalho: duas linhas
     no mesmo lugar em vez de um titulo em cima e um rotulo solto no corpo. */
  const aba_ = document.createElement("span");
  const rotulo = document.createElement("span");
  rotulo.className = "header__sub";
  cabecalho.append(aba_, rotulo);

  const lista = document.createElement("div");
  lista.className = "faq";

  root.append(lista);

  let aba = "signals";

  function desenhar(qual = aba) {
    aba = qual in QUANTAS ? qual : "signals";

    aba_.textContent = t(`abas.${aba}`);
    rotulo.textContent = t("faq.title");

    lista.replaceChildren(
      ...Array.from({ length: QUANTAS[aba] }, (_, i) => {
        const item = document.createElement("details");
        item.className = "faq__item";
        /* Acordeao exclusivo, do proprio navegador: abrir uma fecha a anterior.
           Um `name` compartilhado faz isso sem nenhum ouvinte nosso. */
        item.name = `faq-${aba}`;

        const pergunta = document.createElement("summary");
        pergunta.className = "faq__pergunta";
        pergunta.textContent = t(`faq.${aba}${i + 1}P`);

        const resposta = document.createElement("p");
        resposta.className = "faq__resposta";
        resposta.textContent = t(`faq.${aba}${i + 1}R`, CORRETORAS);

        item.append(pergunta, resposta);
        return item;
      })
    );
  }

  return { render: desenhar };
}
