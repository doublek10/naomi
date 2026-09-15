import { db } from "@/lib/db-bridge";
import { Table, Thead, Th, Td, EmptyRow } from "@/components/ui/table";
import { Input, Label, Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { createTenantAction, deleteTenantAction, updateTenantAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function TenantsPage() {
  const [tenants, rooms] = await Promise.all([db.tenants.list(), db.rooms.list()]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-2xl text-ink">Tenants</h1>
        <p className="mt-1 text-sm text-slate">
          {tenants.length} tenant{tenants.length === 1 ? "" : "s"} on record, sorted by room. Every
          tenant must be assigned to a room.
        </p>
      </div>

      <Card className="max-w-md">
        <h2 className="text-sm font-medium text-ink">Add a tenant</h2>
        <form action={createTenantAction} className="mt-4 space-y-4">
          <div>
            <Label htmlFor="tenant_name">Full name</Label>
            <Input id="tenant_name" name="tenant_name" required />
          </div>
          <div>
            <Label htmlFor="phone_number">Phone number</Label>
            <Input id="phone_number" name="phone_number" placeholder="07XXXXXXXX" />
          </div>
          <div>
            <Label htmlFor="id_number">ID number</Label>
            <Input id="id_number" name="id_number" />
          </div>
          <div>
            <Label htmlFor="room_id">Room</Label>
            <Select id="room_id" name="room_id" required>
              {rooms.map((r) => (
                <option key={r.room_id} value={r.room_id}>
                  {r.room_number} — {r.floor_number}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="admission_date">Move-in date</Label>
            <Input id="admission_date" name="admission_date" type="date" defaultValue={new Date().toISOString().slice(0, 10)} />
          </div>
          <Button type="submit">Add tenant</Button>
        </form>
      </Card>

      <Table>
        <Thead>
          <tr>
            <Th>Tenant</Th>
            <Th>Moved in</Th>
            <Th className="text-right">Actions</Th>
          </tr>
        </Thead>
        <tbody>
          {tenants.length === 0 && <EmptyRow colSpan={3}>No tenants yet — add one above.</EmptyRow>}
          {tenants.map((tenant) => (
            <tr key={tenant.tenant_id}>
              <Td>
                <form action={updateTenantAction} className="flex flex-wrap items-center gap-2">
                  <input type="hidden" name="tenant_id" value={tenant.tenant_id} />
                  <Input name="tenant_name" defaultValue={tenant.tenant_name} className="w-40" />
                  <Input name="phone_number" defaultValue={tenant.phone_number ?? ""} className="w-32" />
                  <Input name="id_number" defaultValue={tenant.ID_number ?? ""} className="w-28" />
                  <Select name="room_id" defaultValue={tenant.room_id} className="w-40">
                    {rooms.map((r) => (
                      <option key={r.room_id} value={r.room_id}>
                        {r.room_number}
                      </option>
                    ))}
                  </Select>
                  <Button type="submit" variant="secondary">
                    Save
                  </Button>
                </form>
              </Td>
              <Td className="text-slate">{tenant.admission_date ?? "—"}</Td>
              <Td className="text-right">
                <form action={deleteTenantAction}>
                  <input type="hidden" name="tenant_id" value={tenant.tenant_id} />
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
