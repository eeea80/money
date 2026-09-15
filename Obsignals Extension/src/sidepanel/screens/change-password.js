import { t } from "../../i18n/index.js";
import { AuthError, changePassword } from "../../core/auth.js";
import { createIcon } from "../components/icons.js";

/**
 * Change password.
 *
 * Three fields, in the order everyone expects: prove the current one, then say
 * the new one twice. The repeat is not ceremony — a password is typed blind,
 * and a typo here locks someone out of an account they are still holding.
 *
 * Built from the same field and button vocabulary as the sign-in screen. It is
 * the same kind of form, and giving it its own look would only make the panel
 * feel like two products.
 */

const MIN_PASSWORD = 6;

export function createChangePasswordScreen(root, { onChanged = () => {} } = {}) {
  /** Which field is showing its text — one at a time, never all three. */
  let revealed = null;

  render();

  function render() {
    const form = document.createElement("form");
    form.className = "auth auth--form";
    form.noValidate = true;

    const current = passwordField("current", t("password.current"), "current-password");
    const next = passwordField("new", t("password.new"), "new-password");
    const repeat = passwordField("repeat", t("password.confirm"), "new-password");

    const notice = document.createElement("p");
    notice.className = "auth__notice";
    notice.setAttribute("role", "alert");
    notice.hidden = true;

    const submit = document.createElement("button");
    submit.type = "submit";
    submit.className = "auth__submit";
    submit.textContent = t("password.submit");

    form.append(
      current.wrapper,
      next.wrapper,
      repeat.wrapper,
      notice,
      submit
    );

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      save({ current, next, repeat, notice, submit });
    });

    root.replaceChildren(form);
  }

  async function save({ current, next, repeat, notice, submit }) {
    const now = current.input.value;
    const wanted = next.input.value;

    if (wanted.length < MIN_PASSWORD) {
      return fail(notice, next.input, t("auth.errorShortPassword"));
    }

    if (wanted !== repeat.input.value) {
      return fail(notice, repeat.input, t("password.errorMismatch"));
    }

    // Accepting this would report success and change nothing, which is the
    // worst of both: the user believes the old password is gone.
    if (wanted === now) {
      return fail(notice, next.input, t("password.errorSame"));
    }

    notice.hidden = true;
    submit.disabled = true;
    submit.textContent = t("auth.working");

    try {
      await changePassword(now, wanted);
      say(notice, t("password.done"), { problem: false });
      submit.textContent = t("password.submit");
      onChanged();
    } catch (error) {
      fail(notice, current.input, describe(error));
      submit.disabled = false;
      submit.textContent = t("password.submit");
    }
  }

  function describe(error) {
    return error instanceof AuthError ? t(error.key) : t("auth.errorGeneric");
  }

  function fail(notice, input, text) {
    say(notice, text, { problem: true });
    input.focus();
  }

  function say(notice, text, { problem }) {
    notice.textContent = text;
    notice.classList.toggle("auth__notice--error", problem);
    notice.hidden = false;
  }

  /**
   * A field with its own reveal toggle.
   *
   * Only one at a time: showing all three at once would put the old password
   * and the new one on screen together, which is exactly the moment somebody
   * looks over a shoulder.
   */
  function passwordField(name, label, autocomplete) {
    const id = `password-${name}`;
    const shown = revealed === name;

    const caption = document.createElement("label");
    caption.className = "auth__label";
    caption.htmlFor = id;
    caption.textContent = label;

    const input = document.createElement("input");
    input.id = id;
    input.className = "auth__input";
    input.type = shown ? "text" : "password";
    input.autocomplete = autocomplete;

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "auth__reveal";
    toggle.append(createIcon(shown ? "eyeOff" : "eye", 17));
    toggle.setAttribute("aria-label", t(shown ? "auth.hide" : "auth.show"));

    toggle.addEventListener("click", () => {
      const values = readAll();
      revealed = shown ? null : name;
      render();
      writeAll(values);
      document.getElementById(id)?.focus();
    });

    const box = document.createElement("div");
    box.className = "auth__field";
    box.append(input, toggle);

    const wrapper = document.createElement("div");
    wrapper.className = "auth__labelled";
    wrapper.append(caption, box);

    return { wrapper, input };
  }

  /* Toggling rebuilds the form, so what was typed has to survive the rebuild. */

  function readAll() {
    return ["current", "new", "repeat"].map(
      (name) => document.getElementById(`password-${name}`)?.value ?? ""
    );
  }

  function writeAll(values) {
    ["current", "new", "repeat"].forEach((name, index) => {
      const input = document.getElementById(`password-${name}`);
      if (input) input.value = values[index];
    });
  }

  return { render };
}
