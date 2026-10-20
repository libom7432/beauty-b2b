import { CatalogReadError } from "./errors.ts";

export type SupabaseCatalogMode = "direct" | "session" | "transaction";
export type SupabaseCatalogConfig = Readonly<{
  projectRef: string; mode: SupabaseCatalogMode; host: string; port: number;
  database: string; user: string; password: string; ca: string; poolMax: number;
}>;

type Environment = Readonly<Record<string, string | undefined>>;
const REF = /^[a-z0-9]{20}$/;
const POOLER_HOST = /^aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com$/;
const ROLE = "catalog_admin_reader_runtime";
const invalid = (): never => { throw new CatalogReadError("NOT_CONFIGURED"); };

/** Pure validation. No URL or libpq options can override the checked target. */
export function requireSupabaseCatalogConfig(env: Environment): SupabaseCatalogConfig {
  const projectRef = env.CATALOG_READ_SUPABASE_PROJECT_REF ?? "";
  const mode = env.CATALOG_READ_SUPABASE_MODE;
  const host = env.CATALOG_READ_SUPABASE_HOST ?? "";
  const port = Number(env.CATALOG_READ_SUPABASE_PORT);
  const database = env.CATALOG_READ_SUPABASE_DATABASE ?? "";
  const user = env.CATALOG_READ_SUPABASE_USER ?? "";
  const password = env.CATALOG_READ_SUPABASE_PASSWORD ?? "";
  const ca = env.CATALOG_READ_SUPABASE_CA_PEM ?? "";
  if (!REF.test(projectRef) || !["direct", "session", "transaction"].includes(mode ?? "") ||
    !Number.isSafeInteger(port) || database !== "postgres" ||
    password.length < 32 || password.length > 512 || /[\r\n\0]/.test(password) ||
    !ca.includes("-----BEGIN CERTIFICATE-----") || !ca.includes("-----END CERTIFICATE-----") ||
    ca.length > 32_768) return invalid();
  if (mode === "direct") {
    if (host !== `db.${projectRef}.supabase.co` || port !== 5432 || user !== ROLE) return invalid();
  } else {
    if (!POOLER_HOST.test(host) || port !== (mode === "session" ? 5432 : 6543) ||
      user !== `${ROLE}.${projectRef}`) return invalid();
  }
  // The deployment selects the mode. The connector never derives one from a request.
  return { projectRef, mode: mode as SupabaseCatalogMode, host, port, database, user,
    password, ca, poolMax: mode === "transaction" ? 1 : 2 };
}
