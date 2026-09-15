/**
 * O que os formulários oferecem, e o que o servidor aceita.
 *
 * Vive à parte, e sem importar nada, porque os dois lados precisam da mesma
 * lista: a tela desenha os botões a partir dela, e o servidor recusa o que não
 * estiver aqui. Duas cópias divergiriam no dia em que uma opção entrasse — e a
 * que sobrasse para trás seria a do servidor, que é a que recusa.
 *
 * Sem este arquivo o servidor teria de importar `cataloger.js`, que fala com a
 * conta, que fala com as preferências, que carrega os oito dicionários de
 * tradução — quinze arquivos de navegador para ler cinco listas.
 */

/** O que o catalogador pergunta. */
export const OPCOES_CATALOGO = {
  mercado: ["standard", "otc"],
  direcao: ["call", "put", "both"],
  timeframe: ["m1", "m5"],
  assertividade: [80, 90, 100],
  gale: [0, 1, 2],
};

/**
 * Os dias são um contador e não uma fileira de atalhos: entre 3 e 7 existem 4,
 * 5 e 6, e botões escondem isso. O teto é o que o motor aceita olhar para trás;
 * o piso é um dia, porque zero não cataloga nada.
 */
export const DIAS = { min: 1, max: 30 };

/** O que o checklist pergunta. A lista colada traz o resto. */
export const OPCOES_CHECAGEM = {
  timeframe: ["m1", "m5"],
  gale: [0, 1, 2],
};
