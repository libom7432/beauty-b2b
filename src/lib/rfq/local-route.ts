import type { Product } from "@/lib/catalog/types";
import { createRFQHandler, type RFQRepository } from "./api";
import { localTestConnection, type LocalTestConnection } from "./local-connection";

type LocalEnvironment = {
  NODE_ENV?: string;
  RFQ_ENABLE_LOCAL_POSTGRES?: string;
  RFQ_LOCAL_DATABASE_URL?: string;
};

type LocalRouteOptions = {
  environment: () => LocalEnvironment;
  catalog: readonly Product[];
  repository: (connection: LocalTestConnection) => RFQRepository;
};

function unavailable(): Response {
  return Response.json({ error: "RFQ_UNAVAILABLE" }, {
    status: 503, headers: { "Cache-Control": "no-store" },
  });
}

function localOrigin(request: Request): boolean {
  // Next.js development requests can expose localhost in request.url even
  // when the server is bound to 127.0.0.1. Require the exact local HTTP
  // headers instead; never authorize from X-Forwarded-* values.
  return request.headers.get("host") === "127.0.0.1:3109" &&
    request.headers.get("origin") === "http://127.0.0.1:3109";
}

// Environment and catalog gates are evaluated per request. The repository
// factory is called only after origin and request validation reach a transaction.
export function createLocalRFQRoute(options: LocalRouteOptions) {
  return async (request: Request): Promise<Response> => {
    const env = options.environment();
    if (env.NODE_ENV === "production" || env.RFQ_ENABLE_LOCAL_POSTGRES !== "1")
      return unavailable();
    let connection: LocalTestConnection;
    try { connection = localTestConnection(env.RFQ_LOCAL_DATABASE_URL, "rfq_api", true); }
    catch { return unavailable(); }
    const repository: RFQRepository = {
      transaction: (work) => options.repository(connection).transaction(work),
    };
    return createRFQHandler({
      catalog: options.catalog,
      // Mock catalog is permitted only inside this explicit local test route.
      catalogVerified: true,
      repository,
      guards: { trustedOrigin: localOrigin, allowRequest: () => true },
    })(request);
  };
}
