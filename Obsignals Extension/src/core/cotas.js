import { isPremium } from "./account.js";
import { getSession } from "./auth.js";

/**
 * O que uma conta gratuita pode usar das duas ferramentas.
 *
 * Tres listas e tres verificacoes, para toda a vida da conta — nao por dia. A
 * conta so sobe, entao o numero na tela e o que resta para sempre, e quem gasta
 * encontra o mesmo cadeado que os sinais OTC mostram.
 *
 * Quem decide e o servidor: as proprias rotas que catalogam e conferem cobram a
 * cota antes de trabalhar, e recusam com 403 quando acabou. Este arquivo so le
 * o numero que a ultima resposta deixou na sessao, para desenhar o contador e o
 * cadeado sem outra ida a rede. Contar aqui e so contar: apagar os dados da
 * extensao nao devolve nenhuma lista.
 *
 * As duas ferramentas dividem este arquivo porque dividem a regra.
 */

/** Enquanto o `/me` nao responde. O servidor manda o numero verdadeiro. */
export const LIMITE_FREE = 3;

/** As duas ferramentas racionadas. O valor e o nome que o servidor conhece. */
export const CATALOGO = "cataloguer";
export const CHECAGEM = "checklist";

/** O limite que o servidor informou, ou o padrao ate ele responder. */
export function limite() {
  const guardado = Number(getSession()?.limiteGratuito);
  return Number.isFinite(guardado) && guardado > 0 ? guardado : LIMITE_FREE;
}

/**
 * Quantas ja foram gastas, segundo a ultima resposta do servidor.
 *
 * Qualquer coisa que nao seja inteiro positivo le como zero: e um valor que veio
 * pela rede, e um numero estragado nao pode trancar quem nunca usou nada.
 */
export function usadas(ferramenta) {
  const bruto = Number(getSession()?.uso?.[ferramenta]);
  return Number.isFinite(bruto) && bruto > 0 ? Math.floor(bruto) : 0;
}

export function restantes(ferramenta) {
  return Math.max(0, limite() - usadas(ferramenta));
}

/**
 * O que a tela desenha.
 *
 * E uma leitura otimista: o servidor e quem manda, e a consulta pode voltar
 * 403 mesmo com este dizendo que sobra. O cadeado aparece nos dois casos.
 */
export function liberado(ferramenta) {
  return isPremium() || restantes(ferramenta) > 0;
}
