import "server-only";
import { redirect } from "next/navigation";
import { getAdminUISession, readAdminUISession } from "../admin/ui-identity.ts";
import { createRFQInboxRepository, RFQInboxError } from "./inbox.ts";

/** No production RFQ reader or database grant exists yet. Never substitute fixture data. */
export async function serverRFQInboxRepository() {
  const { admin } = await getAdminUISession();
  if (!admin.permissions.includes("rfq.read")) redirect("/admin?rfq=forbidden");
  return createRFQInboxRepository(null, async () => {
    const session = await readAdminUISession();
    if (!session?.admin.permissions.includes("rfq.read")) throw new RFQInboxError("FORBIDDEN");
  });
}
