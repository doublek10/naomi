import { db } from "@/lib/db-bridge";
import { monthStart, isManualRegenerationWindowOpen } from "@/lib/invoice-service";
import { formatKES, formatMonthLabel } from "@/lib/utils";
import { Table, Thead, Th, Td, EmptyRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { generateInvoicesAction, markAllPaidAction, markInvoicePaidAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: { month?: string };
}) {
  const month = searchParams.month ? `${searchParams.month}-01` : monthStart();
  const monthInputValue = month.slice(0, 7);

  const [invoices, { exists }] = await Promise.all([
    db.invoices.forMonth(month),
    db.invoices.existForMonth(month),
  ]);

  const openCount = invoices.filter((i) => i.status !== "paid").length;
  const canRegenerateThisMonth = month === monthStart() ? isManualRegenerationWindowOpen() : true;

  const statusTone = { pending: "warning", waiting: "warning", paid: "success" } as const;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl text-ink">Invoices</h1>
          <p className="mt-1 text-sm text-slate">{formatMonthLabel(month)}</p>
        </div>
        <form method="get" className="flex items-center gap-2">
          <Input type="month" name="month" defaultValue={monthInputValue} className="w-40" />
          <Button type="submit" variant="secondary">
            View month
          </Button>
        </form>
      </div>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-sm font-medium text-ink">Generate invoices</h2>
            <p className="mt-1 max-w-lg text-sm text-slate">
              {exists
                ? "Invoices already exist for this month — generation is blocked to avoid duplicates."
                : "Creates one invoice per occupied room: rent + this month's water balance, minus any credit (or plus any amount still owed) carried from the room's last paid invoice."}
            </p>
            {!canRegenerateThisMonth && !exists && (
              <p className="mt-1 text-xs text-brass">
                Manual generation for the current month is only allowed the 1st–15th.
              </p>
            )}
          </div>
          <form action={generateInvoicesAction}>
            <input type="hidden" name="month" value={month} />
            <Button type="submit" disabled={exists || !canRegenerateThisMonth}>
              Generate for this month
            </Button>
          </form>
        </div>
      </Card>

      {openCount > 0 && (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-sm font-medium text-ink">Bulk override</h2>
              <p className="mt-1 text-sm text-slate">
                Force all {openCount} open invoice{openCount === 1 ? "" : "s"} this month (pending +
                waiting) to paid. Requires your password.
              </p>
            </div>
            <form action={markAllPaidAction} className="flex items-center gap-2">
              <input type="hidden" name="month" value={month} />
              <Input type="password" name="password" placeholder="Your password" required className="w-40" />
              <Button type="submit" variant="danger">
                Mark all paid
              </Button>
            </form>
          </div>
        </Card>
      )}

      <Table>
        <Thead>
          <tr>
            <Th>Room</Th>
            <Th>Tenant</Th>
            <Th>Rent</Th>
            <Th>Water</Th>
            <Th>Total</Th>
            <Th>Paid</Th>
            <Th>M-Pesa code</Th>
            <Th>Status</Th>
            <Th className="text-right">Override</Th>
          </tr>
        </Thead>
        <tbody>
          {invoices.length === 0 && <EmptyRow colSpan={9}>No invoices for this month yet.</EmptyRow>}
          {invoices.map((inv) => (
            <tr key={inv.invoice_id}>
              <Td>{inv.room_number}</Td>
              <Td>{inv.tenant_name ?? "—"}</Td>
              <Td>{formatKES(inv.monthly_rent)}</Td>
              <Td>{formatKES(inv.area_balance)}</Td>
              <Td className="font-medium">{formatKES(inv.total_amount)}</Td>
              <Td>{formatKES(inv.amount_paid)}</Td>
              <Td className="text-slate">{inv.mpesa_code || "—"}</Td>
              <Td>
                <Badge tone={statusTone[inv.status]}>{inv.status}</Badge>
              </Td>
              <Td className="text-right">
                {inv.status !== "paid" && (
                  <form action={markInvoicePaidAction} className="flex items-center justify-end gap-2">
                    <input type="hidden" name="invoice_id" value={inv.invoice_id} />
                    <Input type="password" name="password" placeholder="Password" required className="w-28" />
                    <Button type="submit" variant="secondary">
                      Mark paid
                    </Button>
                  </form>
                )}
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}
