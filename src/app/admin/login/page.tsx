import { redirect } from "next/navigation";
import { createAdminAuthClient } from "@/lib/admin/supabase-server";
import { adminDependencies } from "@/lib/admin/server-access";
import { checkAdminAccess } from "@/lib/admin/access";
import { loginAction } from "../actions";

export const dynamic = "force-dynamic";
export default async function AdminLogin({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const client = await createAdminAuthClient();
  if (client && await checkAdminAccess(client, adminDependencies(client)) === "allowed") redirect("/admin");
  const error = (await searchParams).error;
  return <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-6">
    <h1 className="text-3xl font-semibold">Admin login</h1>
    <p>Authorized staff only.</p>
    {error === "1" && <p role="alert">Unable to sign in. Close this browser session if the problem continues, or contact an administrator.</p>}
    <form action={loginAction} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1">Email<input className="rounded border p-2" type="email" name="email" autoComplete="username" required maxLength={254} /></label>
      <label className="flex flex-col gap-1">Password<input className="rounded border p-2" type="password" name="password" autoComplete="current-password" required /></label>
      <button className="rounded bg-black p-3 text-white" type="submit">Sign in</button>
    </form>
  </main>;
}
