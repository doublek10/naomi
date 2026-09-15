import { db } from "@/lib/db-bridge";
import { Table, Thead, Th, Td, EmptyRow } from "@/components/ui/table";
import { Input, Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { createUserAction, deleteUserAction, updateUserAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function UsersSettingsPage() {
  const users = await db.users.list();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-2xl text-ink">Admin users</h1>
        <p className="mt-1 text-sm text-slate">
          Every admin can do everything — there are no roles. At least one admin must always
          exist, so the last remaining account can&apos;t be deleted. Passwords upgrade
          themselves from the old MD5 format to bcrypt automatically the next time each admin
          logs in — nothing to do here for that.
        </p>
      </div>

      <Card className="max-w-md">
        <h2 className="text-sm font-medium text-ink">Add an admin</h2>
        <form action={createUserAction} className="mt-4 space-y-4">
          <div>
            <Label htmlFor="username">Username</Label>
            <Input id="username" name="username" required minLength={3} />
          </div>
          <div>
            <Label htmlFor="password">Password</Label>
            <Input id="password" name="password" type="password" required minLength={8} />
          </div>
          <Button type="submit">Add admin</Button>
        </form>
      </Card>

      <Table>
        <Thead>
          <tr>
            <Th>Username</Th>
            <Th>New password</Th>
            <Th className="text-right">Actions</Th>
          </tr>
        </Thead>
        <tbody>
          {users.length === 0 && <EmptyRow colSpan={3}>No admin users yet.</EmptyRow>}
          {users.map((user) => (
            <tr key={user.id}>
              <Td>
                <form action={updateUserAction} id={`user-${user.id}`} className="flex items-center gap-2">
                  <input type="hidden" name="id" value={user.id} />
                  <Input name="username" defaultValue={user.username} className="w-40" />
                </form>
              </Td>
              <Td>
                <Input
                  name="password"
                  type="password"
                  placeholder="Leave blank to keep current"
                  form={`user-${user.id}`}
                  className="w-48"
                />
              </Td>
              <Td className="text-right">
                <div className="flex items-center justify-end gap-2">
                  <Button type="submit" form={`user-${user.id}`} variant="secondary">
                    Save
                  </Button>
                  <form action={deleteUserAction}>
                    <input type="hidden" name="id" value={user.id} />
                    <Button type="submit" variant="danger">
                      Delete
                    </Button>
                  </form>
                </div>
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}
