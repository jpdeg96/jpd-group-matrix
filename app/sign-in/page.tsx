import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/guards";
import { isGoogleAuthEnabled } from "@/lib/auth";
import { SignInForm } from "./sign-in-form";
import { Logo } from "@/components/shell/logo";
import { resolveLogoSrc } from "@/lib/ui/logo-path";

export const dynamic = "force-dynamic";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
}) {
  const user = await getSessionUser();
  if (user) redirect("/dashboard");

  const { callbackUrl, error } = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--color-canvas)] px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mb-3 flex justify-center">
            <Logo src={resolveLogoSrc()} height={44} alt="JPD Group" />
          </div>
          <h1 className="text-[17px] font-semibold tracking-tight">
            JPD Group Matrix
          </h1>
          <p className="mt-1 text-[12.5px] text-[var(--color-ink-muted)]">
            Internal event-review workflow
          </p>
        </div>

        <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-5 shadow-sm">
          <SignInForm
            callbackUrl={callbackUrl ?? "/dashboard"}
            googleEnabled={isGoogleAuthEnabled}
            initialError={error ? describeAuthError(error) : null}
          />
        </div>

        <p className="mt-4 text-center text-[11.5px] text-[var(--color-ink-subtle)]">
          Accounts are created by an administrator. Sign-in does not register new
          users.
        </p>
      </div>
    </main>
  );
}

function describeAuthError(code: string): string {
  switch (code) {
    case "CredentialsSignin":
      return "That email and password combination was not recognised.";
    case "AccessDenied":
      return "That account is not permitted to sign in. Ask an administrator to add or reactivate it.";
    default:
      return "Sign-in failed. Please try again.";
  }
}
