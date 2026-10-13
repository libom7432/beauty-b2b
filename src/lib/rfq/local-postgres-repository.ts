import { Pool, type PoolClient } from "pg";
import { type LocalTestConnection } from "./local-connection";
import { PostgreSQLRFQRepository } from "./postgres-repository";

type ServerIdentity = {
  role: string;
  database: string;
  address: string;
  port: number;
  version: string;
  superuser: boolean;
  bypassrls: boolean;
};

// A loopback URL may point at a local forwarder. Verify the connected backend
// before permitting the Repository to BEGIN or write anything.
export function verifiedLocalPool(pool: Pick<Pool, "connect">) {
  return {
    async connect(): Promise<PoolClient> {
      const client = await pool.connect();
      try {
        const result = await client.query<ServerIdentity>(`SELECT current_user AS role,
          current_database() AS database, host(inet_server_addr()) AS address,
          inet_server_port() AS port, current_setting('server_version') AS version,
          r.rolsuper AS superuser, r.rolbypassrls AS bypassrls
          FROM pg_roles r WHERE r.rolname = current_user`);
        const identity = result.rows[0];
        if (!identity || identity.role !== "rfq_api" ||
            identity.database !== "rfq_integration_test" ||
            identity.address !== "127.0.0.1" || identity.port !== 5432 ||
            identity.version !== "17.11 (Postgres.app)" ||
            identity.superuser || identity.bypassrls)
          throw new Error("LOCAL_DATABASE_IDENTITY_REJECTED");
        return client;
      } catch {
        client.release(true);
        throw new Error("LOCAL_DATABASE_IDENTITY_REJECTED");
      }
    },
  };
}

let localPool: Pool | undefined;
let localConfig: LocalTestConnection | undefined;

export function getLocalPostgreSQLRFQRepository(config: LocalTestConnection): PostgreSQLRFQRepository {
  if (!localPool) {
    localPool = new Pool(config);
    localPool.on("error", () => {});
    localConfig = config;
  } else if (localConfig?.host !== config.host || localConfig.port !== config.port ||
             localConfig.database !== config.database || localConfig.user !== config.user ||
             localConfig.password !== config.password) {
    // Restart the local server to intentionally change its connection target.
    throw new Error("LOCAL_DATABASE_CONFIGURATION_CHANGED");
  }
  return new PostgreSQLRFQRepository(verifiedLocalPool(localPool));
}
