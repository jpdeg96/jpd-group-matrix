"use client";

/**
 * Google Drive archiving and Discord notifications.
 *
 * Both follow the rule the Clockify and email cards already set: the credential
 * lives in the environment and only *whether it exists* reaches the browser.
 * The folder ID is the exception and is edited here, because it is not secret —
 * it is visible in the folder's own URL — and it is the piece that changes.
 *
 * Each has a test button. Setting either up involves several steps in somebody
 * else's dashboard, and being able to prove it works without waiting for a
 * payroll run is the difference between configuration and hope.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, Field, Input, PageHeader } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { api, ApiRequestError } from "@/lib/ui/api-client";
import type { AppSettings } from "@/lib/services/settings";

export function IntegrationSettings({
  settings,
  driveKeyPresent,
  discordWebhookPresent,
}: {
  settings: AppSettings;
  driveKeyPresent: boolean;
  discordWebhookPresent: boolean;
}) {
  return (
    <>
      <DriveSettings settings={settings} keyPresent={driveKeyPresent} />
      <ImportSheetSettings settings={settings} keyPresent={driveKeyPresent} />
      <DiscordSettings settings={settings} webhookPresent={discordWebhookPresent} />
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Import spreadsheet                                                         */
/* -------------------------------------------------------------------------- */

/**
 * The Google Sheet Bulk import reads from.
 *
 * Its own card rather than a field on the Drive one: they share a credential
 * but nothing else. Drive archiving is about invoices going out, this is about
 * events coming in, and burying one inside the other would hide it from anybody
 * looking for it by name.
 */
