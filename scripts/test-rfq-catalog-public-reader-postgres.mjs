import assert from "node:assert/strict";
import fs from "node:fs";
import { Pool } from "pg";

const role = "rfq_catalog_public_reader_runtime";
const published = "11111111-1111-4111-8111-111111111111";
const draft = "33333333-3333-4333-8333-333333333333";

if (process.env.RFQ_READER_TEST_RUN !== "1") {
  console.log("RFQ reader role PostgreSQL test: disabled; no database operations");
} else {
  const url = new URL(process.env.RFQ_READER_TEST_DATABASE_URL ?? "");
  const expectedData = process.env.RFQ_READER_TEST_EXPECTED_PGDATA ?? "";
  if (url.protocol !== "postgresql:" || url.hostname !== "127.0.0.1" ||
    url.pathname !== "/rfq_integration_test" || !/^[1-9][0-9]{3,4}$/.test(url.port) ||
    url.username === role || !expectedData || !fs.statSync(expectedData).isDirectory())
    throw new Error("ISOLATED_LOCAL_DATABASE_REQUIRED");

  const pool = new Pool({ connectionString: url.href, ssl: false, max: 1 });
  pool.on("error", () => {});
  const client = await pool.connect();
  let passed = 0;
  async function asReader(sql) {
    await client.query("BEGIN");
    try {
      await client.query(`SET LOCAL ROLE ${role}`);
      return await client.query(sql);
    } finally { await client.query("ROLLBACK"); }
  }
  async function denied(sql) {
    await assert.rejects(() => asReader(sql), (error) => error?.code === "42501");
    passed++;
  }
  try {
    const identity = (await client.query(`SELECT current_database() AS db, current_setting('server_version') AS version,
      current_setting('data_directory') AS data, host(inet_server_addr()) AS host,
      inet_server_port() AS port`)).rows[0];
    assert.equal(identity.db, "rfq_integration_test");
    assert.match(identity.version, /^17\.11/);
    assert.equal(fs.realpathSync(identity.data), fs.realpathSync(expectedData));
    assert.equal(identity.host, "127.0.0.1");
    assert.equal(identity.port, Number(url.port));
    passed++;

    const attributes = (await client.query(`SELECT rolcanlogin,rolsuper,rolcreatedb,rolcreaterole,
      rolbypassrls,rolinherit,rolreplication FROM pg_roles WHERE rolname=$1`, [role])).rows[0];
    assert.deepEqual(attributes, { rolcanlogin: false, rolsuper: false, rolcreatedb: false,
      rolcreaterole: false, rolbypassrls: false, rolinherit: false, rolreplication: false });
    passed++;

    const grants = (await client.query(`SELECT
      has_database_privilege($1,current_database(),'CONNECT') AS connect,
      has_database_privilege($1,current_database(),'TEMPORARY') AS temp,
      has_database_privilege($1,current_database(),'CREATE') AS db_create,
      has_schema_privilege($1,'catalog_public','USAGE') AS public_usage,
      has_schema_privilege($1,'catalog_public','CREATE') AS public_create,
      has_schema_privilege($1,'catalog_private','USAGE') AS private_usage,
      has_schema_privilege($1,'rfq_private','USAGE') AS rfq_usage,
      has_column_privilege($1,'catalog_public.products','id','SELECT') AS product_id,
      has_column_privilege($1,'catalog_public.products','slug','SELECT') AS product_slug,
      has_column_privilege($1,'catalog_public.product_variants','moq_quantity','SELECT') AS moq,
      has_column_privilege($1,'catalog_public.product_translations','name','SELECT') AS translation_name,
      has_column_privilege($1,'catalog_public.products','product_code','SELECT') AS product_code`, [role])).rows[0];
    assert.deepEqual(grants, { connect: true, temp: true, db_create: false,
      public_usage: true, public_create: false, private_usage: false, rfq_usage: false,
      product_id: true, product_slug: true, moq: true, translation_name: true, product_code: false });
    passed++;

    for (const sql of [
      `SELECT id,slug FROM catalog_public.products WHERE id='${published}'`,
      `SELECT id,product_id,sku,attributes,moq_quantity,moq_unit FROM catalog_public.product_variants WHERE product_id='${published}'`,
      `SELECT product_id,locale,name FROM catalog_public.product_translations WHERE product_id='${published}'`,
    ]) assert.equal((await asReader(sql)).rows.length > 0, true);
    assert.equal((await asReader(`SELECT id FROM catalog_public.products WHERE id='${draft}'`)).rows.length, 0);
    passed++;

    await denied("SELECT product_code FROM catalog_public.products LIMIT 0");
    await denied("SELECT * FROM catalog_private.products LIMIT 0");
    await denied("SELECT * FROM rfq_private.rfq_requests LIMIT 0");
    await denied("INSERT INTO catalog_private.products (product_code,slug,product_type) VALUES ('forbidden','forbidden','forbidden')");
    await denied("CREATE TABLE catalog_public.rfq_reader_forbidden (id integer)");
    await denied("CREATE ROLE rfq_reader_forbidden");

    console.log(`RFQ public runtime reader: ${passed} checks passed; NOLOGIN; PUBLIC TEMP=true`);
  } finally {
    client.release();
    await pool.end();
  }
}
