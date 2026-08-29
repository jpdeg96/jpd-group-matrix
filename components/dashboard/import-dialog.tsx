"use client";

import * as React from "react";
import { Badge, Button, Dialog, Textarea } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { api, ApiRequestError } from "@/lib/ui/api-client";
import { cn } from "@/lib/ui/cn";
import type { ParseResult } from "@/lib/domain/import-parse";

/**
 * Bulk import.
 *
 * Two phases, deliberately: paste, review the parsed table with per-row errors,
 * *then* commit. A blind import of two hundred rows containing one bad date is
 * how you end up hand-deleting records afterwards.
 *
 * Copying a range from Excel or Google Sheets puts tab-separated text on the
 * clipboard, so pasting is a first-class Excel import with no file and no
 * upload step.
 */
export function ImportDialog({
  open,
  onClose,
  onImported,
  sheetUrl,
}: {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
  /** The linked Google Sheet, or null when none is configured. */
  sheetUrl: string | null;
}) {
  const toast = useToast();
  const [text, setText] = React.useState("");
  const [preview, setPreview] = React.useState<ParseResult | null>(null);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  /*
   * Which source the preview came from.
   *
   * The commit has to use the same one: committing a sheet preview as pasted
   * text would send the browser copy back and quietly import a snapshot rather
   * than the sheet.
   */
  const [source, setSource] = React.useState<"TEXT" | "SHEET">("TEXT");
  const [sheetTab, setSheetTab] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) {
      setText("");
      setPreview(null);
      setError(null);
      setSource("TEXT");
      setSheetTab(null);
    }
  }, [open]);

  async function runPreview(value: string) {
    if (!value.trim()) {
      setPreview(null);
      return;
    }

    setPending(true);
    setError(null);
    try {
      const result = await api.post<{ preview: ParseResult }>("/api/import", {
        source: "TEXT",
        text: value,
        commit: false,
      });
      setSource("TEXT");
      setSheetTab(null);
      setPreview(result.preview);
    } catch (caught) {
      setPreview(null);
      setError(
        caught instanceof ApiRequestError
          ? caught.message
          : "Could not parse that. Check the format and try again.",
      );
    } finally {
      setPending(false);
    }
  }

  /**
   * Pulls the linked sheet.
   *
   * The rows are never sent from here — the server reads the spreadsheet on
   * both the preview and the commit. So what lands in the preview is what the
   * sheet says, and what gets written is what it says at the moment of writing,
   * rather than a copy this browser has been holding.
   */
  async function loadFromSheet() {
    setPending(true);
    setError(null);
    try {
      const result = await api.post<{
        preview: ParseResult;
        sheet: { tab: string; url: string | null } | null;
      }>("/api/import", { source: "SHEET", commit: false });

      setSource("SHEET");
      setSheetTab(result.sheet?.tab ?? null);
      setPreview(result.preview);
      // The pasted box is cleared so there is no second, stale set of rows on
      // screen implying it is the one about to be imported.
      setText("");
    } catch (caught) {
      setPreview(null);
      setSource("TEXT");
      setError(
        caught instanceof ApiRequestError
          ? caught.message
          : "Could not read the linked spreadsheet.",
      );
    } finally {
      setPending(false);
    }
  }

  async function readFile(file: File) {
    const content = await file.text();
    setText(content);
    await runPreview(content);
  }

  async function commit() {
    setPending(true);
    try {
      const result = await api.post<{
        result: { created: number; skipped: number; typesCreated: string[] };
      }>(
        "/api/import",
        source === "SHEET"
          ? { source: "SHEET", commit: true }
          : { source: "TEXT", text, commit: true },
      );

      const { created, skipped, typesCreated } = result.result;
      toast.success(
        `Imported ${created} event(s)` +
          (skipped > 0 ? `, skipped ${skipped} with errors` : "") +
          (typesCreated.length > 0
            ? `. New types: ${typesCreated.join(", ")}`
            : "."),
      );
      onImported();
    } catch (caught) {
      toast.error(
        "Import failed.",
        caught instanceof ApiRequestError ? caught.message : undefined,
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Bulk import events"
      description="Paste straight from Excel or Google Sheets, or load a CSV file. Nothing is written until you review the preview."
      width="xl"
      footer={
        <>
          <Button type="button" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            loading={pending}
            disabled={!preview || preview.validCount === 0}
            onClick={commit}
          >
            {preview
              ? `Import ${preview.validCount} event${preview.validCount === 1 ? "" : "s"}`
              : "Import"}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div
          className="rounded-md border px-3 py-2 text-[11.5px]"
          style={{ borderColor: "var(--line)", background: "var(--canvas)" }}
        >
          <p className="font-medium">Expected columns</p>
          <p className="mt-0.5" style={{ color: "var(--ink-muted)" }}>
            <code>Date</code>, <code>Type</code>, <code>Away Team / Artist</code>,{" "}
            <code>Home Team</code>, <code>Venue</code>, <code>Assigned</code>.
            A header row is detected automatically; without one, columns are read
            in that order. Dates may be <code>YYYY-MM-DD</code> or{" "}
            <code>M/D/YYYY</code> — slash dates are read <strong>month first</strong>,
            and the preview shows exactly how each one was understood.
          </p>
        </div>

        {sheetUrl ? (
          <div
            className="flex flex-wrap items-center gap-2 rounded-md border px-2.5 py-2"
            style={{ borderColor: "var(--line)", background: "var(--canvas)" }}
          >
            <Button
              variant="primary"
              size="sm"
              loading={pending && source === "SHEET"}
              onClick={loadFromSheet}
            >
              Load from the linked sheet
            </Button>
            {/* Straight to the source, so checking a suspicious row against the
                spreadsheet does not mean hunting for the file first. */}
            <a
              href={sheetUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11.5px] underline-offset-2 hover:underline"
              style={{ color: "var(--accent)" }}
            >
              Open the sheet ↗
            </a>
            {source === "SHEET" && sheetTab ? (
              <span className="text-[11px]" style={{ color: "var(--ink-subtle)" }}>
                Showing the “{sheetTab}” tab. It is re-read when you import, so a
                change made in the meantime is picked up.
              </span>
            ) : null}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <label
            className="cursor-pointer rounded-md border px-2.5 py-1.5 text-[12px] font-medium transition hover:brightness-95"
            style={{ borderColor: "var(--line-strong)", background: "var(--surface)" }}
          >
            Load CSV file…
            <input
              type="file"
              accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void readFile(file);
              }}
            />
          </label>
          <span className="text-[11px]" style={{ color: "var(--ink-subtle)" }}>
            or paste below. For .xlsx, copy the cells directly — the clipboard is
            already tab-separated.
          </span>
        </div>

        <Textarea
          rows={6}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onBlur={() => runPreview(text)}
          onPaste={(event) => {
            const pasted = event.clipboardData.getData("text");
            if (pasted) {
              event.preventDefault();
              setText(pasted);
              void runPreview(pasted);
            }
          }}
          placeholder={"Date\tType\tAway Team / Artist\tHome Team\tVenue\n2026-09-12\tNFL\tChiefs\tBills\tHighmark Stadium"}
          className="font-mono text-[11.5px]"
        />

        {error ? (
          <p
            role="alert"
            className="rounded-md border px-2.5 py-2 text-[12px]"
            style={{
              background: "var(--danger-soft)",
              color: "var(--danger)",
              borderColor: "transparent",
            }}
          >
            {error}
          </p>
        ) : null}

        {preview ? (
          <>
            <div className="flex flex-wrap items-center gap-3 text-[12px]">
              <Badge tone="success">{preview.validCount} ready</Badge>
              {preview.errorCount > 0 ? (
                <Badge tone="danger">{preview.errorCount} with errors</Badge>
              ) : null}
              {preview.headerDetected ? <Badge>Header row detected</Badge> : null}
              <span style={{ color: "var(--ink-subtle)" }}>
                Rows with errors are skipped; everything else still imports.
              </span>
            </div>

            <div
              className="max-h-[40vh] overflow-auto rounded-md border scrollbar-thin"
              style={{ borderColor: "var(--line)" }}
            >
              <table className="w-full min-w-[900px] border-collapse text-[11.5px]">
                <thead
                  className="sticky top-0"
                  style={{ background: "var(--canvas)" }}
                >
                  <tr>
                    <th className="px-2 py-1.5 text-left font-semibold">#</th>
                    <th className="px-2 py-1.5 text-left font-semibold">Date</th>
                    <th className="px-2 py-1.5 text-left font-semibold">Type</th>
                    <th className="px-2 py-1.5 text-left font-semibold">Away / Artist</th>
                    <th className="px-2 py-1.5 text-left font-semibold">Home</th>
                    <th className="px-2 py-1.5 text-left font-semibold">Venue</th>
                    <th className="px-2 py-1.5 text-left font-semibold">Assigned</th>
                    <th className="px-2 py-1.5 text-left font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((row) => {
                    const failed = row.errors.length > 0;
                    return (
                      <tr
                        key={row.lineNumber}
                        className={cn("border-t")}
                        style={{
                          borderColor: "var(--line)",
                          background: failed ? "var(--danger-soft)" : undefined,
                        }}
                      >
                        <td className="px-2 py-1 tabular-nums">{row.lineNumber}</td>
                        <td className="px-2 py-1">{row.eventDate ?? "—"}</td>
                        <td className="px-2 py-1">{row.type || "—"}</td>
                        <td className="px-2 py-1">{row.awayTeam ?? "—"}</td>
                        <td className="px-2 py-1">{row.homeTeam ?? "—"}</td>
                        <td className="px-2 py-1">{row.venue ?? "—"}</td>
                        <td className="px-2 py-1">{row.assignee ?? "—"}</td>
                        <td className="px-2 py-1">
                          {failed ? (
                            <span style={{ color: "var(--danger)" }}>
                              {row.errors.join(" ")}
                            </span>
                          ) : row.warnings.length > 0 ? (
                            <span style={{ color: "var(--warn)" }}>
                              {row.warnings.join(" ")}
                            </span>
                          ) : (
                            <span style={{ color: "var(--success)" }}>Ready</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </div>
    </Dialog>
  );
}
