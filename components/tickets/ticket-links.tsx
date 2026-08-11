"use client";

import { marketplaceLinks, type TicketLinkInput } from "@/lib/tickets/links";
import { Muted } from "@/components/ui/primitives";
import { readableTextColor } from "@/lib/domain/constants";

/**
 * Marketplace buttons, in each brand's own color.
 *
 * The colors are the point: at a glance in a dense row you can tell which link
 * is which without reading. Foreground text is chosen by luminance so both stay
 * legible, and the label is always present so color is never the only cue.
 */
export function TicketLinks({
  event,
  options,
}: {
  event: TicketLinkInput;
  options: { seatGeek: boolean; stubHub: boolean };
}) {
  const links = marketplaceLinks(event, options);

  if (links.length === 0) return <Muted>—</Muted>;

  return (
    <div className="flex flex-wrap gap-1">
      {links.map((link) => (
        <a
          key={link.marketplace}
          href={link.url}
          target="_blank"
          rel="noopener noreferrer"
          title={`Search ${link.label} for "${link.query}"`}
          className="rounded px-1.5 py-0.5 text-[10.5px] font-semibold transition hover:brightness-110"
          style={{ background: link.color, color: readableTextColor(link.color) }}
        >
          {link.label} ↗
        </a>
      ))}
    </div>
  );
}
