"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, Field, Input, PageHeader } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { api, ApiRequestError } from "@/lib/ui/api-client";
import type { AppSettings } from "@/lib/services/settings";

/**
 * Business identity for payroll.
 *
 * These are the strings that appear on documents leaving the business — every
 * invoice PDF and every remittance email — so they are configuration rather
 * than values buried in a template.
 *
 * The Resend credential is deliberately absent from this form. Like the
 * Clockify key it lives in the environment, so a database dump cannot carry a
 * live credential; all this screen does is report whether it is there.
 */
export function PayrollSettings({
  settings,
  emailConfigured,
  emailFrom,
}: {
  settings: AppSettings;
  emailConfigured: boolean;
  /** Shown so a wrong sender address is visible without reading the server. */
  emailFrom: string | null;
}) {
  const router = useRouter();
  const toast = useToast();

  const [businessName, setBusinessName] = React.useState(settings.businessName);
  const [businessAddress, setBusinessAddress] = React.useState(settings.businessAddress ?? "");
  const [invoiceNote, setInvoiceNote] = React.useState(settings.invoiceNote ?? "");
  const [adminEmail, setAdminEmail] = React.useState(settings.adminRemittanceEmail ?? "");
  const [fromName, setFromName] = React.useState(settings.remittanceFromName);
  const [paymentMethod, setPaymentMethod] = React.useState(settings.remittancePaymentMethod);
  const [footerNote, setFooterNote] = React.useState(settings.remittanceFooterNote ?? "");
  const [pending, setPending] = React.useState(false);

  async function save() {
    setPending(true);
    try {
      await api.patch("/api/settings", {
        businessName: businessName.trim(),
        businessAddress: businessAddress.trim() || null,
        invoiceNote: invoiceNote.trim() || null,
        adminRemittanceEmail: adminEmail.trim() || null,
        remittanceFromName: fromName.trim(),
        remittancePaymentMethod: paymentMethod.trim(),
        remittanceFooterNote: footerNote.trim() || null,
      });
      toast.success("Payroll settings saved.");
      router.refresh();
    } catch (error) {
      toast.error(
        "Could not save payroll settings.",
        error instanceof ApiRequestError ? error.message : undefined,
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <PageHeader
        title="Payroll"
        subtitle="What appears on invoice PDFs and remittance emails."
        actions={
          <Button variant="primary" size="sm" loading={pending} onClick={save}>
            Save
          </Button>
        }
      />

      <div className="space-y-4 p-5">
        <div
          className="rounded-md border px-3 py-2 text-[11.5px]"
          style={{
            borderColor: emailConfigured ? "var(--success)" : "var(--warn)",
            background: emailConfigured ? "var(--success-soft)" : "var(--warn-soft)",
            color: emailConfigured ? "var(--success)" : "var(--warn)",
          }}
        >
          <Badge tone={emailConfigured ? "success" : "warn"}>
            {emailConfigured ? "Email configured" : "Email not configured"}
          </Badge>{" "}
          {emailConfigured ? (
            <>
              Sending as <strong>{emailFrom}</strong>.
              <span className="mt-1 block opacity-80">
                That address must be on a domain verified in Resend, or sends are
                refused. Rotating the key needs a <strong>server restart</strong> —
                the environment is read once at startup.
              </span>
            </>
          ) : (
            <>
              Remittance emails cannot be sent until both values are set on the
              server. Invoice PDFs work regardless — they need no configuration.
              <code
                className="mt-1.5 block rounded px-2 py-1 font-mono text-[11px]"
                style={{ background: "var(--surface)", color: "var(--ink)" }}
              >
                RESEND_API_KEY=&quot;…&quot;
                <br />
                RESEND_FROM_EMAIL=&quot;payroll@yourdomain.com&quot;
              </code>
              <span className="mt-1.5 block">
                They live in the environment rather than in this form so a database
                dump never contains a live credential.
              </span>
            </>
          )}
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Field
            label="Business name"
            htmlFor="businessName"
            hint="Billed-to name on every invoice."
          >
            <Input
              id="businessName"
              value={businessName}
              onChange={(event) => setBusinessName(event.target.value)}
            />
          </Field>

          <Field
            label="Payment method"
            htmlFor="paymentMethod"
            hint="Stated on the invoice and in the email."
          >
            <Input
              id="paymentMethod"
              value={paymentMethod}
              onChange={(event) => setPaymentMethod(event.target.value)}
              placeholder="USDT"
            />
          </Field>
        </div>

        <Field
          label="Business address"
          htmlFor="businessAddress"
          hint="Optional. Printed under the billed-to name."
        >
          <Input
            id="businessAddress"
            value={businessAddress}
            onChange={(event) => setBusinessAddress(event.target.value)}
          />
        </Field>

        <Field
          label="Invoice note"
          htmlFor="invoiceNote"
          hint="Optional footer on the invoice PDF — payment terms, tax notes."
        >
          <Input
            id="invoiceNote"
            value={invoiceNote}
            onChange={(event) => setInvoiceNote(event.target.value)}
            placeholder="Paid in USDT on the Friday following the pay period."
          />
        </Field>

        <div className="grid gap-4 md:grid-cols-2">
          <Field
            label="Remittance sender name"
            htmlFor="fromName"
            hint="Display name on remittance emails."
          >
            <Input
              id="fromName"
              value={fromName}
              onChange={(event) => setFromName(event.target.value)}
            />
          </Field>

          <Field
            label="Admin summary email"
            htmlFor="adminEmail"
            hint="Where the payroll run summary goes. Leave blank for none."
          >
            <Input
              id="adminEmail"
              type="email"
              value={adminEmail}
              onChange={(event) => setAdminEmail(event.target.value)}
              placeholder="you@yourdomain.com"
            />
          </Field>
        </div>

        <Field
          label="Remittance footer note"
          htmlFor="footerNote"
          hint="Optional closing line in each contractor's email."
        >
          <Input
            id="footerNote"
            value={footerNote}
            onChange={(event) => setFooterNote(event.target.value)}
            placeholder="Questions? Reply to this email."
          />
        </Field>
      </div>
    </Card>
  );
}
