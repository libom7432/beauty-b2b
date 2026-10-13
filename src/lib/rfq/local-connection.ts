// Shared by the local HTTP route and the dedicated PostgreSQL test runner.
// This configuration must never be used for a cloud or production connection.
export function localTestConnection(raw: string | undefined, expectedRole: string, exactEndpoint = false) {
  if (!raw) throw new Error("TEST_CONFIGURATION_REJECTED");
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    const loopback = host === "localhost" || host === "127.0.0.1" || host === "[::1]";
    const database = decodeURIComponent(url.pathname.slice(1));
    const user = decodeURIComponent(url.username);
    const port = url.port ? Number(url.port) : 5432;
    if (!loopback || !["postgres:", "postgresql:"].includes(url.protocol) ||
        database !== "rfq_integration_test" || user !== expectedRole || !url.password ||
        url.search || url.hash || !Number.isInteger(port) || port < 1 || port > 65535)
      throw new Error("TEST_CONFIGURATION_REJECTED");
    if (exactEndpoint && (expectedRole !== "rfq_api" || host !== "127.0.0.1" ||
        url.port !== "5432" || url.pathname !== "/rfq_integration_test" ||
        !/^postgres(?:ql)?:\/\/rfq_api:[^@/]+@127\.0\.0\.1:5432\/rfq_integration_test$/.test(raw)))
      throw new Error("TEST_CONFIGURATION_REJECTED");
    return {
      host: host === "[::1]" ? "::1" : "127.0.0.1",
      port, database, user, password: decodeURIComponent(url.password),
      ssl: false, max: 1, connectionTimeoutMillis: 3_000,
      query_timeout: 10_000, idleTimeoutMillis: 5_000,
      options: "", application_name: "rfq_local_integration_test",
    } as const;
  } catch { throw new Error("TEST_CONFIGURATION_REJECTED"); }
}

export type LocalTestConnection = ReturnType<typeof localTestConnection>;
