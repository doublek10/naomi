import { db } from "@/lib/db-bridge";
import { Table, Thead, Th, Td, EmptyRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { formatKES } from "@/lib/utils";
import { upsertRentAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function RentPage() {
  const rooms = await db.rooms.list();
  const rentAmounts = await db.rent.list();
  const rentByRoom = new Map(rentAmounts.map((r) => [r.room_id, r.monthly_rent]));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-2xl text-ink">Rent</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate">
          Rent is set per room, not per tenant — if a tenant moves out, the rent stays with the
          room for whoever moves in next. If you need to preserve what a former tenant was
          actually charged, keep a note elsewhere; historical invoices already lock in the rent
          that applied at the time they were generated.
        </p>
      </div>

      <Table>
        <Thead>
          <tr>
            <Th>Room</Th>
            <Th>Floor</Th>
            <Th>Current rent</Th>
            <Th className="text-right">Update</Th>
          </tr>
        </Thead>
        <tbody>
          {rooms.length === 0 && <EmptyRow colSpan={4}>Add rooms first, then set rent here.</EmptyRow>}
          {rooms.map((room) => (
            <tr key={room.room_id}>
              <Td>{room.room_number}</Td>
              <Td className="text-slate">{room.floor_number}</Td>
              <Td>{rentByRoom.has(room.room_id) ? formatKES(rentByRoom.get(room.room_id)!) : "—"}</Td>
              <Td className="text-right">
                <form action={upsertRentAction} className="flex items-center justify-end gap-2">
                  <input type="hidden" name="room_id" value={room.room_id} />
                  <Input
                    name="monthly_rent"
                    type="number"
                    step="0.01"
                    min="0"
                    className="w-32"
                    defaultValue={rentByRoom.get(room.room_id) ?? ""}
                    placeholder="0.00"
                    required
                  />
                  <Button type="submit" variant="secondary">
                    Save
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
