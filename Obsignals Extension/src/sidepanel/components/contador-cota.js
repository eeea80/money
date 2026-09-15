import { isPremium } from "../../core/account.js";
import { LIMITE_FREE, restantes } from "../../core/cotas.js";
import { t } from "../../i18n/index.js";

/**
 * A segunda linha do botao que gasta a cota.
 *
 * Dentro do botao, e nao solta no topo da tela: o numero so interessa no
 * momento de decidir se vale a pena gastar mais uma, e esse momento e o dedo
 * indo para o botao.
 *
 * Some inteira para quem e Premium: um contador que nunca desce e so ruido num
 * botao que a pessoa ja pagou para usar sem limite.
 *
 * @param {string} ferramenta  `CATALOGO` ou `CHECAGEM` de core/cotas.js
 */
export function createContadorCota(ferramenta) {
  const linha = document.createElement("p");
  linha.className = "cota";

  return {
    element: linha,

    atualizar() {
      const sobrando = restantes(ferramenta);

      /* Some em dois casos. Para quem e Premium, um contador que nunca desce e
         ruido no topo de uma tela ja paga. E no zero, porque o cadeado logo
         abaixo ja diz que acabou — "0 de 3" ali seria a mesma frase duas
         vezes, e a segunda nao acrescenta nada. */
      linha.hidden = isPremium() || sobrando === 0;
      if (linha.hidden) return;

      linha.textContent = t(`cota.${ferramenta}`, {
        restantes: String(sobrando),
        total: String(LIMITE_FREE),
      });
    },
  };
}
