/**
 * Schmaler Toast-Manager (kein externes Lib).
 *
 * Public API:
 *   - `<ToastProvider>` ums App-Root
 *   - `useToast()`-Hook → `showToast(msg, opts?)`
 *
 * Toasts verschwinden nach `duration` (Default 5 s). Sie sind primär
 * für eingehende User-Events (Invite, Request-Decision, Owner-Change).
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

interface Toast {
  id: number;
  message: ReactNode;
  variant: "info" | "success" | "warning" | "error";
  duration: number;
}

interface ToastContextValue {
  showToast: (message: ReactNode, opts?: { variant?: Toast["variant"]; duration?: number }) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const showToast = useCallback<ToastContextValue["showToast"]>((message, opts) => {
    const id = Date.now() + Math.random();
    const variant = opts?.variant ?? "info";
    const duration = opts?.duration ?? 5_000;
    setToasts((prev) => [...prev, { id, message, variant, duration }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, duration);
  }, []);

  const ctx = useMemo<ToastContextValue>(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={ctx}>
      {children}
      <ToastViewport
        toasts={toasts}
        onDismiss={(id) => setToasts((p) => p.filter((t) => t.id !== id))}
      />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast außerhalb von <ToastProvider>");
  return ctx;
}

const VARIANT_STYLE: Record<Toast["variant"], string> = {
  info: "bg-stone-900 text-white",
  success: "bg-emerald-600 text-white",
  warning: "bg-amber-500 text-white",
  error: "bg-rose-600 text-white",
};

function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss: (id: number) => void;
}) {
  return (
    <div
      aria-live="polite"
      aria-atomic="true"
      className="fixed top-4 right-4 z-50 flex flex-col gap-2 w-80 max-w-[90vw]"
    >
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={() => onDismiss(t.id)} />
      ))}
    </div>
  );
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  // CSS-Animation per Mount-Fade-In. Bei Dismiss-Click hart entfernen.
  useEffect(() => {
    // no-op; nur damit React den Effect-Hook anerkennt, falls wir später
    // Audio-Cues etc. anhängen wollen.
  }, []);
  return (
    <div
      role="status"
      className={`rounded shadow-lg px-3 py-2 text-sm ${VARIANT_STYLE[toast.variant]} flex items-start gap-2`}
    >
      <div className="flex-1">{toast.message}</div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Schließen"
        className="opacity-70 hover:opacity-100"
      >
        ×
      </button>
    </div>
  );
}
