import * as React from "react";

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

export interface DismissableLayerOptions {
  open: boolean;
  onClose: () => void;
  /** Lock body scroll while open (modals/drawers). Default true. */
  lockScroll?: boolean;
  /** Trap Tab focus within the container (modals/drawers). Default true. */
  trapFocus?: boolean;
}

/**
 * Shared overlay behavior for Dialog / Sheet (and the focus/escape parts of menus):
 * Esc-to-close, optional body-scroll lock, focus trap, and focus restoration to the
 * element that was focused before opening.
 */
export function useDismissableLayer<T extends HTMLElement>({
  open,
  onClose,
  lockScroll = true,
  trapFocus = true,
}: DismissableLayerOptions) {
  const ref = React.useRef<T>(null);
  const onCloseRef = React.useRef(onClose);
  onCloseRef.current = onClose;

  // Remember and restore the previously-focused element.
  const previousFocus = React.useRef<HTMLElement | null>(null);

  React.useEffect(() => {
    if (!open) return;
    previousFocus.current = document.activeElement as HTMLElement | null;

    const node = ref.current;
    // Move focus into the layer.
    const firstFocusable = node?.querySelector<HTMLElement>(FOCUSABLE);
    if (firstFocusable) {
      firstFocusable.focus();
    } else {
      node?.focus();
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key === "Tab" && trapFocus && node) {
        const items = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
          (el) => el.offsetParent !== null || el === document.activeElement,
        );
        const first = items[0];
        const last = items[items.length - 1];
        if (!first || !last) {
          e.preventDefault();
          node.focus();
          return;
        }
        const active = document.activeElement;
        if (e.shiftKey && active === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener("keydown", onKeyDown, true);

    let prevOverflow = "";
    if (lockScroll) {
      prevOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }

    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      if (lockScroll) document.body.style.overflow = prevOverflow;
      // Restore focus to the trigger.
      previousFocus.current?.focus?.();
    };
  }, [open, lockScroll, trapFocus]);

  return ref;
}
