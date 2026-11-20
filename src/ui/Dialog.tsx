import { useEffect, useId, useRef, type ReactNode } from "react";

type Props = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** False for a dialog that must be answered with one of its own buttons. */
  dismissable?: boolean;
  /** Wider, for dialogs with a number pad or a form. */
  wide?: boolean;
};

/** A modal dialog over a dimmed page. Escape or a tap beside it closes it, unless it is not dismissable. */
export function Dialog({ open, onClose, title, children, dismissable = true, wide = false }: Props) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || !dismissable) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, dismissable, onClose]);

  useEffect(() => {
    if (open) panel.current?.focus();
  }, [open]);

  if (!open) return null;
  return (
    <div
      data-testid="dialog-backdrop"
      className="fixed inset-0 z-40 flex items-center justify-center bg-ink/50 p-4"
      onClick={(event) => {
        if (dismissable && event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`max-h-full w-full overflow-auto rounded-3xl bg-white p-6 shadow-xl outline-none ${wide ? "max-w-2xl" : "max-w-md"}`}
      >
        <h2 id={titleId} className="mb-4 text-2xl font-bold">
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}
