import "server-only";
import { Pool } from "pg";
import { createRFQHandler, type RFQRepository } from "./api";
import { requireRFQPublicCatalogConfig, type RFQPublicCatalogConfig } from "./catalog-public-postgres";
import { createServerRFQPublicCatalogReader } from "./catalog-public-server";
import { PostgreSQLRFQRepository, rfqPoolConfiguration } from "./postgres-repository";
import type { RFQPublicCatalogLookup } from "./types";

export type RFQProductionEvent = "origin_denied" | "rate_denied" | "spam_denied" | "preflight_pass";
export type RFQProductionControls = Readonly<{
  /** Must be backed by a shared, cross-instance service. No local allow-all implementation. */
  sharedRateLimit: (request: Request) => Promise<boolean>;
  /** A separate submission abuse control. It may inspect a clone of the request. */
  antiSpam: (request: Request) => Promise<boolean>;
  /** Fixed event names only; never attach contact fields, body or raw errors. */
  audit: (event: RFQProductionEvent) => Promise<void>;
}>;
export type RFQProductionRouteOptions = Readonly<{
  /** Defaults off. This module is deliberately not imported by the App Router POST. */
  enabled?: boolean;
  publicOrigin?: string;
  catalogEnvironment?: Readonly<Record<string, string | undefined>>;
  writerDatabaseUrl?: string;
  controls?: RFQProductionControls;
}>;

const projectRefPattern = /^[a-z0-9]{20}$/;
const poolerHostPattern = /^aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com$/;

/** Derive identity from the actual writer connection target, never a second claim. */
export function writerTargetProjectRef(config: ReturnType<typeof rfqPoolConfiguration>): string | null {
  const direct = /^db\.([a-z0-9]{20})\.supabase\.co$/.exec(config.host);
  if (direct && config.user === "rfq_api" && config.port === 5432 && config.database === "postgres")
    return direct[1];
  const poolerUser = /^rfq_api\.([a-z0-9]{20})$/.exec(config.user);
  if (poolerHostPattern.test(config.host) && poolerUser && projectRefPattern.test(poolerUser[1]) &&
    (config.port === 5432 || config.port === 6543) && config.database === "postgres")
    return poolerUser[1];
  return null;
}

function unavailable(): Response {
  return Response.json({ error: "RFQ_UNAVAILABLE" }, {
    status: 503, headers: { "Cache-Control": "no-store" },
  });
}

function deploymentOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !url.hostname || url.username || url.password ||
      url.pathname !== "/" || url.search || url.hash || url.origin !== value) return null;
    return url.origin;
  } catch { return null; }
}

function sameOrigin(request: Request, expected: string): boolean {
  try {
    const origin = request.headers.get("origin");
    if (!origin || origin !== expected || origin === "null") return false;
    const url = new URL(request.url);
    return url.origin === expected && url.protocol === "https:";
  } catch { return false; }
}

function bounded<T>(work: () => Promise<T>, milliseconds = 3_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("RFQ_DEPENDENCY_TIMEOUT")), milliseconds);
    Promise.resolve().then(work).then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

/** Composition contract only. No real adapters are imported or initialized here. */
export function createProductionRFQRoute(options: RFQProductionRouteOptions = {}) {
  let boundConfig: string | undefined;
  let catalogReader: RFQPublicCatalogLookup | undefined;
  let writerRepository: RFQRepository | undefined;
  return async (request: Request): Promise<Response> => {
    if (options.enabled !== true) return unavailable();
    const origin = deploymentOrigin(options.publicOrigin);
    const controls = options.controls;
    if (!origin || !controls ||
      typeof controls.sharedRateLimit !== "function" || typeof controls.antiSpam !== "function" ||
      typeof controls.audit !== "function") return unavailable();
    let catalogConfig: RFQPublicCatalogConfig;
    let writerConfig: ReturnType<typeof rfqPoolConfiguration>;
    try {
      catalogConfig = requireRFQPublicCatalogConfig(options.catalogEnvironment ?? {});
      writerConfig = rfqPoolConfiguration(options.writerDatabaseUrl);
      if (writerTargetProjectRef(writerConfig) !== catalogConfig.projectRef) return unavailable();
    } catch { return unavailable(); }
    const identity = JSON.stringify([catalogConfig, writerConfig]);
    if (boundConfig && boundConfig !== identity) return unavailable();
    boundConfig = identity;

    // Factories remain lazy: historical replays need no current Catalog query,
    // and failed preflight or malformed input never creates a database client.
    const catalog: RFQPublicCatalogLookup = {
      getPublishedProductsByIds: (ids) => {
        catalogReader ??= createServerRFQPublicCatalogReader(catalogConfig);
        return catalogReader.getPublishedProductsByIds(ids);
      },
    };
    const repository: RFQRepository = {
      transaction: (work) => {
        if (!writerRepository) {
          const pool = new Pool(writerConfig);
          pool.on("error", () => { /* Never expose driver details. */ });
          writerRepository = new PostgreSQLRFQRepository(pool);
        }
        return writerRepository.transaction(work);
      },
    };
    return createRFQHandler({ catalog: [], trustedCatalog: catalog, catalogVerified: true,
      repository, guards: {
        trustedOrigin: async (incoming) => {
          if (sameOrigin(incoming, origin)) return true;
          await bounded(() => controls.audit("origin_denied"));
          return false;
        },
        allowRequest: async (incoming) => {
          if (await bounded(() => controls.sharedRateLimit(incoming)) !== true) {
            await bounded(() => controls.audit("rate_denied"));
            return false;
          }
          if (await bounded(() => controls.antiSpam(incoming.clone())) !== true) {
            await bounded(() => controls.audit("spam_denied"));
            return false;
          }
          await bounded(() => controls.audit("preflight_pass"));
          return true;
        },
      } })(request);
  };
}
