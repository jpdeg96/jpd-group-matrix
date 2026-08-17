"use client";

/**
 * The rates behind the Phantom Calculator desktop application.
 *
 * Two numbers, and they are the only thing that application asks Matrix for.
 * It divides a StubHub get-in price by `(1 + tier1) * (1 + stubhub)` to get the
 * most it can pay for the ticket, so a wrong value here becomes a wrong
 * purchase price on somebody's screen within a minute.
 *
 * Which is why this card does two things the other settings cards do not: it
 * shows the entered decimals back as percentages, and it works a live example
 * through the formula. Both exist to catch the same mistake — typing 20 for
 * 20% — before it is saved rather than after a ticket is bought. The schema and
 * a database CHECK both refuse it as well; this is the layer that explains it.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, Field, Input, PageHeader } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { api, ApiRequestError } from "@/lib/ui/api-client";
import type { AppSettings } from "@/lib/services/settings";

/** The get-in price the worked example uses. Arbitrary, round, recognisable. */
const EXAMPLE_GET_IN = 600;

export function PhantomCalculatorSettings({ settings }: { settings: AppSettings }) {
  const router = useRouter();
  const toast = useToast();

  // Held as strings so a half-typed "0." is not rewritten under the cursor.
  const [tier1, setTier1] = React.useState(formatRate(settings.phantomTier1Rate));
  const [stubHub, setStubHub] = React.useState(formatRate(settings.phantomStubHubRate));
  const [pending, setPending] = React.useState(false);

  const tier1Value = parseRate(tier1);
  const stubHubValue = parseRate(stubHub);

  const tier1Error = rateError(tier1, tier1Value);
  const stubHubError = rateError(stubHub, stubHubValue);
  const canSave = !tier1Error && !stubHubError;

  const configured = settings.phantomTier1Rate !== null && settings.phantomStubHubRate !== null;

  async function save() {
    setPending(true);
    try {
      await api.patch("/api/settings", {
        phantomTier1Rate: tier1Value,
        phantomStubHubRate: stubHubValue,
      });
      toast.success("Phantom Calculator rates saved.");
      router.refresh();
    } catch (error) {
      toast.error(
        "Could not save the Phantom Calculator rates.",
        error instanceof ApiRequestError ? error.message : undefined,
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <PageHeader
        title="Phantom Calculator"
        subtitle="The rates the desktop calculator uses to work out the most it can pay for a ticket."
        actions={
          <Button
            variant="primary"
            size="sm"
            loading={pending}
            disabled={!canSave}
            onClick={save}
          >
            Save
          </Button>
        }
      />

      <div className="space-y-4 p-5">
        <div
          className="rounded-md border px-3 py-2 text-[11.5px]"
          style={{
            borderColor: configured ? "var(--success)" : "var(--warn)",
            background: configured ? "var(--success-soft)" : "var(--warn-soft)",
            color: configured ? "var(--success)" : "var(--warn)",
          }}
        >
          <Badge tone={configured ? "success" : "warn"}>
            {configured ? "Rates set" : "Rates not set"}
          </Badge>{" "}
          {configured ? (
            <>
              The desktop calculator picks these up on its next refresh, and
              immediately when someone presses its refresh control.
              <span className="mt-1 block opacity-80">
                Each copy also keeps the last rates it successfully fetched, so
                it keeps working while Matrix is unreachable.
              </span>
            </>
          ) : (
            <>
              The desktop calculator will not produce a purchase price until both
              rates are set here.
              <span className="mt-1 block opacity-80">
                It shows an error instead of guessing. A made-up rate would be
                indistinguishable from a real one on screen, and this number is
                what somebody pays.
              </span>
            </>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Tier 1 Rate"
            htmlFor="phantomTier1Rate"
            hint={hintFor(tier1Value)}
            errors={tier1Error ? [tier1Error] : undefined}
          >
            <Input
              id="phantomTier1Rate"
              value={tier1}
              onChange={(event) => setTier1(event.target.value)}
              inputMode="decimal"
              placeholder="0.20"
              spellCheck={false}
            />
          </Field>

          <Field
            label="StubHub Rate"
            htmlFor="phantomStubHubRate"
            hint={hintFor(stubHubValue)}
            errors={stubHubError ? [stubHubError] : undefined}
          >
            <Input
              id="phantomStubHubRate"
              value={stubHub}
              onChange={(event) => setStubHub(event.target.value)}
              inputMode="decimal"
              placeholder="0.25"
              spellCheck={false}
            />
          </Field>
        </div>

        <div
          className="rounded-md border px-3 py-2 text-[11.5px]"
          style={{ borderColor: "var(--line)", color: "var(--ink-muted)" }}
        >
          <strong style={{ color: "var(--ink)" }}>Enter both as decimals.</strong>{" "}
          <code>0.20</code> is 20%, <code>0.25</code> is 25%. The calculator
          divides the get-in price by{" "}
          <code>(1 + Tier 1) × (1 + StubHub)</code>.
          {tier1Value !== null && stubHubValue !== null ? (
            <span className="mt-1.5 block" style={{ color: "var(--ink)" }}>
              A <strong>${EXAMPLE_GET_IN}</strong> get-in would allow paying up to{" "}
              <strong>{formatMoney(EXAMPLE_GET_IN / ((1 + tier1Value) * (1 + stubHubValue)))}</strong>.
            </span>
          ) : null}
        </div>

        <p className="text-[11.5px]" style={{ color: "var(--ink-subtle)" }}>
          The calculator reads these from{" "}
          <code>/api/phantom-calculator/rates</code> and can only read them. Rates
          are changed here, by an administrator, and nowhere else.
        </p>
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */

/** A stored rate as the text to edit. Null — not set — is an empty field. */
function formatRate(value: number | null): string {
  return value === null ? "" : String(value);
}

/**
 * The typed text as a number, or `null` for "cleared", or `NaN` for "not a
 * number at all".
 *
 * The three are distinct on purpose: an empty field is a legitimate instruction
 * to clear the rate, and must not be confused with a typo.
 */
function parseRate(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;
  return Number(trimmed);
}

function rateError(text: string, value: number | null): string | null {
  if (value === null) return null;
  if (!Number.isFinite(value)) return "Enter a number, for example 0.20.";
  if (value < 0) return "A rate cannot be negative.";
  if (value >= 1) {
    return `Enter the rate as a decimal — ${trimZeroes(value / 100)} for ${trimZeroes(value)}%, not ${text.trim()}.`;
  }
  return null;
}

/** Echoes the decimal back as a percentage, which is how people think of it. */
function hintFor(value: number | null): string {
  if (value === null || !Number.isFinite(value) || value < 0 || value >= 1) {
    return "A decimal fraction — 0.20 means 20%.";
  }
  return `${trimZeroes(value * 100)}%`;
}

function trimZeroes(value: number): string {
  return String(Math.round(value * 10_000) / 10_000);
}

function formatMoney(value: number): string {
  return `$${value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
