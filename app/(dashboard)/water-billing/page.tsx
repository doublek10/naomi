import { db } from "@/lib/db-bridge";
import { monthStart } from "@/lib/invoice-service";
import { formatKES, formatMonthLabel } from "@/lib/utils";
import { Table, Thead, Th, Td, EmptyRow } from "@/components/ui/table";
import { Input, Label, Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { createAreaReadingAction, setAreaRateAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function WaterBillingPage({
  searchParams,
}: {
  searchParams: { month?: string };
}) {
  const month = searchParams.month ? `${searchParams.month}-01` : monthStart();
  const monthInputValue = month.slice(0, 7);

  const [rooms, currentRate, readings] = await Promise.all([
    db.rooms.list(),
    db.water.currentRate(),
    db.water.readingsForMonth(month),
  ]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-2xl text-ink">Water billing</h1>
        <p className="mt-1 text-sm text-slate">
          Enter a meter reading to bill a room for water, based on the current cost per unit.
        </p>
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        <Card>
          <h2 className="text-sm font-medium text-ink">Cost per unit</h2>
          <p className="mt-1 text-2xl font-display">
            {currentRate ? formatKES(currentRate.cost_per_unit) : "Not set"}
          </p>
          <p className="mt-1 text-xs text-slate">
            There&apos;s a single current rate, not a dated history — updating it applies
            immediately to any new readings you enter (existing readings already saved keep the
            amount they were billed at).
          </p>
          {!currentRate && (
            <p className="mt-1 text-xs text-rust">
              Set a rate below before entering any readings.
            </p>
          )}

          <form action={setAreaRateAction} className="mt-4 space-y-3">
            <div>
              <Label htmlFor="cost_per_unit">New cost per unit (KES)</Label>
              <Input id="cost_per_unit" name="cost_per_unit" type="number" step="0.01" min="0" required />
            </div>
            <Button type="submit" variant="secondary">
              Update rate
            </Button>
          </form>
        </Card>

        <Card>
          <h2 className="text-sm font-medium text-ink">Enter a meter reading</h2>
          <form action={createAreaReadingAction} className="mt-4 space-y-3">
            <div>
              <Label htmlFor="room_id">Room</Label>
              <Select id="room_id" name="room_id" required>
                {rooms.map((r) => (
                  <option key={r.room_id} value={r.room_id}>
                    {r.room_number}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="month">Billing month</Label>
              <Input id="month" name="month" type="month" defaultValue={monthInputValue} required />
            </div>
            <div>
              <Label htmlFor="units_used">Units used</Label>
              <Input id="units_used" name="units_used" type="number" step="0.01" min="0" required />
            </div>
            <Button type="submit">Save reading</Button>
          </form>
        </Card>
      </div>

      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-lg text-ink">Readings — {formatMonthLabel(month)}</h2>
          <form method="get" className="flex items-center gap-2">
            <Input type="month" name="month" defaultValue={monthInputValue} className="w-40" />
            <Button type="submit" variant="secondary">
              View
            </Button>
          </form>
        </div>

        <Table>
          <Thead>
            <tr>
              <Th>Room</Th>
              <Th>Units used</Th>
              <Th>Amount due</Th>
              <Th>Amount paid</Th>
            </tr>
          </Thead>
          <tbody>
            {readings.length === 0 && <EmptyRow colSpan={4}>No readings entered for this month yet.</EmptyRow>}
            {readings.map((reading) => (
              <tr key={reading.area_id}>
                <Td>{reading.room_number}</Td>
                <Td>{reading.units_used}</Td>
                <Td>{formatKES(reading.amount_due ?? 0)}</Td>
                <Td>{formatKES(reading.amount_paid ?? 0)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </div>
    </div>
  );
}
