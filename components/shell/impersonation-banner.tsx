"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { UserPill } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { api, ApiRequestError } from "@/lib/ui/api-client";
import { roleLabel, type UserRoleValue } from "@/lib/domain/constants";

/**
 * Permanent bar shown for the whole time an administrator is viewing as
 * somebody else.
 *
 * Deliberately impossible to miss and impossible to dismiss. Impersonation that
 * you can forget you are in is indistinguishable from the other person doing
 * the work — which becomes a real problem the day somebody disputes a
 * completion. Every action taken from here is separately recorded in the audit
 * log against the administrator *and* the account being viewed.
 */
export function ImpersonationBanner({
  viewingAs,
  realName,
}: {
  viewingAs: { id: string; displayName: string; color: string; role: UserRoleValue };
  realName: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, setPending] = React.useState(false);

  async function stop() {
    setPending(true);
    try {
      await api.post("/api/impersonate", { userId: null });
      toast.success("Returned to your own account.");
      router.refresh();
    } catch (error) {
      toast.error(
        "Could not stop viewing as this user.",
        error instanceof ApiRequestError ? error.message : undefined,
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <div
      role="status"
      className="sticky top-0 z-50 flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-1.5 text-[12px] font-medium"
      style={{ background: "var(--warn)", color: "#1a1206" }}
    >
      <span className="flex items-center gap-2">
        <span aria-hidden className="text-[13px]">
          👁
        </span>
        Viewing as
        <UserPill name={viewingAs.displayName} color={viewingAs.color} />
        <span className="opacity-80">({roleLabel(viewingAs.role)})</span>
      </span>

      <span className="opacity-80">
        You are signed in as {realName}. Anything you do here is recorded against
        your account.
      </span>

      <button
        type="button"
        onClick={stop}
        disabled={pending}
        className="ml-auto rounded border border-black/25 bg-black/10 px-2 py-0.5 text-[11.5px] font-semibold transition hover:bg-black/20 disabled:opacity-60"
      >
        {pending ? "Returning…" : "Stop viewing as"}
      </button>
    </div>
  );
}
