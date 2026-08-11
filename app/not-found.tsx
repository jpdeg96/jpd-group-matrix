import Link from "next/link";

export default function NotFound() {
  return (
    <main
      className="flex min-h-screen items-center justify-center px-4"
      style={{ background: "var(--canvas)" }}
    >
      <div className="text-center">
        <p className="text-[14px] font-semibold">Page not found</p>
        <p className="mt-1.5 text-[12.5px]" style={{ color: "var(--ink-muted)" }}>
          That page does not exist.
        </p>
        <Link
          href="/dashboard"
          className="mt-4 inline-block rounded-md border px-3 py-1.5 text-[12.5px] font-medium"
          style={{ borderColor: "var(--line-strong)", background: "var(--surface)" }}
        >
          Go to Event Dashboard
        </Link>
      </div>
    </main>
  );
}
