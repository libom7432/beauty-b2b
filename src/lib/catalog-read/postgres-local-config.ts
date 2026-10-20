import { CatalogReadError } from "./errors.ts";

/** Accept only the dedicated test cluster's canonical TCP URL. Never accept libpq URL overrides. */
export function requireLocalCatalogReadUrl(value: string | undefined, nodeEnv: string | undefined): string {
  if (nodeEnv !== "test" || !value ||
    !/^postgres(?:ql)?:\/\/catalog_read_local:[A-Za-z0-9_-]{43}@127\.0\.0\.1:55432\/beauty_b2b_catalog_test$/.test(value))
    throw new CatalogReadError("NOT_CONFIGURED");
  let url: URL;
  try { url = new URL(value); }
  catch { throw new CatalogReadError("NOT_CONFIGURED"); }
  if (!["postgres:", "postgresql:"].includes(url.protocol) ||
    url.hostname !== "127.0.0.1" || url.port !== "55432" ||
    url.username !== "catalog_read_local" || url.password.length !== 43 ||
    url.pathname !== "/beauty_b2b_catalog_test" || url.search || url.hash)
    throw new CatalogReadError("NOT_CONFIGURED");
  return value;
}
