import "server-only";
import { getAdminUISession } from "../admin/ui-identity.ts";
import { createRFQStatusService, RFQStatusError } from "./inbox-status.ts";

/** The status writer is deliberately absent until a separately approved migration and role exist. */
export function serverRFQStatusService() {
  return createRFQStatusService(null, async () => {
    const { admin } = await getAdminUISession();
    if (!admin.permissions.includes("rfq.manage")) throw new RFQStatusError("FORBIDDEN");
    return admin.admin_id;
  });
}
