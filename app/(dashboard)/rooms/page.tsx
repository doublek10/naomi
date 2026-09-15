import { db } from "@/lib/db-bridge";
import { Table, Thead, Th, Td, EmptyRow } from "@/components/ui/table";
import { Input, Label, Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { createRoomAction, deleteRoomAction, updateRoomAction } from "./actions";

export const dynamic = "force-dynamic";

const FLOORS = ["ground floor", "first floor", "second floor", "third floor", "fourth floor"];

export default async function RoomsPage() {
  const rooms = await db.rooms.list();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-2xl text-ink">Rooms</h1>
        <p className="mt-1 text-sm text-slate">{rooms.length} room{rooms.length === 1 ? "" : "s"} on record.</p>
      </div>

      <Card className="max-w-md">
        <h2 className="text-sm font-medium text-ink">Add a room</h2>
        <form action={createRoomAction} className="mt-4 space-y-4">
          <div>
            <Label htmlFor="room_number">Room number</Label>
            <Input id="room_number" name="room_number" placeholder="e.g. N3" required />
          </div>
          <div>
            <Label htmlFor="floor_number">Floor</Label>
            <Select id="floor_number" name="floor_number" defaultValue="ground floor" required>
              {FLOORS.map((f) => (
                <option key={f} value={f}>
                  {f[0].toUpperCase() + f.slice(1)}
                </option>
              ))}
            </Select>
          </div>
          <Button type="submit">Add room</Button>
        </form>
      </Card>

      <Table>
        <Thead>
          <tr>
            <Th>Room</Th>
            <Th className="text-right">Actions</Th>
          </tr>
        </Thead>
        <tbody>
          {rooms.length === 0 && <EmptyRow colSpan={2}>No rooms yet — add one above.</EmptyRow>}
          {rooms.map((room) => (
            <tr key={room.room_id}>
              <Td>
                <form action={updateRoomAction} className="flex flex-wrap items-center gap-2">
                  <input type="hidden" name="room_id" value={room.room_id} />
                  <Input name="room_number" defaultValue={room.room_number} className="w-28" />
                  <Select name="floor_number" defaultValue={room.floor_number} className="w-40">
                    {FLOORS.map((f) => (
                      <option key={f} value={f}>
                        {f[0].toUpperCase() + f.slice(1)}
                      </option>
                    ))}
                  </Select>
                  <Button type="submit" variant="secondary">
                    Save
                  </Button>
                </form>
              </Td>
              <Td className="text-right">
                <form action={deleteRoomAction}>
                  <input type="hidden" name="room_id" value={room.room_id} />
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
