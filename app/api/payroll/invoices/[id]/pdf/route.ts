import { NextRequest } from "next/server";
import { requireManager } from "@/lib/auth/guards";
import { buildInvoicePdf } from "@/lib/services/invoice-pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The invoice as a PDF.
 *
 * Deliberately not wrapped in the JSON `handle` helper: the body is a document,
 * and a failure here should not be handed back as a JSON envelope the browser
 * would try to download as an invoice.
 */
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    await requireManager();
  } catch {
    return new Response("Not permitted", { status: 403 });
  }

  const { id } = await context.params;

  let pdf: { bytes: Buffer; filename: string };
  try {
    pdf = await buildInvoicePdf(id);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not build that invoice.";
    return new Response(message, { status: 404 });
  }

  return new Response(new Uint8Array(pdf.bytes), {
    headers: {
      "Content-Type": "application/pdf",
      // `inline` so it opens in the browser's viewer; the filename is still
      // used if somebody saves it.
      "Content-Disposition": `inline; filename="${pdf.filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
