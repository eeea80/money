import { t } from "../../i18n/index.js";
import {
  AuthError,
  Cancelled,
  beginGoogle,
  completeReset,
  linkGoogle,
  resetPassword,
  signIn,
  signInWithGoogle,
  signUp,
} from "../../core/auth.js";
import { CODE_LENGTH, createCodeBoxes } from "../components/code-boxes.js";
import { createIcon, createGoogleMark } from "../components/icons.js";
import { LINKS } from "../../core/links.js";

/**
 * The gate into the panel.
 *
 * Not a screen inside the app — nobody gets past it without an account, so
 * there is no header and nothing to go back to.
 *
 * Laid out the way sign-in is laid out everywhere: the one-tap provider first,
 * a divider, then the email pair, then the single dark button. People arrive
 * already knowing this shape, and a form they can complete without reading is
 * the whole point.
 *
 * Three views rather than three screens. Resetting a password is its own view
 * because it asks a different question and has a different button — crowding it
 * under the password field made it look like part of signing in.
 *
 * The password lives in the input and in the request, nowhere else. What is
 * kept afterwards is the token — see `auth.js`.
 */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Firebase refuses anything shorter, and hearing it from the server is slower. */
const MIN_PASSWORD = 6;

const VIEW = { SIGN_IN: "signIn", SIGN_UP: "signUp", RESET: "reset" };

