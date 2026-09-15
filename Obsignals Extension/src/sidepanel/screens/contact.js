import { t } from "../../i18n/index.js";
import { getAccount } from "../../core/account.js";
import { AuthError, sendSupportMessage } from "../../core/auth.js";

/**
 * Contact form.
 *
 * The message goes to the server, which forwards it with the account attached.
 * It used to hand a prefilled `mailto:` to the user's own mail client and then
 * claim it had been sent — which was true only if they then pressed send in
 * another application, and did nothing at all for anyone without a mail client
 * configured.
 *
 * The address field is still here because people expect to see where a reply
 * will land, but it is read-only: the reply goes to the account, not to
 * whatever is typed.
 */

export function createContactScreen(root) {
  render();

  function render() {
    const form = document.createElement("form");
    form.className = "contact";
    form.noValidate = true; // custom messages, translated

    const intro = document.createElement("p");
    intro.className = "contact__intro";
    intro.textContent = t("contact.intro");

    const account = getAccount();
    const email = field({
      id: "contact-email",
      label: t("contact.email"),
      placeholder: t("contact.emailPlaceholder"),
      type: "email",
      value: account.email ?? "",
      readOnly: true,
    });

    const subject = selectField({
      id: "contact-subject",
      label: t("contact.subject"),
      options: [
        ["bug", t("contact.subjectBug")],
        ["signals", t("contact.subjectSignals")],
        ["billing", t("contact.subjectBilling")],
        ["other", t("contact.subjectOther")],
      ],
    });

    const message = textareaField({
      id: "contact-message",
      label: t("contact.message"),
      placeholder: t("contact.messagePlaceholder"),
    });

    const error = document.createElement("p");
    error.className = "contact__error";
    error.setAttribute("role", "alert");
    error.hidden = true;

    const submit = document.createElement("button");
    submit.type = "submit";
    submit.className = "prem__cta";
    submit.textContent = t("contact.send");

    form.append(intro, email.wrapper, subject.wrapper, message.wrapper, error, submit);

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      send({ subject, message, error, submit });
    });

    root.replaceChildren(form);
  }

  /** Validates, then posts. The button only claims success once it has one. */
  async function send({ subject, message, error, submit }) {
    const body = message.input.value.trim();

    if (!body) {
      return fail(error, message.input, t("contact.errorMessage"));
    }

    error.hidden = true;
    submit.disabled = true;
    submit.textContent = t("auth.working");

    try {
      /* The chosen label, not its value: it goes straight into a subject line
         a human reads, and "billing" is worse than "Billing question" there. */
      await sendSupportMessage({
        subject: subject.input.selectedOptions[0].textContent,
        message: body,
      });
    } catch (caught) {
      submit.disabled = false;
      submit.textContent = t("contact.send");
      return fail(
        error,
        message.input,
        caught instanceof AuthError ? t(caught.key) : t("auth.errorGeneric")
      );
    }

    message.input.value = "";
    submit.textContent = t("contact.sent");
    setTimeout(() => {
      submit.textContent = t("contact.send");
      submit.disabled = false;
    }, 2500);
  }

  function fail(error, input, text) {
    error.textContent = text;
    error.hidden = false;
    input.focus();
  }

  // --- field builders ---

  function labelFor(id, text) {
    const label = document.createElement("label");
    label.className = "contact__label";
    label.htmlFor = id;
    label.textContent = text;
    return label;
  }

  function wrap(...children) {
    const wrapper = document.createElement("div");
    wrapper.className = "contact__field";
    wrapper.append(...children);
    return wrapper;
  }

  function field({ id, label, placeholder, type, value, readOnly = false }) {
    const input = document.createElement("input");
    input.id = id;
    input.className = "input";
    input.type = type;
    input.placeholder = placeholder;
    input.value = value;
    input.autocomplete = "email";

    /* Shown so the writer knows where a reply lands, not asked. `readOnly`
       rather than `disabled`: disabled greys the text out and drops it from the
       tab order, and this is information worth reading. */
    input.readOnly = readOnly;

    return { wrapper: wrap(labelFor(id, label), input), input };
  }

  function selectField({ id, label, options }) {
    const input = document.createElement("select");
    input.id = id;
    input.className = "input";

    options.forEach(([value, text]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = text;
      input.append(option);
    });

    return { wrapper: wrap(labelFor(id, label), input), input };
  }

  function textareaField({ id, label, placeholder }) {
    const input = document.createElement("textarea");
    input.id = id;
    input.className = "input input--area";
    input.rows = 5;
    input.placeholder = placeholder;

    return { wrapper: wrap(labelFor(id, label), input), input };
  }

  return { render };
}
