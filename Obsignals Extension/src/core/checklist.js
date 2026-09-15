import { RESULT } from "./signal.js";
import { pedirComCota } from "./auth.js";

/**
 * O checklist.
 *
 * Pega uma lista de sinais que a pessoa ja tem — colada de onde quer que a
 * tenha recebido — e pergunta como cada um foi de verdade. A leitura da colagem
 * e do servidor: ele aceita o texto como foi digitado, emojis e links
 * incluidos.
 *
 * O que sabe falar com o motor mora em `server/lib/upstream.mjs`. Aqui fica a
 * forma da pergunta e a conta que a tela mostra.
 */

export { OPCOES_CHECAGEM as OPCOES } from "./opcoes.js";

export const PADRAO = {
  timeframe: "m1",
  gale: 2,
  lista: "",
};

/** Vitorias, derrotas, o que ainda corre, e a taxa entre as duas primeiras. */
export function placar(linhas) {
  const vitorias = linhas.filter(({ resultado }) => resultado === RESULT.WIN).length;
  const derrotas = linhas.filter(({ resultado }) => resultado === RESULT.LOSS).length;
  const esperando = linhas.filter(({ resultado }) => resultado === RESULT.PENDING).length;

  /* O que ainda corre fica fora da conta: inclui-lo faria a taxa cair a cada
     sinal novo e subir sozinha depois, sem nada ter acontecido. */
  const fechados = vitorias + derrotas;

  return {
    vitorias,
    derrotas,
    esperando,
    taxa: fechados ? Math.round((vitorias / fechados) * 100) : 0,
  };
}

/**
 * Quantas linhas a pessoa realmente pediu.
 *
 * O servidor devolve so o que conseguiu entender e nao diz o que descartou —
 * colar vinte sinais e receber dezessete dava um placar de dezessete, calado.
 * Comparar as duas contagens e o unico jeito de a tela perceber.
 */
export function linhasPedidas(lista) {
  return String(lista ?? "")
    .split("\n")
    .filter((linha) => linha.trim()).length;
}

/**
 * A lista vai para o servidor de contas, e nao para o motor.
 *
 * Ele confere o token, cobra uma das verificacoes gratuitas, traduz as palavras
 * de direcao para o dialeto que o motor entende — o motor so reconhece "call",
 * e uma lista em portugues voltava inteira invertida — e devolve cada linha ja
 * com o desfecho resolvido.
 *
 * @throws {import("./auth.js").AuthError} `cota.esgotada` quando acabou
 */
export async function checar(pedido) {
  return pedirComCota("/check", pedido);
}
