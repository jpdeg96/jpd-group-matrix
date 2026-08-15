"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Button,
  Card,
  Dialog,
  EmptyState,
  Field,
  PageHeader,
  StatPill,
} from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { api, ApiRequestError } from "@/lib/ui/api-client";
import { downloadCsv, toCsv } from "@/lib/ui/csv";
import { formatPlainDate, type PlainDate } from "@/lib/date/plain-date";
import {
  INVOICE_STATUS_LABELS,
  PAY_TYPE_LABELS,
  formatHours,
  formatMoney,
  type InvoiceStatus,
  type PayType,
} from "@/lib/domain/payroll-format";

interface Invoice {
  id: string;
  invoiceNumber: string;
  contractorName: string;
  periodStart: PlainDate;
  periodEnd: PlainDate;
  payType: PayType;
  approvedSeconds: number;
  amount: string;
  status: InvoiceStatus;
  depositDate: PlainDate;
  paymentDate: PlainDate | null;
  usdtTxHash: string | null;
  voidReason: string | null;
  generatedAt: string;
}

const STATUS_TONE: Record<InvoiceStatus, string> = {
  GENERATED: "var(--ink-muted)",
  SENT: "var(--accent)",
  PAID: "var(--success)",
  VOID: "var(--ink-subtle)",
};

