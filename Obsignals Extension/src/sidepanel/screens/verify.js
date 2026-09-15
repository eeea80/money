import { t } from "../../i18n/index.js";
import { AuthError, confirmCode, sendCode, signOut } from "../../core/auth.js";
import { getAccount } from "../../core/account.js";
import { CODE_LENGTH, createCodeBoxes } from "../components/code-boxes.js";

/**
 * The second half of the door.
 *
 * Signing in is not the same as being reachable, and the panel needs both: a
 * subscription is claimed by address, so an address nobody has proved they own
 * is an address that could be claimed by anyone. Nobody gets past this.
 *
 * The boxes are shared with the password reset, which asks for the same thing —
 * see `components/code-boxes.js`.
 *
 * The code is asked for when the screen opens, not when the account is created:
 * a panel closed halfway through would otherwise leave someone with an account
 * they can never reach, waiting for a mail that was already sent and expired.
 */

export function createVerifyScreen(root, { onVerified = () => {}, onSignOut = () => {} } = {}) {
  let cooling = 0;
  let timer = null;
  let asked = false;

  function render() {
    const form = document.createElement("form");
    form.className = "auth";
    form.noValidate = true;

    const notice = document.createElement("p");
    notice.className = "auth__notice";
    notice.setAttribute("role", "alert");
    notice.hidden = true;

    const submit = primaryButton(t("verify.submit"));

    // Six digits is short enough that asking someone to also press a button is
    // a step for the sake of one.
    const code = createCodeBoxes(() => hand(code, notice, submit));
    const resend = link(resendLabel(), () => ask({ resend: true }, notice, resend));

    submit.addEventListener("click", (event) => {
      event.preventDefault();
      hand(code, notice, submit);
    });

    form.append(heading(), code.element, notice, submit, resend, leave());
    root.replaceChildren(form);

    // Once per opening: the screen is redrawn on every language change, and a
    // mail per redraw would be absurd.
    if (!asked) {
      asked = true;
      ask({}, notice, resend);
    }

    code.focus();
  }

  /**
   * @param {{resend?: boolean}} options
   */
  async function ask(options, notice, resendLink) {
    try {
      const { retryIn = 0 } = await sendCode(options);
      if (options.resend) say(notice, t("verify.sent"), { problem: false });
      startCooldown(retryIn, resendLink);
    } catch (error) {
      say(notice, describe(error), { problem: true });
    }
  }

  async function hand(code, notice, submit) {
    const given = code.value();
    if (given.length !== CODE_LENGTH) return;

    notice.hidden = true;
    submit.disabled = true;
    submit.textContent = t("auth.working");
    code.setDisabled(true);

    try {
      await confirmCode(given);
      onVerified();
    } catch (error) {
      say(notice, describe(error), { problem: true });
      submit.disabled = false;
      submit.textContent = t("verify.submit");
      code.setDisabled(false);
      // Emptied rather than left to be edited: a rejected code is retyped, and
      // hunting for the wrong digit among six is worse than typing six.
      code.clear();
      code.focus();
    }
  }

  /** Counts the resend link down rather than letting it fail silently. */
  function startCooldown(seconds, resendLink) {
    clearInterval(timer);
    cooling = seconds;
    paintResend(resendLink);

    if (cooling <= 0) return;

    timer = setInterval(() => {
      cooling -= 1;
      paintResend(resendLink);
      if (cooling <= 0) clearInterval(timer);
    }, 1000);
  }

  function paintResend(resendLink) {
    resendLink.textContent = resendLabel();
    resendLink.disabled = cooling > 0;
  }

  const resendLabel = () =>
    cooling > 0 ? t("verify.resendIn").replace("{seconds}", cooling) : t("verify.resend");

  // --- pieces ---------------------------------------------------------------

  function heading() {
    const box = document.createElement("div");
    box.className = "auth__head";

    const title = document.createElement("h1");
    title.className = "auth__title";
    title.textContent = t("verify.title");

    const subtitle = document.createElement("p");
    subtitle.className = "auth__subtitle";
    // The address is in the sentence because it is the thing most likely to be
    // wrong, and seeing the typo is faster than being told there is one.
    subtitle.textContent = t("verify.sub").replace("{email}", getAccount().email ?? "");

    box.append(title, subtitle);
    return box;
  }

  function primaryButton(label) {
    const button = document.createElement("button");
    button.type = "submit";
    button.className = "auth__submit";
    button.textContent = label;
    return button;
  }

  /** The way out for someone who cannot reach that inbox at all. */
  function leave() {
    return link(t("auth.signOut"), () => {
      signOut();
      onSignOut();
    });
  }

  function link(label, onClick) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "auth__link";
    button.textContent = label;
    button.addEventListener("click", onClick);
    return button;
  }

  function describe(error) {
    return error instanceof AuthError ? t(error.key) : t("auth.errorGeneric");
  }

  function say(notice, text, { problem }) {
    notice.textContent = text;
    notice.classList.toggle("auth__notice--error", problem);
    notice.hidden = false;
  }

  /** Reopening the gate is a fresh visit, and asks for a code again. */
  function reset() {
    asked = false;
    clearInterval(timer);
    cooling = 0;
  }

  return { render, reset };
}
