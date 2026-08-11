import type { Metadata, Viewport } from "next";
import { ToastProvider } from "@/components/ui/toast";
import { ThemeProvider } from "@/components/ui/theme";
import { themeInitScript } from "@/lib/ui/theme-script";
import { getSettings } from "@/lib/services/settings";
import { getActorContext } from "@/lib/auth/guards";
import { isTheme, type ThemeValue } from "@/lib/domain/constants";
import "./globals.css";

// No SessionProvider: the signed-in user is resolved on the server here and
// passed down as props. Adding one would make every page fetch
// /api/auth/session again from the browser for information it already has.

export const metadata: Metadata = {
  title: "JPD Group Matrix",
  description: "Internal event workflow system.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Theme precedence: the person's own saved choice, then the site default.
  // Falls back to light if the database is unreachable, so a connection problem
  // still renders a usable sign-in page.
  let defaultTheme: ThemeValue = "light";
  let signedIn = false;

  try {
    const [settings, actor] = await Promise.all([getSettings(), getActorContext()]);
    defaultTheme = settings.defaultTheme;
    signedIn = actor !== null;

    if (actor && isTheme(actor.effective.theme)) {
      defaultTheme = actor.effective.theme;
    }
  } catch {
    defaultTheme = "light";
  }

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Applies the theme before first paint. A React effect would run too
            late and the wrong theme would flash on every load. */}
        <script
          dangerouslySetInnerHTML={{
            __html: themeInitScript(defaultTheme, signedIn),
          }}
        />
      </head>
      <body>
        <ThemeProvider defaultTheme={defaultTheme} persist={signedIn}>
          <ToastProvider>{children}</ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