export function createSignInScreen(root, { onSignedIn = () => {} } = {}) {
  let view = VIEW.SIGN_IN;
  let revealed = false;

  /**
   * A Google token waiting for the password that lets it be linked instead of
   * signed in with. Set only when the server says the address already has one —
   * see `beginGoogle`.
   */
  let pending = null;

  /**
   * The address a code was just mailed to. Set only between the two halves of
   * resetting a password — asking for the code, and choosing the new one.
   */
  let resetting = null;

  render();

  function render() {
    const form = document.createElement("form");
    form.className = "auth";
    form.noValidate = true; // the messages are ours, and translated

    const notice = document.createElement("p");
    notice.className = "auth__notice";
    notice.setAttribute("role", "alert");
    notice.hidden = true;

    form.append(heading(), ...body(notice));

    root.replaceChildren(form);

    // Only after the form is on screen, since this is the instruction for it —
    // and only on the view that has the password field it points at.
    if (pending && view === VIEW.SIGN_IN) {
      say(notice, t("auth.linkGoogle"), { problem: false });
      root.querySelector("#auth-password")?.focus();
    }
  }

  function heading() {
    const box = document.createElement("div");
    box.className = "auth__head";

    const title = document.createElement("h1");
    title.className = "auth__title";

    const subtitle = document.createElement("p");
    subtitle.className = "auth__subtitle";

    const copy = {
      [VIEW.SIGN_IN]: ["auth.welcome", "auth.introSignIn"],
      [VIEW.SIGN_UP]: ["auth.signUp", "auth.introSignUp"],
      [VIEW.RESET]: resetting
        ? ["reset.title", "reset.sub"]
        : ["auth.resetTitle", "auth.resetSub"],
    }[view];

    title.textContent = t(copy[0]);
    // Only the second half has an address to name; the slot is absent from the
    // rest, so this passes through them untouched.
    subtitle.textContent = t(copy[1]).replace("{email}", resetting ?? "");

    box.append(title, subtitle);
    return box;
  }

  /** The middle of the form, which is the only part the view changes. */
  function body(notice) {
    if (view === VIEW.RESET) return resetView(notice);

    const email = textField({
      id: "auth-email",
      placeholder: t("auth.email"),
      type: "email",
      autocomplete: "username",
    });

    const password = passwordField();

    // The address is the one Google just proved; typing it again proves nothing.
    if (pending && view === VIEW.SIGN_IN) email.input.value = pending.email;

    const submit = primaryButton(t("auth.continue"));
    const form = { email, password, notice, submit };

    submit.addEventListener("click", (event) => {
      event.preventDefault();
      submitCredentials(form);
    });

    return [
      googleButton(notice),
      divider(),
      email.wrapper,
      password.wrapper,
      notice,
      submit,
      // Under the button that accepts them, which is what makes clicking it the
      // acceptance. A checkbox would be a step that exists only to be ticked:
      // terms are not optional, so refusing them is the same as not signing up.
      //
      // On both views, not just sign-up: the Google button sits on the sign-in
      // view too, and it creates an account for anyone who has never used one.
      // Showing the terms only under "sign up" would let a whole class of new
      // users accept them without ever being shown them.
      terms(),
      ...footerLinks(),
    ];
  }

  /**
   * Resetting, in two halves: which address, then the code and the new password.
   *
   * The code stands in for the old password, which is the one thing the person
   * here does not have. That works because of what surrounds it — mailed to the
   * address, ten minutes, five guesses — and not because six digits are hard.
   */
  function resetView(notice) {
    return resetting ? chooseView(notice) : askView(notice);
  }

  function askView(notice) {
    const email = textField({
      id: "auth-email",
      placeholder: t("auth.email"),
      type: "email",
      autocomplete: "username",
    });

    const submit = primaryButton(t("auth.resetSubmit"));

    submit.addEventListener("click", async (event) => {
      event.preventDefault();

      const address = email.input.value.trim();
      if (!EMAIL.test(address)) {
        return fail(notice, email.input, t("auth.errorEmail"));
      }

      submit.disabled = true;
      submit.textContent = t("auth.working");

      try {
        await resetPassword(address);
      } catch (error) {
        /* The server answers the same whether or not the address has an
           account, so anything caught here is a real failure — offline, or us
           being down — and hiding it would strand someone at a dead button. */
        say(notice, describe(error), { problem: true });
        submit.disabled = false;
        submit.textContent = t("auth.resetSubmit");
        return;
      }

      // Moves on either way. Stopping to say "no such account" would turn this
      // into a way of finding out who is a customer.
      resetting = address;
      render();
    });

    return [email.wrapper, notice, submit, link("auth.backToLogin", () => go(VIEW.SIGN_IN))];
  }

  function chooseView(notice) {
    const password = textField({
      id: "auth-password",
      placeholder: t("reset.password"),
      type: "password",
      autocomplete: "new-password",
    });

    const submit = primaryButton(t("reset.submit"));
    const code = createCodeBoxes(() => password.input.focus());

    submit.addEventListener("click", async (event) => {
      event.preventDefault();

      const given = code.value();
      const secret = password.input.value;

      if (given.length !== CODE_LENGTH) {
        say(notice, t("verify.errorWrong"), { problem: true });
        return code.focus(); // where the gap is, not where the cursor last was
      }

      if (secret.length < MIN_PASSWORD) {
        return fail(notice, password.input, t("auth.errorShortPassword"));
      }

      notice.hidden = true;
      submit.disabled = true;
      submit.textContent = t("auth.working");

      try {
        await completeReset(resetting, given, secret);
        resetting = null;
        onSignedIn();
      } catch (error) {
        say(notice, describe(error), { problem: true });
        submit.disabled = false;
        submit.textContent = t("reset.submit");
        code.clear();
        code.focus();
      }
    });

    return [
      code.element,
      password.wrapper,
      notice,
      submit,
      // Back to the address step, not to sign-in: getting here with a typo in
      // the address is the likeliest reason no code arrived.
      link("auth.resetAgain", () => {
        resetting = null;
        render();
      }),
    ];
  }

  async function submitCredentials({ email, password, notice, submit }) {
    const address = email.input.value.trim();
    const secret = password.input.value;

    if (!EMAIL.test(address)) {
      return fail(notice, email.input, t("auth.errorEmail"));
    }

    if (secret.length < MIN_PASSWORD) {
      return fail(notice, password.input, t("auth.errorShortPassword"));
    }

    notice.hidden = true;
    submit.disabled = true;
    submit.textContent = t("auth.working");

    const creating = view === VIEW.SIGN_UP;

    try {
      await (creating ? signUp(address, secret) : signIn(address, secret));

      if (pending) {
        /* Best effort on purpose: they are signed in, which is what they asked
           for. A link that failed is offered again the next time they press the
           button, and costs nothing in the meantime. */
        await linkGoogle(pending.token).catch(() => {});
        pending = null;
      }

      onSignedIn();
    } catch (error) {
      fail(notice, password.input, describe(error));
      submit.disabled = false;
      submit.textContent = t("auth.continue");
    }
  }

  // --- pieces ---------------------------------------------------------------

  /**
   * White button with the Google mark, the shape Google's own guidelines ask
   * for. It sits above the divider because for most people it is the whole
   * form.
   */
  function googleButton(notice) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "auth__google";
    button.append(createGoogleMark(18), textSpan(t("auth.google")));

    button.addEventListener("click", async () => {
      notice.hidden = true;
      button.disabled = true;

      try {
        const { token, email, linkFirst } = await beginGoogle();

        if (linkFirst) {
          // Not a refusal — one password away from having both. Signing in here
          // instead would take the password away without saying so.
          pending = { token, email };
          return go(VIEW.SIGN_IN);
        }

        await signInWithGoogle(token);
        onSignedIn();
      } catch (error) {
        // Nothing to say about a window the user closed on purpose.
        if (!(error instanceof Cancelled)) {
          say(notice, describe(error), { problem: true });
        }
        button.disabled = false;
      }
    });

    return button;
  }

  /**
   * The sentence with the two documents linked inside it.
   *
   * Built from a template with named slots rather than glued from pieces: word
   * order moves between languages, and in Arabic the sentence runs the other
   * way entirely. The locale owns where the links land.
   */
  function terms() {
    const line = document.createElement("p");
    line.className = "auth__terms";

    const parts = t("auth.terms").split(/(\{terms\}|\{privacy\})/);

    parts.forEach((part) => {
      if (part === "{terms}") return line.append(legal(t("auth.termsLink"), LINKS.terms));
      if (part === "{privacy}") return line.append(legal(t("auth.privacyLink"), LINKS.privacy));
      if (part) line.append(part);
    });

    return line;
  }

  function legal(text, href) {
    const link = document.createElement("a");
    link.className = "auth__legal";
    link.href = href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = text;
    return link;
  }

  function divider() {
    const rule = document.createElement("p");
    rule.className = "auth__divider";
    rule.append(textSpan(t("auth.orEmail")));
    return rule;
  }

  /** Below the button: the way out of the view you are in. */
  function footerLinks() {
    if (view === VIEW.SIGN_UP) {
      return [link("auth.haveAccount", () => go(VIEW.SIGN_IN))];
    }

    return [
      link("auth.forgot", () => go(VIEW.RESET), { strong: true }),
      link("auth.noAccount", () => go(VIEW.SIGN_UP)),
    ];
  }

  function go(next) {
    view = next;
    revealed = false;
    resetting = null; // leaving the reset is abandoning it, not pausing it
    render();
  }

  function link(key, onClick, { strong = false } = {}) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = strong ? "auth__link auth__link--strong" : "auth__link";
    button.textContent = t(key);
    button.addEventListener("click", onClick);
    return button;
  }

  function primaryButton(label) {
    const button = document.createElement("button");
    button.type = "submit";
    button.className = "auth__submit";
    button.textContent = label;
    return button;
  }

  function describe(error) {
    return error instanceof AuthError ? t(error.key) : t("auth.errorGeneric");
  }

  function fail(notice, input, text) {
    say(notice, text, { problem: true });
    input.focus();
  }

  /** One line for both outcomes; the colour is what separates them. */
  function say(notice, text, { problem }) {
    notice.textContent = text;
    notice.classList.toggle("auth__notice--error", problem);
    notice.hidden = false;
  }

  function textSpan(text) {
    const span = document.createElement("span");
    span.textContent = text;
    return span;
  }

  /**
   * Placeholder instead of a label above the box.
   *
   * Two fields whose contents are unmistakable — an address and a password —
   * and a column this narrow, where every stacked label pushes the button
   * further from the fold.
   */
  function textField({ id, placeholder, type, autocomplete }) {
    const input = document.createElement("input");
    input.id = id;
    input.className = "auth__input";
    input.type = type;
    input.placeholder = placeholder;
    input.autocomplete = autocomplete;
    input.setAttribute("aria-label", placeholder);

    const wrapper = document.createElement("div");
    wrapper.className = "auth__field";
    wrapper.append(input);

    return { wrapper, input };
  }

  /**
   * Password with a reveal toggle.
   *
   * Worth the extra control: it is the field people mistype and cannot check,
   * and a wrong password otherwise costs a whole round trip to find out.
   */
  function passwordField() {
    const { wrapper, input } = textField({
      id: "auth-password",
      placeholder: t("auth.password"),
      type: revealed ? "text" : "password",
      // Tells the password manager to offer a new one when creating an account
      // and the saved one when signing in.
      autocomplete: view === VIEW.SIGN_UP ? "new-password" : "current-password",
    });

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "auth__reveal";
    paintToggle(toggle);

    toggle.addEventListener("click", () => {
      revealed = !revealed;
      input.type = revealed ? "text" : "password";
      paintToggle(toggle);
      input.focus();
    });

    wrapper.append(toggle);
    return { wrapper, input };
  }

  function paintToggle(toggle) {
    toggle.replaceChildren(createIcon(revealed ? "eyeOff" : "eye", 17));
    toggle.setAttribute("aria-label", t(revealed ? "auth.hide" : "auth.show"));
  }

  return { render };
}