function ImportSheetSettings({
  settings,
  keyPresent,
}: {
  settings: AppSettings;
  keyPresent: boolean;
}) {
  const router = useRouter();
  const toast = useToast();

  const [sheetId, setSheetId] = React.useState(settings.importSheetId ?? "");
  const [tab, setTab] = React.useState(settings.importSheetTab ?? "");
  const [pending, setPending] = React.useState(false);
  const [testing, setTesting] = React.useState(false);
  const [accountEmail, setAccountEmail] = React.useState<string | null>(null);

  const linkedUrl = settings.importSheetId
    ? `https://docs.google.com/spreadsheets/d/${settings.importSheetId}/edit`
    : null;

  async function save() {
    setPending(true);
    try {
      await api.patch("/api/settings", {
        importSheetId: sheetId.trim() || null,
        importSheetTab: tab.trim() || null,
      });
      toast.success("Import spreadsheet saved.");
      router.refresh();
    } catch (error) {
      toast.error(
        "Could not save the spreadsheet.",
        error instanceof ApiRequestError ? error.message : undefined,
      );
    } finally {
      setPending(false);
    }
  }

  async function test() {
    setTesting(true);
    try {
      const result = await api.post<{
        ok: boolean;
        message: string;
        serviceAccountEmail: string | null;
      }>("/api/integrations/sheet/test", { sheetId: sheetId.trim() || null });

      // Kept on screen rather than only in the toast: the address is what you
      // need in the Google Share dialog, and a toast is gone by the time you
      // have switched tabs to paste it.
      setAccountEmail(result.serviceAccountEmail);

      if (result.ok) toast.success(result.message);
      else toast.error("Could not read that spreadsheet.", result.message);
    } catch (error) {
      toast.error(
        "Could not reach Google Sheets.",
        error instanceof ApiRequestError ? error.message : undefined,
      );
    } finally {
      setTesting(false);
    }
  }

  return (
    <Card>
      <PageHeader
        title="Import spreadsheet"
        subtitle="Lets Bulk import pull rows straight from a Google Sheet."
      />

      <div className="space-y-3 px-5 py-4">
        {!keyPresent ? (
          <p
            className="rounded-md border px-2.5 py-2 text-[11.5px]"
            style={{ borderColor: "var(--warn)", background: "var(--warn-soft)", color: "var(--warn)" }}
          >
            No Google service-account key is set on the server, so nothing can be
            read yet. It is the same key Drive archiving uses —
            GOOGLE_SERVICE_ACCOUNT_JSON.
          </p>
        ) : null}

        <p className="text-[11.5px]" style={{ color: "var(--ink-muted)" }}>
          Paste the sheet&rsquo;s ID or its whole URL — both work. The service
          account must be given access to the file itself: open the sheet, press
          Share, and add its email address as a Viewer. Reading is all it ever
          does; nothing here writes back.
        </p>

        <Field label="Spreadsheet ID or URL" htmlFor="importSheetId">
          <Input
            id="importSheetId"
            value={sheetId}
            onChange={(event) => setSheetId(event.target.value)}
            placeholder="1AbC… or https://docs.google.com/spreadsheets/d/1AbC…/edit"
          />
        </Field>

        <Field label="Tab" htmlFor="importSheetTab">
          <Input
            id="importSheetTab"
            value={tab}
            onChange={(event) => setTab(event.target.value)}
            placeholder="Leave empty for the first tab"
          />
        </Field>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" loading={pending} onClick={save}>
            Save
          </Button>
          <Button loading={testing} disabled={!sheetId.trim()} onClick={test}>
            Test connection
          </Button>
          {linkedUrl ? (
            <a
              href={linkedUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11.5px] underline-offset-2 hover:underline"
              style={{ color: "var(--accent)" }}
            >
              Open the linked sheet ↗
            </a>
          ) : null}
        </div>

        {accountEmail ? (
          <div
            className="rounded-md border px-2.5 py-2"
            style={{ borderColor: "var(--line)", background: "var(--canvas)" }}
          >
            <p className="text-[11.5px]" style={{ color: "var(--ink-muted)" }}>
              Share the sheet with this address as a <strong>Viewer</strong>:
            </p>
            {/* Selectable rather than a label: it is going to be copied into
                Google's Share dialog, and retyping a service-account address by
                hand is how a working key looks broken. */}
            <code
              className="mt-1 block select-all break-all rounded px-1.5 py-1 text-[11.5px]"
              style={{ background: "var(--surface)", color: "var(--ink)" }}
            >
              {accountEmail}
            </code>
          </div>
        ) : null}
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Google Drive                                                               */
/* -------------------------------------------------------------------------- */

function DriveSettings({
  settings,
  keyPresent,
}: {
  settings: AppSettings;
  keyPresent: boolean;
}) {
  const router = useRouter();
  const toast = useToast();

  const [enabled, setEnabled] = React.useState(settings.driveUploadEnabled);
  const [folderId, setFolderId] = React.useState(settings.driveFolderId ?? "");
  const [pending, setPending] = React.useState(false);
  const [testing, setTesting] = React.useState(false);

  async function save() {
    setPending(true);
    try {
      await api.patch("/api/settings", {
        driveUploadEnabled: enabled,
        driveFolderId: folderId.trim() || null,
      });
      toast.success("Drive settings saved.");
      router.refresh();
    } catch (error) {
      toast.error(
        "Could not save Drive settings.",
        error instanceof ApiRequestError ? error.message : undefined,
      );
    } finally {
      setPending(false);
    }
  }

  async function test() {
    setTesting(true);
    try {
      const result = await api.post<{ folderName: string; serviceAccountEmail: string }>(
        "/api/integrations/drive/test",
        { folderId: folderId.trim() },
      );
      toast.success(`Reached "${result.folderName}". Invoices will be filed there.`);
    } catch (error) {
      toast.error(
        "Could not reach that folder.",
        error instanceof ApiRequestError ? error.message : undefined,
      );
    } finally {
      setTesting(false);
    }
  }

  return (
    <Card>
      <PageHeader
        title="Google Drive"
        subtitle="Files a copy of every invoice PDF into a Drive folder as it is generated."
        actions={
          <>
            <Button size="sm" loading={testing} disabled={!folderId.trim()} onClick={test}>
              Test connection
            </Button>
            <Button variant="primary" size="sm" loading={pending} onClick={save}>
              Save
            </Button>
          </>
        }
      />

      <div className="space-y-4 p-5">
        <StatusNote present={keyPresent} label="Service account">
          {keyPresent ? (
            <>
              GOOGLE_SERVICE_ACCOUNT_JSON is set on the server.
              <span className="mt-1 block opacity-80">
                If you replace the key, <strong>restart the server</strong> — the
                environment is read once at startup.
              </span>
            </>
          ) : (
            <>
              Uploads cannot run until the service-account key is on the server.
              Paste the downloaded JSON file whole into{" "}
              <code>GOOGLE_SERVICE_ACCOUNT_JSON</code> and restart.
              <span className="mt-1.5 block">
                It lives in the environment rather than in this form so a database
                dump never contains a live credential.
              </span>
            </>
          )}
        </StatusNote>

        <label className="flex cursor-pointer items-start gap-2 text-[12.5px]">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
            style={{ accentColor: "var(--accent)" }}
            className="mt-0.5 h-3.5 w-3.5"
          />
          <span>
            File invoice PDFs into Drive
            <span className="block text-[11.5px]" style={{ color: "var(--ink-subtle)" }}>
              An upload failing never stops an invoice being generated or emailed —
              the reason is recorded on the invoice so it can be retried.
            </span>
          </span>
        </label>

        <div
          className="rounded-md border px-3 py-2 text-[11.5px]"
          style={{ borderColor: "var(--line)", color: "var(--ink-muted)" }}
        >
          <strong style={{ color: "var(--ink)" }}>The folder has to be in a Shared Drive.</strong>{" "}
          Google gives service accounts no storage of their own, so they cannot own files in an
          ordinary My Drive folder — sharing one lets the app read it and still refuses every
          upload. In a Shared Drive the drive owns the files, so it works. Add the service
          account as a member with <strong>Content manager</strong> access.
        </div>

        <Field
          label="Folder ID"
          htmlFor="driveFolderId"
          hint="Open the folder in Drive; the ID is the last part of the URL, after /folders/. Test connection writes a small file and deletes it again, so a pass means uploads will actually work."
        >
          <Input
            id="driveFolderId"
            value={folderId}
            onChange={(event) => setFolderId(event.target.value)}
            placeholder="1AbCdEfGhIjKlMnOpQrStUvWxYz"
            spellCheck={false}
          />
        </Field>
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Discord                                                                    */
/* -------------------------------------------------------------------------- */

function DiscordSettings({
  settings,
  webhookPresent,
}: {
  settings: AppSettings;
  webhookPresent: boolean;
}) {
  const router = useRouter();
  const toast = useToast();

  const [enabled, setEnabled] = React.useState(settings.discordEnabled);
  const [pending, setPending] = React.useState(false);
  const [testing, setTesting] = React.useState(false);

  async function save() {
    setPending(true);
    try {
      await api.patch("/api/settings", { discordEnabled: enabled });
      toast.success("Discord settings saved.");
      router.refresh();
    } catch (error) {
      toast.error(
        "Could not save Discord settings.",
        error instanceof ApiRequestError ? error.message : undefined,
      );
    } finally {
      setPending(false);
    }
  }

  async function test() {
    setTesting(true);
    try {
      await api.post("/api/integrations/discord/test", {});
      toast.success("Test posted — check the channel.");
    } catch (error) {
      toast.error(
        "Could not post to Discord.",
        error instanceof ApiRequestError ? error.message : undefined,
      );
    } finally {
      setTesting(false);
    }
  }

  return (
    <Card>
      <PageHeader
        title="Discord"
        subtitle="Posts releases and Clockify outages to a channel."
        actions={
          <>
            <Button size="sm" loading={testing} disabled={!webhookPresent} onClick={test}>
              Send a test
            </Button>
            <Button variant="primary" size="sm" loading={pending} onClick={save}>
              Save
            </Button>
          </>
        }
      />

      <div className="space-y-4 p-5">
        <StatusNote present={webhookPresent} label="Webhook">
          {webhookPresent ? (
            <>
              DISCORD_WEBHOOK_URL is set on the server.
              <span className="mt-1 block opacity-80">
                Anyone holding that URL can post to the channel, which is why it
                lives in the environment and is never shown here.
              </span>
            </>
          ) : (
            <>
              In Discord: <strong>Server Settings → Integrations → Webhooks →
              New Webhook</strong>, pick the channel, then copy the URL into{" "}
              <code>DISCORD_WEBHOOK_URL</code> and restart the server.
            </>
          )}
        </StatusNote>

        <label className="flex cursor-pointer items-start gap-2 text-[12.5px]">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
            style={{ accentColor: "var(--accent)" }}
            className="mt-0.5 h-3.5 w-3.5"
          />
          <span>
            Post notifications to Discord
            <span className="block text-[11.5px]" style={{ color: "var(--ink-subtle)" }}>
              A release going live, and Clockify starting or stopping responding.
              Notifications never fail the work that triggered them. Payroll is
              deliberately absent — the channel has no per-person addressing, so
              posting a run would put the week&rsquo;s figures in front of
              everybody who can read it.
            </span>
          </span>
        </label>

        <div
          className="rounded-md border px-3 py-2 text-[11.5px]"
          style={{ borderColor: "var(--line)", color: "var(--ink-muted)" }}
        >
          <strong style={{ color: "var(--ink)" }}>Site outages are not on this list.</strong>{" "}
          A site that is down cannot report that it is down. Point an uptime monitor
          at <code>/api/health</code> and let it post to the same channel — that is
          the only way an outage alert can be trusted.
        </div>
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */

function StatusNote({
  present,
  label,
  children,
}: {
  present: boolean;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="rounded-md border px-3 py-2 text-[11.5px]"
      style={{
        borderColor: present ? "var(--success)" : "var(--warn)",
        background: present ? "var(--success-soft)" : "var(--warn-soft)",
        color: present ? "var(--success)" : "var(--warn)",
      }}
    >
      <Badge tone={present ? "success" : "warn"}>
        {present ? `${label} detected` : `${label} missing`}
      </Badge>{" "}
      {children}
    </div>
  );
}
