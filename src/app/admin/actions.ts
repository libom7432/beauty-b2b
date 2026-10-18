"use server";
import { redirect } from "next/navigation";
import { createAdminAuthClient } from "@/lib/admin/supabase-server";
import { adminDependencies } from "@/lib/admin/server-access";
import { allowLocalLoginAttempt } from "@/lib/admin/rate-limit";
import { loginAdmin, logoutAdmin, supabasePasswordAuth } from "@/lib/admin/login-flow";

export async function loginAction(form: FormData) {
  const email = typeof form.get("email") === "string" ? String(form.get("email")).trim() : "";
  const password = typeof form.get("password") === "string" ? String(form.get("password")) : "";
  const client = await createAdminAuthClient(true);
  if (!client) redirect("/admin/login?error=1");
  const result = await loginAdmin(email, password, supabasePasswordAuth(client), client,
    adminDependencies(client), () => Promise.resolve(allowLocalLoginAttempt(email)));
  // All denials use the same browser response; cleanup_failed stays distinct internally.
  redirect(result === "allowed" ? "/admin" : "/admin/login?error=1");
}

export async function logoutAction(_previousState: "failed" | null): Promise<"failed"> {
  void _previousState;
  try {
    const client = await createAdminAuthClient(true);
    if (!client || await logoutAdmin(supabasePasswordAuth(client)) !== "signed_out") return "failed";
  } catch { return "failed"; }
  redirect("/admin/login");
}
