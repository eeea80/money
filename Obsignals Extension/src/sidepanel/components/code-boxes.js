/**
 * Six boxes that behave like one field.
 *
 * Everything here exists because a row of `maxlength="1"` inputs is not a code
 * field, it is six unrelated inputs: pasting fills one and discards the rest,
 * backspace strands the cursor in an empty box, and typing does not advance.
 * Each handler below is one of those.
 *
 * Shared by both places a code is asked for — confirming an address and
 * resetting a password. They ask for the same thing and must behave the same
 * way, and a second copy of this is a second set of these bugs.
 */

export const CODE_LENGTH = 6;

/**
 * @param {() => void} onComplete called when the last digit lands
 * @returns {{element: HTMLElement, value: () => string, focus: () => void,
 *            clear: () => void, setDisabled: (state: boolean) => void}}
 */
export function createCodeBoxes(onComplete = () => {}) {
  const element = document.createElement("div");
  element.className = "code";
  // A code is digits in an order — it reads the same way in every language.
  element.dir = "ltr";

  const boxes = Array.from({ length: CODE_LENGTH }, (_, index) => {
    const box = document.createElement("input");
    box.className = "code__box";
    box.type = "text";
    // Digits keyboard on touch, and no autocorrect trying to help.
    box.inputMode = "numeric";
    // Only the first: the browser offers the mailed code once, for the field
    // the code starts in.
    box.autocomplete = index === 0 ? "one-time-code" : "off";
    box.maxLength = 1;
    box.setAttribute("aria-label", `${index + 1}/${CODE_LENGTH}`);
    return box;
  });

  const value = () => boxes.map((box) => box.value).join("");

  /** Lays digits out from `start`, and stops where the boxes run out. */
  function spread(start, digits) {
    digits.split("").forEach((digit, offset) => {
      const box = boxes[start + offset];
      if (box) box.value = digit;
    });

    // The first empty box, or the last one when there is none — never past the
    // end, which would drop focus out of the field entirely.
    const next = boxes.findIndex((box) => !box.value);
    boxes[next === -1 ? CODE_LENGTH - 1 : next].focus();

    if (value().length === CODE_LENGTH) onComplete();
  }

  boxes.forEach((box, index) => {
    /* The paste is taken over rather than handled after the fact: with
       maxlength 1 the browser has already thrown five digits away by the time
       anything else runs. */
    box.addEventListener("paste", (event) => {
      event.preventDefault();
      const digits = (event.clipboardData?.getData("text") ?? "").replace(/\D/g, "");
      if (!digits) return;

      /* A whole code fills the row from the start, wherever it was dropped.
         Clicking a box before pasting is not a request to shift the digits
         along and lose the last of them. */
      const start = digits.length >= CODE_LENGTH ? 0 : index;
      spread(start, digits.slice(0, CODE_LENGTH - start));
    });

    box.addEventListener("input", () => {
      const digits = box.value.replace(/\D/g, "");
      box.value = "";
      if (digits) spread(index, digits);
    });

    box.addEventListener("keydown", (event) => {
      if (event.key === "Backspace" && !box.value && index > 0) {
        /* Deleting backwards out of an empty box. Without this the cursor sits
           in a box that is already empty and nothing appears to happen, which
           reads as a frozen field. */
        event.preventDefault();
        boxes[index - 1].value = "";
        boxes[index - 1].focus();
      }

      if (event.key === "ArrowLeft" && index > 0) boxes[index - 1].focus();
      if (event.key === "ArrowRight" && index < CODE_LENGTH - 1) boxes[index + 1].focus();
    });

    // Landing mid-row and typing would leave a gap; this sends any click to
    // where the next digit actually belongs.
    box.addEventListener("focus", () => box.select());
  });

  element.append(...boxes);

  return {
    element,
    value,
    focus: () => (boxes.find((box) => !box.value) ?? boxes[0]).focus(),
    clear: () => boxes.forEach((box) => (box.value = "")),
    setDisabled: (state) => boxes.forEach((box) => (box.disabled = state)),
  };
}
