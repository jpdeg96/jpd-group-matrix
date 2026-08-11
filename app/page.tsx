import { redirect } from "next/navigation";

/** The Event Dashboard is the working screen, so it is the landing page. */
export default function HomePage() {
  redirect("/dashboard");
}
