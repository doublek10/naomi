import { cn } from "@/lib/utils";

export function Badge({
  className,
  tone = "default",
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: "default" | "success" | "warning" | "danger" }) {
  const tones: Record<string, string> = {
    default: "bg-line/50 text-ink",
    success: "bg-moss/15 text-moss",
    warning: "bg-brass/15 text-brass",
    danger: "bg-rust/15 text-rust",
  };
  return <span className={cn("inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium", tones[tone], className)} {...props} />;
}
