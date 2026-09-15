import { LoginForm } from "@/components/login-form";

// Rendered on demand rather than prerendered at build time. The login form
// pulls in next-auth's client, which builds a URL from NEXTAUTH_URL — if
// that env var isn't present (or isn't a full absolute URL) in the build
// environment, prerendering this page fails with "TypeError: Invalid URL".
// There's nothing to gain from statically generating a login form anyway.
export const dynamic = "force-dynamic";

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-4">
      <LoginForm />
    </div>
  );
}
