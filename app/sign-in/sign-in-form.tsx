"use client";

import * as React from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Button, Field, Input } from "@/components/ui/primitives";

export function SignInForm({
  callbackUrl,
  googleEnabled,
  initialError,
}: {
  callbackUrl: string;
  googleEnabled: boolean;
  initialError: string | null;
}) {
  const router = useRouter();
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(initialError);
  const [pending, setPending] = React.useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);

    try {
      const result = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });

      if (!result || result.error) {
        // Deliberately the same message for a wrong password, an unknown
        // account and a deactivated one — the response must not reveal which
        // email addresses exist.
        setError("That email and password combination was not recognised.");
        return;
      }

      router.push(callbackUrl);
      router.refresh();
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={onSubmit} className="space-y-3.5">
        <Field label="Email" htmlFor="email" required>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
          />
        </Field>

        <Field label="Password" htmlFor="password" required>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>

        {error ? (
          <p
            role="alert"
            className="rounded-md border border-[var(--color-danger)]/25 bg-[var(--color-danger-soft)] px-2.5 py-2 text-[12px] text-[var(--color-danger)]"
          >
            {error}
          </p>
        ) : null}

        <Button
          type="submit"
          variant="primary"
          loading={pending}
          className="w-full"
        >
          Sign in
        </Button>
      </form>

      {googleEnabled ? (
        <>
          <div className="flex items-center gap-3">
            <span className="h-px flex-1 bg-[var(--color-line)]" />
            <span className="text-[11px] text-[var(--color-ink-subtle)]">or</span>
            <span className="h-px flex-1 bg-[var(--color-line)]" />
          </div>

          <Button
            type="button"
            className="w-full"
            onClick={() => signIn("google", { callbackUrl })}
          >
            Continue with Google
          </Button>
        </>
      ) : null}
    </div>
  );
}
