"use client";

import { Button } from "@/components/ui/button";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto max-w-lg rounded-md border border-rust/30 bg-rust/5 p-6">
      <h2 className="font-display text-lg text-ink">Something went wrong</h2>
      <p className="mt-2 text-sm text-slate">{error.message || "An unexpected error occurred."}</p>
      <Button variant="secondary" className="mt-4" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
