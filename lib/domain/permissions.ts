/**
 * What a role is allowed to do.
 *
 * Permissions are *named capabilities*, not a rank. The old model was a ladder
 * — USER < MANAGER < ADMIN — which meant every new ability had to be slotted
 * somewhere on it, and "a manager who may not see payroll" was unsayable.
 * Named capabilities say exactly one thing each, and a role is whichever set
 * somebody chose.
 *
 * The catalogue is code and the *grants* are data. That split matters: a
 * permission only exists if something enforces it, so inventing one in the
 * database would create a switch wired to nothing. Adding a capability here is
 * a deliberate act that comes with the code that checks it.
 *
 * Every key here is enforced on the server. The UI also consults them, but
 * only ever to avoid offering what the server would refuse.
 */

export const PERMISSIONS = [
  /* Events -------------------------------------------------------------- */
  {
    key: "events.editDetails",
    group: "Events",
    label: "Add and edit event details",
    detail: "The date, type, teams and venue — what the event *is*.",
  },
  {
    key: "events.assignOthers",
    group: "Events",
    label: "Assign work to other people",
    detail:
      "Without this, somebody can only claim work nobody has taken, and cannot hand it on or take it back.",
  },
  {
    key: "events.workAnyRow",
    group: "Events",
    label: "Work on anybody's row",
    detail:
      "Tick boxes, start, note and flag on events assigned to someone else. Everyone can always work their own.",
  },
  {
    key: "events.delete",
    group: "Events",
    label: "Delete events",
    detail: "Anything carrying completed review work is cancelled rather than deleted.",
  },
  {
    key: "events.import",
    group: "Events",
    label: "Bulk import events",
    detail: "Paste rows, load a CSV, or pull from the linked Google Sheet.",
  },
  {
    key: "events.bulkEdit",
    group: "Events",
    label: "Change many events at once",
    detail: "The Bulk actions tool on the Dashboard.",
  },
  {
    key: "flags.clear",
    group: "Events",
    label: "Clear flags",
    detail:
      "Anyone may raise one and say they have dealt with it; clearing is the sign-off.",
  },

  /* C1 ------------------------------------------------------------------ */
  {
    key: "stages.editDueDates",
    group: "C1",
    label: "Change review due dates",
    detail: "Individually or with the bulk date tool. Moves a deadline the schedule set.",
  },

  /* Payroll ------------------------------------------------------------- */
  { key: "payroll.view", group: "Payroll", label: "See the Payroll screens" },
  {
    key: "payroll.importTime",
    group: "Payroll",
    label: "Import time from Clockify",
    detail: "Cannot restate a week already approved or invoiced.",
  },
  { key: "payroll.approve", group: "Payroll", label: "Review and approve hours" },
  {
    key: "payroll.invoice",
    group: "Payroll",
    label: "Generate invoices",
    detail: "Turns approved hours into money owed.",
  },
  {
    key: "payroll.remit",
    group: "Payroll",
    label: "Send remittance",
    detail: "Emails each contractor their invoice.",
  },
  { key: "payroll.manageContractors", group: "Payroll", label: "Manage contractors and rates" },

  /* Oversight ----------------------------------------------------------- */
  {
    key: "metrics.viewTeam",
    group: "Oversight",
    label: "See everybody's metrics",
    detail: "Without this, the Metrics page shows only your own figures.",
  },
  {
    key: "presence.viewTeam",
    group: "Oversight",
    label: "See who is working on what",
    detail: "The Team chip in the header.",
  },
  {
    key: "clock.notify",
    group: "Oversight",
    label: "Be notified when somebody clocks in or out",
    detail:
      "Sent to their phone if they have turned notifications on. Each person can still mute these for themselves without losing the rest.",
  },
  { key: "audit.view", group: "Oversight", label: "Read the audit log" },

  /* Administration ------------------------------------------------------ */
  {
    key: "users.manage",
    group: "Administration",
    label: "Manage users and roles",
    detail: "Including this screen. A role that loses it cannot get it back on its own.",
  },
  {
    key: "settings.manage",
    group: "Administration",
    label: "Change settings and event types",
  },
  {
    key: "impersonate",
    group: "Administration",
    label: "View the site as another user",
    detail: "Everything done while viewing as somebody is logged against the real account.",
  },
] as const;

export type Permission = (typeof PERMISSIONS)[number]["key"];

export const PERMISSION_KEYS: readonly Permission[] = PERMISSIONS.map((p) => p.key);

/** The order groups appear in the editor. */
export const PERMISSION_GROUPS = [
  "Events",
  "C1",
  "Payroll",
  "Oversight",
  "Administration",
] as const;

export function isPermission(value: string): value is Permission {
  return (PERMISSION_KEYS as readonly string[]).includes(value);
}

/* -------------------------------------------------------------------------- */
/* The built-in roles                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Keys that always exist.
 *
 * Their *grants* are editable like any other role — the whole point of this
 * feature — but the roles themselves cannot be deleted, because every user row
 * has to point at something and because `ADMIN` is the floor the lock-out
 * guard stands on.
 */
export const SYSTEM_ROLE_KEYS = ["ADMIN", "MANAGER", "USER"] as const;
export type SystemRoleKey = (typeof SYSTEM_ROLE_KEYS)[number];

/**
 * What each built-in role could do before permissions became editable.
 *
 * Reproduced exactly, so switching to this model changes nobody's access on
 * the day it ships. Anything that differed here would be a silent permission
 * change dressed up as a refactor.
 */
export const DEFAULT_GRANTS: Record<SystemRoleKey, readonly Permission[]> = {
  USER: [],
  MANAGER: [
    "events.editDetails",
    "events.assignOthers",
    "events.workAnyRow",
    "events.delete",
    "events.import",
    "events.bulkEdit",
    "flags.clear",
    "payroll.view",
    "payroll.importTime",
    "payroll.approve",
    "metrics.viewTeam",
    "presence.viewTeam",
    "clock.notify",
    "audit.view",
  ],
  ADMIN: [...PERMISSION_KEYS],
};

/**
 * Permissions without which the site cannot be administered back into shape.
 *
 * At least one role must keep both, and a role holding them cannot have them
 * removed if it is the last one — otherwise a single click locks everybody out
 * of Users and Settings permanently, with no way back that does not involve a
 * database console.
 */
export const LOCKOUT_CRITICAL: readonly Permission[] = ["users.manage", "settings.manage"];

/** A role key from a human name: "Shift Lead" → "SHIFT_LEAD". */
export function roleKeyFromName(name: string): string {
  return name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}
