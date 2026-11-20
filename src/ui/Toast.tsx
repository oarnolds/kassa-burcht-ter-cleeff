import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

type ToastOptions = { action?: { label: string; onClick(): void }; ms?: number };
type ToastApi = { show(message: string, opts?: ToastOptions): void };
type Shown = { id: number; message: string; action?: ToastOptions["action"] };

const DEFAULT_MS = 5000;

const ToastContext = createContext<ToastApi | null>(null);

/** Shows one short message at the bottom of the screen, optionally with one action, and takes it away again. */
export function ToastHost({ children }: { children: ReactNode }) {
  const [shown, setShown] = useState<Shown | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const nextId = useRef(1);

  const hide = useCallback(() => {
    clearTimeout(timer.current);
    setShown(null);
  }, []);

  const show = useCallback((message: string, opts: ToastOptions = {}) => {
    clearTimeout(timer.current);
    setShown({ id: nextId.current++, message, action: opts.action });
    timer.current = setTimeout(() => setShown(null), opts.ms ?? DEFAULT_MS);
  }, []);

  useEffect(() => () => clearTimeout(timer.current), []);

  const api = useMemo(() => ({ show }), [show]);
  return (
    <ToastContext.Provider value={api}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4">
        {shown && (
          <div
            key={shown.id}
            role="status"
            className="pointer-events-auto flex items-center gap-4 rounded-full bg-ink py-2 pr-2 pl-6 text-lg text-white shadow-lg"
          >
            <span className="py-2 pr-4">{shown.message}</span>
            {shown.action && (
              <button
                type="button"
                className="min-h-11 rounded-full bg-white px-5 font-semibold text-ink"
                onClick={() => {
                  const action = shown.action!;
                  hide();
                  action.onClick();
                }}
              >
                {shown.action.label}
              </button>
            )}
          </div>
        )}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error("useToast needs a ToastHost above it");
  return api;
}
