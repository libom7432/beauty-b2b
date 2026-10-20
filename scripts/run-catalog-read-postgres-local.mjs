import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { homedir, userInfo } from "node:os";
import { join } from "node:path";
import pg from "pg";

/** Isolated test launcher: credentials remain under the dedicated cluster directory. */
const root = join(homedir(), "Library/Application Support/BeautyB2B/pg17-b4-test");
assert.notEqual(process.env.NODE_ENV, "production");
assert.equal((await readFile(join(root, "data/PG_VERSION"), "utf8")).trim(), "17");
const owner = new pg.Client({ host: join(root, "socket"), port: 55432,
  user: userInfo().username, database: "beauty_b2b_catalog_test", connectionTimeoutMillis: 2_000 });
await owner.connect();
try {
  const target = (await owner.query(`SELECT current_database() AS db,
    current_setting('data_directory') AS data, current_setting('port') AS port,
    current_setting('listen_addresses') AS listen`)).rows[0];
  assert.deepEqual(target, { db: "beauty_b2b_catalog_test", data: join(root, "data"),
    port: "55432", listen: "127.0.0.1" });
} finally { await owner.end(); }
const url = new URL("postgres://catalog_read_local@127.0.0.1:55432/beauty_b2b_catalog_test");
url.password = (await readFile(join(root, "reader.password"), "utf8")).trim();
process.env.NODE_ENV = "test";
process.env.RUN_LOCAL_CATALOG_READ_TESTS = "1";
process.env.CATALOG_READ_LOCAL_DATABASE_URL = url.toString();
process.env.CATALOG_READ_LOCAL_DENIED_PASSWORD =
  (await readFile(join(root, "denied.password"), "utf8")).trim();
await import("./test-catalog-read-postgres-local.mjs");
