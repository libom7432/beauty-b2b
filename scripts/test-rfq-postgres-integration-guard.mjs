import assert from "node:assert/strict";
import { localTestConnection } from "./test-rfq-postgres-integration.mjs";

const valid = "postgresql://rfq_api:fake@127.0.0.1:5432/rfq_integration_test";
assert.deepEqual(
  (({ host, port, database, user }) => ({ host, port, database, user }))(localTestConnection(valid, "rfq_api")),
  { host: "127.0.0.1", port: 5432, database: "rfq_integration_test", user: "rfq_api" },
);
assert.equal(localTestConnection("postgres://rfq_api:fake@localhost/rfq_integration_test", "rfq_api").host,
  "127.0.0.1");
assert.equal(localTestConnection("postgres://rfq_api:fake@[::1]/rfq_integration_test", "rfq_api").host,
  "::1");

for (const url of [
  undefined,
  "postgres://rfq_api:fake@db.example.com/rfq_integration_test",
  "postgres://rfq_api:fake@aws-0-region.pooler.supabase.com/rfq_integration_test",
  "postgres://postgres:fake@localhost/rfq_integration_test",
  "postgres://rfq_api:fake@localhost/postgres",
  "postgres://rfq_api:fake@localhost/production",
  "postgres://rfq_api:fake@localhost/template0",
  "postgres://rfq_api:fake@localhost/template1",
  "postgres://rfq_api:fake@localhost/rfq_integration_test?sslmode=disable",
  "postgres://rfq_api@localhost/rfq_integration_test",
  "file://rfq_api:fake@localhost/rfq_integration_test",
]) {
  assert.throws(() => localTestConnection(url, "rfq_api"), /TEST_CONFIGURATION_REJECTED/);
}
assert.throws(() => localTestConnection(valid, "rfq_test_auditor"), /TEST_CONFIGURATION_REJECTED/);
console.log("RFQ PostgreSQL integration safety checks: passed; no database connection");