export function InvoicesView({
  isAdmin,
  invoices,
}: {
  isAdmin: boolean;
  invoices: Invoice[];
}) {
  const router = useRouter();
  const toast = useToast();

  const [paying, setPaying] = React.useState<Invoice | null>(null);
  const [voiding, setVoiding] = React.useState<Invoice | null>(null);
  const [busy, setBusy] = React.useState(false);

  const live = invoices.filter((invoice) => invoice.status !== "VOID");
  const totals = live.reduce(
    (acc, invoice) => {
      const amount = Number(invoice.amount);
      acc.total += amount;
      if (invoice.status === "PAID") acc.paid += amount;
      else acc.outstanding += amount;
      return acc;
    },
    { total: 0, paid: 0, outstanding: 0 },
  );

  async function act(invoice: Invoice, body: Record<string, unknown>, success: string) {
    setBusy(true);
    try {
      await api.patch(`/api/payroll/invoices/${invoice.id}`, body);
      toast.success(success);
      setPaying(null);
      setVoiding(null);
      router.refresh();
    } catch (error) {
      toast.error(
        "That did not work.",
        error instanceof ApiRequestError ? error.message : undefined,
      );
    } finally {
      setBusy(false);
    }
  }

  function exportCsv() {
    const csv = toCsv(
      [
        "Invoice", "Contractor", "Period start", "Period end", "Pay type",
        "Hours", "Amount", "Status", "Deposit date", "Payment date", "USDT tx hash",
      ],
      invoices.map((invoice) => [
        invoice.invoiceNumber,
        invoice.contractorName,
        invoice.periodStart,
        invoice.periodEnd,
        PAY_TYPE_LABELS[invoice.payType],
        formatHours(invoice.approvedSeconds),
        invoice.amount,
        INVOICE_STATUS_LABELS[invoice.status],
        invoice.depositDate,
        invoice.paymentDate ?? "",
        invoice.usdtTxHash ?? "",
      ]),
    );
    downloadCsv(`invoices-${new Date().toISOString().slice(0, 10)}.csv`, csv);
  }

  return (
    <Card>
      <PageHeader
        title="Invoices"
        subtitle={
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <StatPill label="invoices" value={live.length} />
            <StatPill label="total" value={`$${formatMoney(totals.total.toFixed(2))}`} />
            <StatPill label="paid" value={`$${formatMoney(totals.paid.toFixed(2))}`} tone="success" />
            <StatPill
              label="outstanding"
              value={`$${formatMoney(totals.outstanding.toFixed(2))}`}
              tone={totals.outstanding > 0 ? "warn" : undefined}
            />
          </div>
        }
        actions={
          invoices.length > 0 ? (
            <Button size="sm" onClick={exportCsv}>
              Export CSV
            </Button>
          ) : null
        }
      />

      {invoices.length === 0 ? (
        <EmptyState
          title="No invoices yet"
          description="Approve a week on the Weekly approval screen, then generate invoices from the Payroll dashboard."
        />
      ) : (
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full min-w-[1250px] border-collapse text-left">
            <thead style={{ background: "var(--canvas)" }}>
              <tr>
                {["Invoice", "Contractor", "Period", "Hours", "Amount", "Status", "Deposit", "Paid", "USDT tx", "PDF", ""].map(
                  (label, index) => (
                    <th
                      key={label || index}
                      className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide"
                      style={{ color: "var(--ink-subtle)" }}
                    >
                      {label}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {invoices.map((invoice) => {
                const voided = invoice.status === "VOID";

                return (
                  <tr
                    key={invoice.id}
                    className="border-t"
                    style={{
                      borderColor: "var(--line)",
                      // Voided rows stay visible — they are part of the trail —
                      // but must never be mistaken for money owed.
                      opacity: voided ? 0.55 : 1,
                    }}
                  >
                    <td className="px-3 py-2 text-[12.5px] font-medium tabular-nums">
                      {invoice.invoiceNumber}
                    </td>
                    <td className="px-3 py-2 text-[12.5px]">{invoice.contractorName}</td>
                    <td className="px-3 py-2 text-[11.5px]" style={{ color: "var(--ink-muted)" }}>
                      {formatPlainDate(invoice.periodStart)} – {formatPlainDate(invoice.periodEnd)}
                    </td>
                    <td className="px-3 py-2 text-right text-[12.5px] tabular-nums">
                      {formatHours(invoice.approvedSeconds)}
                    </td>
                    <td
                      className="px-3 py-2 text-right text-[13px] font-semibold tabular-nums"
                      style={{ textDecoration: voided ? "line-through" : undefined }}
                    >
                      ${formatMoney(invoice.amount)}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className="text-[11.5px] font-semibold"
                        style={{ color: STATUS_TONE[invoice.status] }}
                      >
                        {INVOICE_STATUS_LABELS[invoice.status]}
                      </span>
                      {invoice.voidReason ? (
                        <p className="mt-0.5 text-[11px]" style={{ color: "var(--ink-subtle)" }}>
                          {invoice.voidReason}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-[11.5px]" style={{ color: "var(--ink-muted)" }}>
                      {formatPlainDate(invoice.depositDate)}
                    </td>
                    <td className="px-3 py-2 text-[11.5px]" style={{ color: "var(--ink-muted)" }}>
                      {invoice.paymentDate ? formatPlainDate(invoice.paymentDate) : "—"}
                    </td>
                    <td className="px-3 py-2 text-[11px]">
                      {invoice.usdtTxHash ? (
                        <span
                          className="block max-w-[12rem] truncate font-mono"
                          title={invoice.usdtTxHash}
                        >
                          {invoice.usdtTxHash}
                        </span>
                      ) : (
                        <span style={{ color: "var(--ink-subtle)" }}>—</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <a
                        href={`/api/payroll/invoices/${invoice.id}/pdf`}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded border px-2 py-0.5 text-[11px] font-medium"
                        style={{ borderColor: "var(--line-strong)", color: "var(--accent)" }}
                        title="Open the invoice PDF"
                      >
                        PDF
                      </a>
                    </td>
                    <td className="px-3 py-2">
                      {isAdmin && !voided ? (
                        <div className="flex flex-wrap gap-1">
                          {invoice.status === "GENERATED" ? (
                            <SmallButton
                              label="Mark sent"
                              onClick={() =>
                                act(invoice, { action: "MARK_SENT" }, `${invoice.invoiceNumber} marked sent.`)
                              }
                            />
                          ) : null}
                          {invoice.status !== "PAID" ? (
                            <SmallButton label="Record payment" onClick={() => setPaying(invoice)} />
                          ) : null}
                          <SmallButton label="Void" tone="var(--danger)" onClick={() => setVoiding(invoice)} />
                        </div>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {paying ? (
        <PaymentDialog
          invoice={paying}
          busy={busy}
          onClose={() => setPaying(null)}
          onSubmit={(paymentDate, usdtTxHash) =>
            act(
              paying,
              { action: "MARK_PAID", paymentDate, usdtTxHash },
              `${paying.invoiceNumber} recorded as paid.`,
            )
          }
        />
      ) : null}

      {voiding ? (
        <VoidDialog
          invoice={voiding}
          busy={busy}
          onClose={() => setVoiding(null)}
          onSubmit={(reason) =>
            act(voiding, { action: "VOID", reason }, `${voiding.invoiceNumber} voided.`)
          }
        />
      ) : null}
    </Card>
  );
}

function SmallButton({
  label,
  tone,
  onClick,
}: {
  label: string;
  tone?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded border px-2 py-0.5 text-[11px] font-medium transition"
      style={{ borderColor: "var(--line-strong)", color: tone ?? "var(--ink-muted)" }}
    >
      {label}
    </button>
  );
}

/**
 * Recording a payment.
 *
 * The transaction hash is required rather than optional: "Paid" with nothing
 * behind it is precisely the audit hole this module exists to close, and the
 * server refuses it too.
 */
function PaymentDialog({
  invoice,
  busy,
  onClose,
  onSubmit,
}: {
  invoice: Invoice;
  busy: boolean;
  onClose: () => void;
  onSubmit: (paymentDate: string, usdtTxHash: string) => void;
}) {
  const [paymentDate, setPaymentDate] = React.useState<string>(invoice.depositDate);
  const [hash, setHash] = React.useState("");

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Record payment — ${invoice.invoiceNumber}`}
      description={`${invoice.contractorName}, $${formatMoney(invoice.amount)}`}
      width="sm"
      footer={
        <>
          <Button size="sm" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant="primary"
            loading={busy}
            disabled={hash.trim() === ""}
            onClick={() => onSubmit(paymentDate, hash.trim())}
          >
            Record payment
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Payment date">
          <input
            type="date"
            value={paymentDate}
            onChange={(event) => setPaymentDate(event.target.value)}
            className="w-full rounded-md border px-2 py-1.5 text-[12.5px]"
            style={{ borderColor: "var(--line-strong)", background: "var(--surface)" }}
          />
        </Field>
        <Field
          label="USDT transaction hash"
          hint="Required. This is the evidence the payment happened."
        >
          <input
            value={hash}
            onChange={(event) => setHash(event.target.value)}
            placeholder="0x…"
            className="w-full rounded-md border px-2 py-1.5 font-mono text-[12px]"
            style={{ borderColor: "var(--line-strong)", background: "var(--surface)" }}
          />
        </Field>
      </div>
    </Dialog>
  );
}

function VoidDialog({
  invoice,
  busy,
  onClose,
  onSubmit,
}: {
  invoice: Invoice;
  busy: boolean;
  onClose: () => void;
  onSubmit: (reason: string) => void;
}) {
  const [reason, setReason] = React.useState("");

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Void ${invoice.invoiceNumber}`}
      description="Nothing is deleted. The week is released so a corrected invoice can be issued, which will take a new number."
      width="sm"
      footer={
        <>
          <Button size="sm" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant="danger"
            loading={busy}
            disabled={reason.trim() === ""}
            onClick={() => onSubmit(reason.trim())}
          >
            Void invoice
          </Button>
        </>
      }
    >
      <Field label="Reason" hint="Kept on the record. Required.">
        <input
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Wrong rate applied"
          className="w-full rounded-md border px-2 py-1.5 text-[12.5px]"
          style={{ borderColor: "var(--line-strong)", background: "var(--surface)" }}
        />
      </Field>
    </Dialog>
  );
}
