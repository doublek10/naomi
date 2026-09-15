import { getServerSession, type NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { db } from "./db-bridge";

const BCRYPT_PREFIX_RE = /^\$2[aby]\$/;

function isBcryptHash(hash: string): boolean {
  return BCRYPT_PREFIX_RE.test(hash);
}

function md5(input: string): string {
  return crypto.createHash("md5").update(input).digest("hex");
}

/**
 * Your existing master_contral passwords are MD5 hashes. Rather than force
 * every admin to reset their password on day one, this verifies against the
 * old MD5 hash when that's what's stored, then silently rewrites that row
 * to a bcrypt hash on a successful login — each account upgrades itself the
 * next time its owner signs in, with zero downtime and zero manual SQL.
 */
async function verifyAndMaybeUpgrade(
  userId: number,
  plainPassword: string,
  storedHash: string
): Promise<boolean> {
  if (isBcryptHash(storedHash)) {
    return bcrypt.compare(plainPassword, storedHash);
  }

  // Legacy path: stored hash is (presumably) MD5.
  const matches = md5(plainPassword) === storedHash;
  if (!matches) return false;

  try {
    const newHash = await bcrypt.hash(plainPassword, 10);
    await db.users.update({ id: userId, password_hash: newHash });
  } catch (err) {
    // Upgrade failing shouldn't block this login — it'll just try again
    // next time. Log loudly so it's visible if it keeps happening.
    console.error("Failed to upgrade legacy MD5 password hash", { userId, err });
  }
  return true;
}

export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        username: { label: "Username", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.username || !credentials?.password) return null;

        const user = await db.users.getByUsername(credentials.username);
        if (!user) return null;

        const valid = await verifyAndMaybeUpgrade(user.id, credentials.password, user.password);
        if (!valid) return null;

        return { id: String(user.id), name: user.username };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.name = user.name;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as { id?: string }).id = token.id as string;
        session.user.name = token.name as string;
      }
      return session;
    },
  },
};

export async function getSession() {
  return getServerSession(authOptions);
}

export async function requireSession() {
  const session = await getSession();
  if (!session?.user?.name) {
    throw new Error("Not authenticated");
  }
  return session;
}

/**
 * Re-checks the given password against the CURRENTLY logged-in admin's
 * stored hash. Used to gate destructive/financial overrides (invoice
 * bypass, bulk mark-paid, deleting a user) even though the admin is
 * already logged in.
 */
export async function verifyCurrentUserPassword(password: string): Promise<boolean> {
  const session = await requireSession();
  const username = session.user!.name as string;
  const user = await db.users.getByUsername(username);
  if (!user) return false;
  return isBcryptHash(user.password)
    ? bcrypt.compare(password, user.password)
    : md5(password) === user.password;
}
