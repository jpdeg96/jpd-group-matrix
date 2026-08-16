"use client";

/**
 * UI primitives.
 *
 * Small, local, dependency-free components in the shadcn/ui spirit. Every one
 * reads the same theme tokens, so none of them knows which theme is active.
 */

import * as React from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/ui/cn";
import { readableTextColor } from "@/lib/domain/constants";

/* -------------------------------------------------------------------------- */
/* Button                                                                     */
/* -------------------------------------------------------------------------- */

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md";

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: "h-7 px-2.5 text-[12px] gap-1.5",
  md: "h-8 px-3 text-[13px] gap-2",
};

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    { className, variant = "secondary", size = "md", loading, disabled, children, style, ...props },
    ref,
  ) {
    const variantStyle: React.CSSProperties =
      variant === "primary"
        ? { background: "var(--accent)", color: "var(--accent-contrast)", borderColor: "transparent" }
        : variant === "danger"
          ? { background: "var(--danger)", color: "#fff", borderColor: "transparent" }
          : variant === "ghost"
            ? { background: "transparent", color: "var(--ink-muted)", borderColor: "transparent" }
            : { background: "var(--surface)", color: "var(--ink)", borderColor: "var(--line-strong)" };

    return (
      <button
        ref={ref}
        // Disabling while in flight is what actually prevents a double submit.
        disabled={disabled || loading}
        style={{ ...variantStyle, ...style }}
        className={cn(
          "inline-flex items-center justify-center rounded-md border font-medium transition",
          "hover:brightness-[1.06] disabled:pointer-events-none disabled:opacity-50",
          BUTTON_SIZES[size],
          className,
        )}
        {...props}
      >
        {loading ? <Spinner className="mr-1" /> : null}
        {children}
      </button>
    );
  },
);

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Working"
      className={cn(
        "inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-r-transparent align-[-1px]",
        className,
      )}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Inputs                                                                     */
/* -------------------------------------------------------------------------- */

const fieldStyle: React.CSSProperties = {
  background: "var(--surface)",
  borderColor: "var(--line-strong)",
  color: "var(--ink)",
};

const FIELD_BASE =
  "w-full rounded-md border px-2.5 py-1.5 text-[13px] disabled:opacity-60 disabled:cursor-not-allowed";

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(function Input({ className, style, ...props }, ref) {
  return (
    <input
      ref={ref}
      style={{ ...fieldStyle, ...style }}
      className={cn(FIELD_BASE, className)}
      {...props}
    />
  );
});

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, style, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      style={{ ...fieldStyle, ...style }}
      className={cn(FIELD_BASE, "resize-y", className)}
      {...props}
    />
  );
});

export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(function Select({ className, style, children, ...props }, ref) {
  return (
    <select
      ref={ref}
      style={{ ...fieldStyle, ...style }}
      className={cn(FIELD_BASE, "pr-7", className)}
      {...props}
    >
      {children}
    </select>
  );
});

