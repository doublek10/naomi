import { db } from "@/lib/db-bridge";
import { formatKES } from "@/lib/utils";
import { Table, Thead, Th, Td, EmptyRow } from "@/components/ui/table";
import { Input, Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, StatCard } from "@/components/ui/card";
import { createExpenseAction, deleteExpenseAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function ExpensesPage() {
  const expenses = await db.expenses.list();
  const total = expenses.reduce((sum, e) => sum + Number(e.amount), 0);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-2xl text-ink">Expenses</h1>
        <p className="mt-1 text-sm text-slate">Running costs for the property — repairs, supplies, staff, etc.</p>
      </div>

      <StatCard label="Total logged" value={formatKES(total)} />

      <Card className="max-w-md">
        <h2 className="text-sm font-medium text-ink">Log an expense</h2>
        <form action={createExpenseAction} className="mt-4 space-y-4">
          <div>
            <Label htmlFor="expense_name">What was it for?</Label>
            <Input id="expense_name" name="expense_name" required />
          </div>
          <div>
            <Label htmlFor="amount">Amount (KES)</Label>
            <Input id="amount" name="amount" type="number" step="0.01" min="0" required />
          </div>
          <div>
            <Label htmlFor="expense_date">Date</Label>
            <Input id="expense_date" name="expense_date" type="date" defaultValue={new Date().toISOString().slice(0, 10)} required />
          </div>
          <Button type="submit">Log expense</Button>
        </form>
      </Card>

      <Table>
        <Thead>
          <tr>
            <Th>Date</Th>
            <Th>Description</Th>
            <Th>Amount</Th>
            <Th className="text-right">Actions</Th>
          </tr>
        </Thead>
        <tbody>
          {expenses.length === 0 && <EmptyRow colSpan={4}>No expenses logged yet.</EmptyRow>}
          {expenses.map((e) => (
            <tr key={e.expense_id}>
              <Td className="text-slate">{e.expense_date}</Td>
              <Td>{e.expense_name}</Td>
              <Td>{formatKES(e.amount)}</Td>
              <Td className="text-right">
                <form action={deleteExpenseAction}>
                  <input type="hidden" name="expense_id" value={e.expense_id} />
                  <Button type="submit" variant="danger">
                    Delete
                  </Button>
                </form>
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}
