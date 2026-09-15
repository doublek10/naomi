import { db } from "@/lib/db-bridge";
import { monthStart, dashboardPaymentsWindowStart } from "@/lib/invoice-service";
import { formatKES, formatMonthLabel } from "@/lib/utils";
import { StatCard } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const month = monthStart();
  const paymentsWindowStart = dashboardPaymentsWindowStart();
  const [counts, recentPayments] = await Promise.all([
    db.dashboard.counts(paymentsWindowStart),
    db.bbilt.recent(8),
  ]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-2xl text-ink">Dashboard</h1>
        <p className="mt-1 text-sm text-slate">{formatMonthLabel(month)}</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Rooms" value={counts.room_count} />
        <StatCard label="Tenants" value={counts.tenant_count} />
        <StatCard
          label="Payments this month"
          value={formatKES(counts.payments_this_month)}
          hint="Sum of bbilt.amount_paid received so far this calendar month"
        />
      </div>

      <div>
        <h2 className="font-display text-lg text-ink">Recent payments</h2>
        <p className="mt-1 text-sm text-slate">
          The latest entries in <code>bbilt</code> — check the room and amount against{" "}
          <a href="/invoices" className="underline">
            Invoices
          </a>{" "}
          if anything looks off; your schema doesn&apos;t track a separate matched/unmatched
          flag, so this list is for eyeballing.
        </p>
        <div className="mt-3 overflow-hidden rounded-md border border-line">
          <table className="w-full text-left text-sm">
            <tbody>
              {recentPayments.length === 0 && (
                <tr>
                  <td className="px-4 py-6 text-center text-slate">No payments logged yet.</td>
                </tr>
              )}
              {recentPayments.map((p) => (
                <tr key={p.id} className="border-t border-line first:border-t-0">
                  <td className="px-4 py-3">{p.room_number}</td>
                  <td className="px-4 py-3">{formatKES(p.amount_paid)}</td>
                  <td className="px-4 py-3 text-slate">{p.mpesa_code || "—"}</td>
                  <td className="px-4 py-3 text-right text-slate">{p.created_at}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