/** A borderless control for use inside a dense table cell. */
export const CellSelect = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement> & { pending?: boolean }
>(function CellSelect({ className, pending, children, style, ...props }, ref) {
  return (
    <select
      ref={ref}
      style={{ color: "var(--ink)", ...style }}
      className={cn(
        "w-full max-w-[11rem] cursor-pointer truncate rounded border border-transparent bg-transparent px-1.5 py-1 text-[12.5px]",
        "hover:border-[var(--line-strong)] hover:bg-[var(--surface)]",
        "focus:border-[var(--line-strong)] focus:bg-[var(--surface)]",
        "disabled:cursor-not-allowed disabled:opacity-60",
        pending && "opacity-60",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
});

export interface FieldProps {
  label: string;
  htmlFor?: string;
  hint?: string;
  errors?: string[];
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}

export function Field({
  label,
  htmlFor,
  hint,
  errors,
  required,
  children,
  className,
}: FieldProps) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label
        htmlFor={htmlFor}
        className="block text-[12px] font-medium"
        style={{ color: "var(--ink-muted)" }}
      >
        {label}
        {required ? <span style={{ color: "var(--danger)" }} className="ml-0.5">*</span> : null}
      </label>
      {children}
      {hint && !errors?.length ? (
        <p className="text-[11.5px]" style={{ color: "var(--ink-subtle)" }}>
          {hint}
        </p>
      ) : null}
      {errors?.length ? (
        <p role="alert" className="text-[11.5px]" style={{ color: "var(--danger)" }}>
          {errors.join(" ")}
        </p>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Checkbox                                                                   */
/* -------------------------------------------------------------------------- */

export interface CheckboxProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {
  pending?: boolean;
  label?: string;
}

export function Checkbox({ className, pending, label, style, ...props }: CheckboxProps) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <input
        type="checkbox"
        aria-label={label}
        style={{ accentColor: "var(--accent)", ...style }}
        className={cn(
          "h-3.5 w-3.5 cursor-pointer rounded-[3px]",
          "disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        {...props}
      />
      {pending ? <Spinner /> : null}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Badge                                                                      */
/* -------------------------------------------------------------------------- */

type BadgeTone = "neutral" | "accent" | "danger" | "warn" | "success" | "live";

export function Badge({
  tone = "neutral",
  className,
  children,
  style,
  title,
}: {
  tone?: BadgeTone;
  className?: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
  title?: string;
}) {
  const toneStyle: React.CSSProperties =
    tone === "neutral"
      ? { background: "var(--canvas)", color: "var(--ink-muted)", borderColor: "var(--line)" }
      : {
          background: `var(--${tone}-soft)`,
          color: `var(--${tone})`,
          borderColor: "transparent",
        };

  return (
    <span
      title={title}
      style={{ ...toneStyle, ...style }}
      className={cn(
        "inline-flex items-center gap-1 rounded border px-1.5 py-px text-[11px] font-medium whitespace-nowrap",
        className,
      )}
    >
      {children}
    </span>
  );
}

/**
 * Marks a row that was imported rather than created here.
 *
 * Imported rows are genuinely thinner than native ones — the old spreadsheet
 * recorded no assignee, nobody against a completion, and no author on a note.
 * Without the badge those gaps look like the application lost something.
 */
export function LegacyBadge({ source }: { source: string | null }) {
  if (!source) return null;
  return (
    <Badge
      tone="neutral"
      className="cursor-help"
      title={
        `Imported from the ${source}. Historic rows carry no assignee, ` +
        "no person against a completion and no note author, because the source did not record them."
      }
    >
      Legacy
    </Badge>
  );
}

/* -------------------------------------------------------------------------- */
/* User chip                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * A person, rendered with their identity color.
 *
 * The dot is a fast recognition cue in a dense table, but the name is always
 * present too — color alone would be unusable for anyone with a color vision
 * deficiency, and there are only so many distinguishable hues anyway.
 */
export function UserChip({
  name,
  color,
  inactive,
  className,
}: {
  name: string;
  color: string;
  inactive?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 truncate", className)}
      style={{ opacity: inactive ? 0.6 : 1 }}
    >
      <span
        aria-hidden
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ background: color }}
      />
      <span className={cn("truncate", inactive && "italic")}>
        {name}
        {inactive ? " (inactive)" : ""}
      </span>
    </span>
  );
}

/** A solid pill in the user's color, for the impersonation banner. */
export function UserPill({ name, color }: { name: string; color: string }) {
  return (
    <span
      className="inline-flex items-center rounded px-1.5 py-px text-[11.5px] font-semibold"
      style={{ background: color, color: readableTextColor(color) }}
    >
      {name}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Dialog                                                                     */
/* -------------------------------------------------------------------------- */

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: "sm" | "md" | "lg" | "xl";
}

const DIALOG_WIDTHS = {
  sm: "max-w-md",
  md: "max-w-xl",
  lg: "max-w-3xl",
  xl: "max-w-6xl",
} as const;

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = "md",
}: DialogProps) {
  // Portalling is not cosmetic. `position: fixed` is resolved against the
  // nearest ancestor with a transform, filter or containment — and table rows
  // carry a hover `filter: brightness()`. A dialog rendered in place therefore
  // gets trapped inside its own row instead of covering the viewport. Mounting
  // at document.body escapes every such containing block, and also lifts the
  // dialog out of the table's `overflow-x: auto` scroll container.
  const [container, setContainer] = React.useState<HTMLElement | null>(null);

  React.useEffect(() => {
    setContainer(document.body);
  }, []);

  React.useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open || !container) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-[7vh]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{ background: "var(--surface-raised)", borderColor: "var(--line)" }}
        className={cn("w-full rounded-lg border shadow-2xl", DIALOG_WIDTHS[width])}
      >
        <header className="border-b px-5 py-3.5" style={{ borderColor: "var(--line)" }}>
          <h2 className="text-[14px] font-semibold">{title}</h2>
          {description ? (
            <p className="mt-0.5 text-[12px]" style={{ color: "var(--ink-muted)" }}>
              {description}
            </p>
          ) : null}
        </header>

        <div className="px-5 py-4">{children}</div>

        {footer ? (
          <footer
            className="flex justify-end gap-2 border-t px-5 py-3"
            style={{ borderColor: "var(--line)", background: "var(--canvas)" }}
          >
            {footer}
          </footer>
        ) : null}
      </div>
    </div>,
    container,
  );
}

/* -------------------------------------------------------------------------- */
/* Layout helpers                                                             */
/* -------------------------------------------------------------------------- */

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div
      className="flex flex-wrap items-start justify-between gap-3 border-b px-5 py-3.5"
      style={{ borderColor: "var(--line)" }}
    >
      <div>
        <h1 className="text-[15px] font-semibold tracking-tight">{title}</h1>
        {subtitle ? (
          <div className="mt-0.5 text-[12px]" style={{ color: "var(--ink-muted)" }}>
            {subtitle}
          </div>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/**
 * A counter in a page header.
 *
 * Given `onClick` it becomes a real button that applies the filter it counts,
 * because a number labelled "SeatGeek to do" is already a description of a
 * subset — the only question a reader has next is "show me those". `active`
 * underlines it so the header says which filter is on, not just what exists.
 */
export function StatPill({
  label,
  value,
  tone = "neutral",
  onClick,
  active = false,
  title,
}: {
  label: string;
  value: number | string;
  tone?: "neutral" | "danger" | "warn" | "success" | "accent";
  onClick?: () => void;
  active?: boolean;
  title?: string;
}) {
  const valueColor = tone === "neutral" ? "var(--ink)" : `var(--${tone})`;

  const content = (
    <>
      <span className="text-[13px] font-semibold tabular-nums" style={{ color: valueColor }}>
        {value}
      </span>
      <span
        className="text-[11.5px]"
        style={{ color: active ? "var(--ink)" : "var(--ink-muted)" }}
      >
        {label}
      </span>
    </>
  );

  if (!onClick) {
    return (
      <div className="flex items-baseline gap-1.5 whitespace-nowrap" title={title}>
        {content}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={title}
      className={cn(
        "flex items-baseline gap-1.5 whitespace-nowrap rounded-sm border-b transition",
        "hover:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2",
        active ? "opacity-100" : "opacity-90 hover:opacity-100",
      )}
      style={{
        borderColor: active ? valueColor : "transparent",
        outlineColor: "var(--accent)",
      }}
    >
      {content}
    </button>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <p className="text-[13px] font-medium">{title}</p>
      {description ? (
        <p className="mt-1 max-w-md text-[12px]" style={{ color: "var(--ink-muted)" }}>
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function Card({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      style={{ background: "var(--surface)", borderColor: "var(--line)" }}
      className={cn("overflow-hidden rounded-lg border", className)}
    >
      {children}
    </section>
  );
}

export function Th({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      scope="col"
      style={{ color: "var(--ink-subtle)" }}
      className={cn(
        "whitespace-nowrap px-2.5 py-2 text-left text-[11px] font-semibold uppercase tracking-wide",
        className,
      )}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <td className={cn("px-2.5 py-2 text-[12.5px]", className)}>{children}</td>;
}

export function Muted({ children }: { children: React.ReactNode }) {
  return <span style={{ color: "var(--ink-subtle)" }}>{children}</span>;
}
