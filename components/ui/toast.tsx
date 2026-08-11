"use client";

/**
 * Toasts.
 *
 * Inline edits save without a page reload, so the only signal that something
 * happened is here. Errors are sticky until dismissed — a failed save that
 * quietly disappears is how an operator ends up believing work is recorded when
 * it is not. Successes auto-dismiss quickly and stay understated.
 */

import * as React from "react";
import { cn } from "@/lib/ui/cn";

export type ToastTone = "success" | "error" | "info";

interface Toast {
  id: number;
  tone: ToastTone;
  message: string;
  detail?: string;
}

interface ToastContextValue {
  toast: (message: string, options?: { tone?: ToastTone; detail?: string }) => void;
  success: (message: string) => void;
  error: (message: string, detail?: string) => void;
}

const ToastContext = React.createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const context = React.useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within <ToastProvider>.");
  }
  return context;
}

const AUTO_DISMISS_MS: Record<ToastTone, number | null> = {
  success: 2200,
  info: 3500,
  error: null, // Errors require acknowledgement.
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<Toast[]>([]);
  const nextId = React.useRef(1);

  const dismiss = React.useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const toast = React.useCallback<ToastContextValue["toast"]>(
    (message, options) => {
      const tone = options?.tone ?? "info";
      const id = nextId.current++;

      setToasts((current) => [
        ...current.slice(-4),
        { id, tone, message, detail: options?.detail },
      ]);

      const timeout = AUTO_DISMISS_MS[tone];
      if (timeout !== null) {
        window.setTimeout(() => dismiss(id), timeout);
      }
    },
    [dismiss],
  );

  const value = React.useMemo<ToastContextValue>(
    () => ({
      toast,
      success: (message) => toast(message, { tone: "success" }),
      error: (message, detail) => toast(message, { tone: "error", detail }),
    }),
    [toast],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2"
      >
        {toasts.map((item) => (
          <div
            key={item.id}
            style={
              item.tone === "success"
                ? { background: "var(--success-soft)", color: "var(--success)", borderColor: "transparent" }
                : item.tone === "error"
                  ? { background: "var(--danger-soft)", color: "var(--danger)", borderColor: "transparent" }
                  : { background: "var(--surface-raised)", color: "var(--ink)", borderColor: "var(--line-strong)" }
            }
            className={cn("pointer-events-auto rounded-md border px-3 py-2 shadow-lg")}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[12.5px] font-medium">{item.message}</p>
                {item.detail ? (
                  <p className="mt-0.5 text-[11.5px] opacity-80">{item.detail}</p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => dismiss(item.id)}
                aria-label="Dismiss"
                className="-mr-1 -mt-0.5 rounded px-1 text-[14px] leading-none opacity-60 hover:opacity-100"
              >
                ×
              </button>
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
