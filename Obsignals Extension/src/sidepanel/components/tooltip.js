/**
 * Tooltip bound to a trigger button.
 *
 * Opens on hover, on click and on keyboard focus; closes on Esc, on leaving the
 * trigger, or on a click outside — hover alone would leave the content
 * unreachable by keyboard and touch.
 * Nothing here is extension-specific; the side panel is a regular page.
 */

export function createTooltip(trigger, tip) {
  function open() {
    tip.hidden = false;
  }

  function close() {
    tip.hidden = true;
  }

  trigger.addEventListener("mouseenter", open);
  trigger.addEventListener("mouseleave", close);
  trigger.addEventListener("focus", open);
  trigger.addEventListener("blur", close);
  /* Open, never toggle: a mouse fires `mouseenter` before `click`, so toggling
     closed whatever hovering had just opened. Closing is left to Esc, to
     leaving the trigger, and to a click outside. */
  trigger.addEventListener("click", open);

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") close();
  });

  document.addEventListener("click", (event) => {
    if (!trigger.contains(event.target) && !tip.contains(event.target)) {
      close();
    }
  });

  return { open, close };
}
