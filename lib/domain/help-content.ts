/**
 * The user guide.
 *
 * Deliberately about **concepts and workflows**, not fields. Field labels and
 * button placement change constantly, and there are already ~130 tooltips and
 * hints covering them at the point where somebody actually has the question.
 * What those cannot explain is *why* an event vanished, or why a week refuses
 * to be re-imported — so that is what this covers.
 *
 * It lives in the repo, and is updated in the same commit as any change that
 * alters a workflow. A guide that drifts is worse than none: nobody reads a
 * README, but people trust a help page, and a confidently wrong instruction
 * does more damage than silence.
 */

export type Audience = "everyone" | "manager" | "admin";

export interface HelpItem {
  term: string;
  detail: string;
}

export interface HelpSection {
  id: string;
  title: string;
  audience: Audience;
  /** One or two sentences on what the screen is for. */
  summary: string;
  items?: HelpItem[];
  /** Behaviour that surprises people. The reason this page exists. */
  gotchas?: string[];
}

export const AUDIENCE_LABELS: Record<Audience, string> = {
  everyone: "Everyone",
  manager: "Managers and admins",
  admin: "Admins only",
};

export const HELP_SECTIONS: readonly HelpSection[] = [
  {
    id: "model",
    title: "How the system works",
    audience: "everyone",
    summary:
      "Events start on the Event Dashboard. Ticking Complete sends one into C1 staging, where it works through a series of review checkpoints before its date arrives.",
    items: [
      {
        term: "Event Dashboard",
        detail:
          "Everything not yet sent to staging. This is where events are added, assigned, and checked off.",
      },
      {
        term: "C1 staging",
        detail:
          "Where an event lives after Complete is ticked. It shows one row per event with only its current checkpoint — D-21, D-14, D-7, D-5 and D-1 by default, counted back from the event date.",
      },
      {
        term: "Business date",
        detail:
          "Shown in the header. Every deadline on screen is calculated against this date, not your computer's clock, so the whole team sees the same thing wherever they are.",
      },
    ],
    gotchas: [
      "Events whose date has passed disappear from both the Dashboard and C1 automatically. Nothing is deleted — their notes, stages and completion history are kept for reporting.",
      "Weekend deadlines move back to the preceding Friday, so nothing is ever due on a day nobody is working.",
    ],
  },
  {
    id: "roles",
    title: "Who can do what",
    audience: "everyone",
    summary:
      "Three roles. Most operational work is open to everybody; the things that change money or configuration are not.",
    items: [
      {
        term: "User",
        detail:
          "Operational work: claim unassigned events, tick checkboxes, add notes, raise flags, mark themselves in progress.",
      },
      {
        term: "Manager",
        detail:
          "Everything above, plus assigning work to other people, clearing flags, the Metrics and Audit Log screens, and approving payroll weeks.",
      },
      {
        term: "Admin",
        detail:
          "Everything above, plus Users, Settings, contractor pay rates, importing time, generating invoices and recording payments.",
      },
    ],
    gotchas: [
      "A regular user can claim work nobody has taken, and release their own — but cannot take work already assigned to someone else, or hand work to another person.",
      "Anybody can raise a flag; only a manager or admin can clear one. The person who spots a problem is often not the person allowed to fix it.",
    ],
  },
  {
    id: "dashboard",
    title: "Event Dashboard",
    audience: "everyone",
    summary:
      "The working list. Add events, assign them, tick the checks, and send them to C1 when they are ready.",
    items: [
      {
        term: "Complete",
        detail:
          "Ticking this promotes the event into C1 and creates its review checkpoints. Unticking it returns the event — but only while no checkpoint work has been done.",
      },
      {
        term: "Open / All / Completed / Stale",
        detail:
          "Filter chips. Open is the default. All shows both open and completed together, with completed rows dimmed so the two stay tellable apart.",
      },
      {
        term: "In progress",
        detail:
          "Marks you as working on an event so the rest of the team can see it live. A green banner then follows you across every screen.",
      },
      {
        term: "Bulk import",
        detail:
          "Paste straight from a spreadsheet, or load a CSV. A preview shows per-row errors and duplicates before anything is written.",
      },
    ],
    gotchas: [
      "In progress stays on until you stop it, complete the event, or it times out — changing screens no longer drops it.",
      "Changing an event's date does not move its review dates. The event is flagged instead, so a deadline only moves when someone decides it should.",
    ],
  },
  {
    id: "c1",
    title: "C1",
    audience: "everyone",
    summary:
      "The review pipeline. One row per event, showing only the checkpoint it is currently on. Ticking Done advances it to the next.",
    items: [
      {
        term: "Today / This week / Next week",
        detail:
          "Shortcut chips with live counts. This week runs from today rather than from the start of the week, so passed deadlines are not resurfaced.",
      },
      {
        term: "Review Due",
        detail: "The checkpoint's deadline. Only an administrator can change one.",
      },
    ],
    gotchas: [
      "Overdue rows are hidden. A checkpoint only moves when somebody ticks Done, so a passed date is an ordinary state rather than an alarm — the header reports how many are hidden so the work is never lost.",
      "Checkpoints whose date had already passed when the event reached C1 are marked skipped rather than pending. They were never actionable, and counting them would make reporting misleading.",
    ],
  },
  {
    id: "metrics",
    title: "Metrics",
    audience: "manager",
    summary:
      "Who did how much, over a chosen window. Every chart on the screen answers the same period filter.",
    items: [
      {
        term: "Attribution",
        detail:
          "Counts follow whoever ticked the box, not who the event was assigned to. Reassigning an event never moves work somebody else already did.",
      },
      {
        term: "Hours worked",
        detail:
          "Comes from Clockify and follows the period you pick. People excluded from the time report are named beneath the chart rather than silently dropped.",
      },
    ],
    gotchas: [
      "In-progress periods end today rather than at the end of the week or month, so a per-day average is not dragged down by days that have not happened yet.",
      "All time is capped to the last year for the hours chart — Clockify needs a bounded range, and the card says so.",
    ],
  },
  {
    id: "payroll-rhythm",
    title: "Payroll — the weekly rhythm",
    audience: "manager",
    summary:
      "A pay week runs Sunday to Saturday, and the deposit lands the Friday after it closes. The usual cycle is import on Monday, review, invoice, pay on Friday.",
    items: [
      {
        term: "Monday — Import time",
        detail:
          "An admin pulls the finished week's Clockify time. This creates one row per active contractor.",
      },
      {
        term: "Review — Weekly approval",
        detail:
          "A manager checks each contractor's hours and amount, then approves, rejects, or marks for review.",
      },
      {
        term: "Generate invoices",
        detail:
          "An admin turns every approved row into an invoice, numbered by the contractor's prefix and the week — for example NAT-20260705.",
      },
      {
        term: "Friday — record payment",
        detail:
          "Pay in USDT, then record the payment date and transaction hash against each invoice.",
      },
    ],
    gotchas: [
      "Re-importing a week is safe and normal — a corrected timer, a timer left running. Rows already approved or invoiced are left untouched, so a re-import can never restate what somebody was paid.",
      "Running timers are not imported. They have no end, so there is no duration to pay; the import reports how many it skipped.",
      "Flat-weekly contractors are paid their weekly amount whatever their hours say. Their time is still imported and shown, because it is what tells you whether the flat amount is still right.",
    ],
  },
  {
    id: "payroll-invoices",
    title: "Payroll — invoices and payment",
    audience: "manager",
    summary:
      "Every approved week becomes one invoice, with a PDF and a record of how it was paid.",
    items: [
      {
        term: "PDF",
        detail:
          "Opens the invoice as a document. It is generated from the invoice's own record each time, so it always matches what was approved.",
      },
      {
        term: "Record payment",
        detail:
          "Needs both a payment date and the USDT transaction hash. The hash is the evidence, so it is required rather than optional.",
      },
      {
        term: "Void",
        detail:
          "Cancels an invoice and frees its week to be issued again. A reason is required and kept on the record.",
      },
      {
        term: "Send remittance",
        detail:
          "Emails each contractor their invoice as an attachment, and sends the admin a summary with a total.",
      },
    ],
    gotchas: [
      "A reissued invoice gets a new number ending -R2, not the original. The voided one is still a document that existed, and two documents must not share an identifier.",
      "Remittance only sends for the most recent pay week unless it is explicitly confirmed otherwise, so an old week cannot be mailed out by mistake.",
      "An approved row cannot be changed once it has been invoiced. Void the invoice first — that keeps an invoice from describing something that is no longer true.",
    ],
  },
  {
    id: "payroll-contractors",
    title: "Payroll — contractors",
    audience: "admin",
    summary:
      "Who gets paid, how, and how much. Contractors are added from existing user accounts.",
    items: [
      {
        term: "Add from users",
        detail:
          "Name, Clockify link and email come across automatically. Only the pay type and rate need entering — nothing on a user account says what somebody earns.",
      },
      {
        term: "Invoice prefix",
        detail:
          "The leading part of every invoice number for that person. Suggested from their name, and editable before you save.",
      },
      {
        term: "Deactivate",
        detail:
          "Removes somebody from future imports while keeping all their payment history. Contractors who have been paid cannot be deleted.",
      },
    ],
    gotchas: [
      "Changing a rate applies from the next import onwards. Weeks already approved keep the rate they were approved at, so a raise never restates a week that has been paid.",
      "An hourly contractor with no Clockify link imports zero hours and would be paid nothing. The Contractors screen flags anybody in that state.",
    ],
  },
  {
    id: "everyday",
    title: "Everyday things",
    audience: "everyone",
    summary: "Smaller behaviours worth knowing about.",
    items: [
      {
        term: "Live updates",
        detail:
          "The Dashboard and C1 update on their own within a couple of seconds when somebody else changes something. No refreshing needed.",
      },
      {
        term: "Themes",
        detail:
          "Light, dark and blossom, from the header. Your choice follows you between machines.",
      },
      {
        term: "Notes",
        detail:
          "Each note keeps its author and time. You can edit your own; the original text stays in the audit log.",
      },
      {
        term: "What's new",
        detail:
          "A short summary of changes appears the next time you load the app after an update. Dismiss it and it will not come back.",
      },
      {
        term: "Where invoices are filed",
        detail:
          "When Drive archiving is switched on, every invoice PDF is copied into a Google Drive folder as it is generated, and the Invoices screen shows a Drive link beside the PDF link. If it says \"not filed\", hover it — the reason is there, and an administrator can retry. An invoice is still generated and still emailed either way.",
      },
      {
        term: "The Legacy badge",
        detail:
          "Marks an event brought over from the old PhantomChecker spreadsheet rather than created here. Those rows have no assignee, nobody named against a completion and no author on their notes — the spreadsheet never recorded any of that. Everything it did record is there. They are otherwise ordinary events: assign them, tick them, note them as usual.",
      },
    ],
    gotchas: [
      "Clocking in or out of Clockify shows a small notification — to you, and to everybody else on the team.",
    ],
  },
  {
    id: "trouble",
    title: "When something looks wrong",
    audience: "everyone",
    summary: "The handful of things that most often turn out not to be faults.",
    gotchas: [
      "An event vanished — its date has probably passed. Past events leave both screens automatically; their history is kept.",
      "A C1 row disappeared — every checkpoint on it is resolved, so the event has left the pipeline.",
      "Hours look wrong on Metrics — check the period filter. It applies to every chart on the screen, including hours worked.",
      "Time data says unavailable — open the Clockify chip in the header and press Refresh. If it keeps happening, tell an administrator rather than retrying repeatedly.",
      "A payroll row will not change — it has been invoiced. The invoice has to be voided before the week can be corrected.",
    ],
  },
];
