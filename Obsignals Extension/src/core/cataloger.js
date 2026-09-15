import { pedirComCota } from "./auth.js";

/**
 * The cataloguer.
 *
 * Pergunta quais minutos do dia repetiram a mesma direcao nos ultimos N dias,
 * para os pares e ajustes dados. A conta inteira e do servidor; aqui mora so a
 * forma da pergunta.
 */

/* Reexportadas para a tela continuar pedindo tudo num lugar so. A verdade mora
   em `opcoes.js`, que o servidor tambem le — ele recusa o que nao estiver la. */
export { DIAS } from "./opcoes.js";
export { OPCOES_CATALOGO as OPCOES } from "./opcoes.js";

export const PADRAO = {
  mercado: "standard",
  ativos: [],
  amanha: false,
  direcao: "both",
  timeframe: "m1",
  assertividade: 100,
  dias: 3,
  gale: 2,
};

/**
 * A consulta vai para o servidor de contas, e nao para o motor.
 *
 * Ele confere o token, cobra uma das listas gratuitas e so entao pergunta ao
 * motor — entao a cota deixa de viver no navegador, e a resposta ja chega sem
 * as velas que a produziram (~90% do payload, que passa de 4,8 MB no mercado
 * inteiro).
 *
 * @throws {import("./auth.js").AuthError} `cota.esgotada` quando acabou
 */
export async function catalogar(escolhas) {
  return pedirComCota("/cataloger", escolhas);
}
