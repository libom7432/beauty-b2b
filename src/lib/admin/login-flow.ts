import { checkAdminAccess, type AdminAccess } from "./access.ts";
import type { CatalogAuthDependencies } from "../catalog-import/admin-auth.ts";

export type PasswordAuth = {
  signIn(email: string, password: string): Promise<boolean>;
  signOut(): Promise<boolean>;
  hasSession(): Promise<boolean>;
};
type SupabasePasswordClient = { auth: {
  signInWithPassword(credentials: { email: string; password: string }): Promise<{ error: unknown }>;
  signOut(options: { scope: "local" }): Promise<{ error: unknown }>;
  getSession(): Promise<{ data: { session: unknown | null }; error: unknown }>;
} };

/** The adapter is server-only in use; getSession checks removal, never grants access. */
export function supabasePasswordAuth(client: SupabasePasswordClient): PasswordAuth {
  return {
    async signIn(email, password) {
      const { error } = await client.auth.signInWithPassword({ email, password });
      return !error;
    },
    async signOut() {
      const { error } = await client.auth.signOut({ scope: "local" });
      return !error;
    },
    async hasSession() {
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      return data.session !== null;
    },
  };
}
export type LoginResult = "allowed" | "invalid" | "rate_limited" | "cleanup_failed";
export type LogoutResult = "signed_out" | "failed";

/** A successful provider call alone is insufficient: verify local session removal. */
export async function logoutAdmin(auth: Pick<PasswordAuth, "signOut" | "hasSession">): Promise<LogoutResult> {
  try {
    if (!await auth.signOut()) return "failed";
    return await auth.hasSession() ? "failed" : "signed_out";
  } catch { return "failed"; }
}
export async function loginAdmin(email: string, password: string, auth: PasswordAuth,
  session: unknown, dependencies: CatalogAuthDependencies, allowAttempt: () => Promise<boolean>): Promise<LoginResult> {
  if (!await allowAttempt()) return "rate_limited";
  if (!email || email.length > 254 || !password || password.length > 1024) return "invalid";
  try {
    if (!await auth.signIn(email, password)) return "invalid";
    const result: AdminAccess = await checkAdminAccess(session, dependencies);
    if (result === "allowed") return "allowed";
  } catch { /* Keep credentials and directory failures indistinguishable. */ }
  return await logoutAdmin(auth) === "signed_out" ? "invalid" : "cleanup_failed";
}
