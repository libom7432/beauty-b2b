import { products } from "@/lib/catalog/products";
import { createLocalRFQRoute } from "@/lib/rfq/local-route";
import { getLocalPostgreSQLRFQRepository } from "@/lib/rfq/local-postgres-repository";

export const runtime = "nodejs";

// Default and all production deployments remain closed. Mock products are
// usable only through the explicitly enabled local test configuration.
export const POST = createLocalRFQRoute({
  environment: () => process.env,
  catalog: products,
  repository: getLocalPostgreSQLRFQRepository,
});
