import { t } from "../../i18n/index.js";
import { deleteAccount } from "../../core/auth.js";
import { getAccount } from "../../core/account.js";

/**
 * Danger zone.
 *
 * Deleting an account ends the subscription and removes the record, and none of
 * it comes back. So the screen is built to be hard to complete by accident:
 * the address has to be typed out, and then a sentence that cannot be produced
 * by a slip of the hand. The button stays dead until both are right — the same
 * shape GitHub uses, for the same reason.
 *
 * Typed, not pasted from the label above it: the point of the exercise is that
 * someone reads what they are about to lose.
 */

export function createDeleteAccountScreen(root, { onDeleted = () => {} } = {}) {
  render();

  function render() {
    const account = getAccount();

    const form = document.createElement("form");
    form.className = "danger";
    form.noValidate = true;

    const warning = document.createElement("p");
    warning.className = "danger__warning";
    warning.textContent = t("danger.warning");

    const losses = document.createElement("ul");
    losses.className = "danger__list";
    ["losesAccess", "losesSubscription", "losesForever"].forEach((key) => {
      const item = document.createElement("li");
      item.textContent = t(`danger.${key}`);
      losses.append(item);
    });

    const email = field({
      id: "danger-email",
      label: t("danger.typeEmail", { value: account.email ?? "" }),
      autocomplete: "off",
    });

    const phrase = field({
      id: "danger-phrase",
      label: t("danger.typePhrase", { value: t("danger.phrase") }),
      autocomplete: "off",
    });

    const notice = document.createElement("p");
    notice.className = "danger__notice";
    notice.setAttribute("role", "alert");
    notice.hidden = true;

    const confirm = document.createElement("button");
    confirm.type = "submit";
    confirm.className = "danger__button";
    confirm.textContent = t("danger.confirm");
    confirm.disabled = true;

    /* Enabled only when both match. Comparing the address without case is the
       one leniency here: mail addresses are not case sensitive, and refusing a
       capital letter would just look broken. */
    const check = () => {
      const sameEmail =
        email.input.value.trim().toLowerCase() === (account.email ?? "").toLowerCase();
      const samePhrase = phrase.input.value.trim() === t("danger.phrase");
      confirm.disabled = !(sameEmail && samePhrase);
    };

    email.input.addEventListener("input", check);
    phrase.input.addEventListener("input", check);

    form.addEventListener("submit", async (event) => {
      event.preventDefault();

      confirm.disabled = true;
      confirm.textContent = t("auth.working");
      notice.hidden = true;

      try {
        await deleteAccount();
        onDeleted();
      } catch {
        notice.textContent = t("auth.errorGeneric");
        notice.hidden = false;
        confirm.textContent = t("danger.confirm");
        check();
      }
    });

    form.append(
      // No heading here: the screen already carries one in its header, and the
      // same two words twice reads as a mistake.
      warning,
      losses,
      email.wrapper,
      phrase.wrapper,
      notice,
      confirm
    );

    root.replaceChildren(form);
  }

  function field({ id, label, autocomplete }) {
    const caption = document.createElement("label");
    caption.className = "danger__label";
    caption.htmlFor = id;
    caption.textContent = label;

    const input = document.createElement("input");
    input.id = id;
    input.className = "danger__input";
    input.type = "text";
    input.autocomplete = autocomplete;
    // Nothing here should be corrected or completed for the user — that would
    // defeat the point of asking them to type it.
    input.autocapitalize = "off";
    input.spellcheck = false;

    const wrapper = document.createElement("div");
    wrapper.className = "danger__field";
    wrapper.append(caption, input);

    return { wrapper, input };
  }

  return { render };
}
