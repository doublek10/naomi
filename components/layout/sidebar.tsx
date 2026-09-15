"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import {
  LayoutDashboard,
  DoorOpen,
  Users,
  Wallet,
  Droplets,
  Receipt,
  Settings,
  LogOut,
  ReceiptText,
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/rooms", label: "Rooms", icon: DoorOpen },
  { href: "/tenants", label: "Tenants", icon: Users },
  { href: "/rent", label: "Rent", icon: Wallet },
  { href: "/water-billing", label: "Water billing", icon: Droplets },
  { href: "/invoices", label: "Invoices", icon: Receipt },
  { href: "/expenses", label: "Expenses", icon: ReceiptText },
  { href: "/settings/users", label: "Settings", icon: Settings },
];

export function Sidebar({ username }: { username?: string | null }) {
  const pathname = usePathname();

  return (
    <aside className="flex h-screen w-60 shrink-0 flex-col border-r border-line bg-white/40">
      <div className="border-b border-line px-5 py-6">
        <p className="font-display text-lg leading-tight text-ink">Dana&apos;s Residency</p>
        <p className="text-xs text-slate">Rental management</p>
      </div>

      <nav className="flex-1 space-y-1 px-3 py-4">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname?.startsWith(href + "/");
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "focus-ring flex items-center gap-3 rounded-sm px-3 py-2 text-sm transition-colors",
                active ? "bg-ink text-paper" : "text-slate hover:bg-line/50 hover:text-ink"
              )}
            >
              <Icon size={16} strokeWidth={2} />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-line px-5 py-4">
        <p className="mb-2 truncate text-xs text-slate">Signed in as {username ?? "admin"}</p>
        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="focus-ring flex items-center gap-2 text-sm text-slate hover:text-rust"
        >
          <LogOut size={16} /> Sign out
        </button>
      </div>
    </aside>
  );
}
