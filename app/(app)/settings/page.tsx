import { redirect } from "next/navigation";
import { getActorContext } from "@/lib/auth/guards";
import { getSettings } from "@/lib/services/settings";
import { listEventTypes } from "@/lib/services/event-types";
import { isClockifyConfigured } from "@/lib/clockify/client";
import { emailFromAddress, isEmailConfigured } from "@/lib/email/client";
import { isDriveConfigured } from "@/lib/services/google-drive";
import { isDiscordConfigured } from "@/lib/notify/discord";
import { SettingsView } from "@/components/settings/settings-view";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  // A non-admin arriving by typing the URL is sent somewhere useful rather than
  // shown an error. The API enforces the same rule independently.
  const actor = await getActorContext();
  if (!actor) redirect("/sign-in");
  if (actor.effective.role !== "ADMIN") redirect("/dashboard");

  const [settings, types] = await Promise.all([getSettings(), listEventTypes()]);

  return (
    <SettingsView
      settings={settings}
      types={types}
      // Only whether a key exists is sent to the browser — never the key itself.
      clockifyKeyPresent={isClockifyConfigured()}
      // Whether the credential exists, never the credential. The sender
      // address is not secret and showing it is what makes a typo findable.
      emailConfigured={isEmailConfigured()}
      emailFrom={emailFromAddress()}
      // Again: whether the credential exists, never the credential itself.
      driveKeyPresent={isDriveConfigured()}
      discordWebhookPresent={isDiscordConfigured()}
    />
  );
}
