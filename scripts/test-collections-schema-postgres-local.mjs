import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { homedir, userInfo } from "node:os";
import { join } from "node:path";
import pg from "pg";

const root = join(homedir(), "Library/Application Support/BeautyB2B/pg17-b4-test");
const database = "beauty_b2b_catalog_test";
const enabled = process.env.RUN_LOCAL_COLLECTIONS_SCHEMA_TESTS === "1";
const concurrencyEnabled = process.env.RUN_LOCAL_COLLECTIONS_CONCURRENCY_TESTS === "1";
const draft = await readFile(new URL("../docs/sql/collections-schema-security.b5s2.draft.sql", import.meta.url), "utf8");
assert.match(draft, /^-- DRAFT \/ NOT APPROVED FOR MIGRATION/m);
const body = draft.replace(/^BEGIN;\s*/m, "").replace(/\s*COMMIT;\s*$/m, "");

test("B5-S2 draft on dedicated PostgreSQL 17; all changes roll back", { skip: !enabled }, async (t) => {
  assert.notEqual(process.env.NODE_ENV, "production");
  assert.equal((await readFile(join(root, "data/PG_VERSION"), "utf8")).trim(), "17");
  const client = new pg.Client({ host: join(root, "socket"), port: 55432,
    user: userInfo().username, database, connectionTimeoutMillis: 2_000 });
  await client.connect();
  let insideTransaction = false;
  const rollback = async () => {
    if (insideTransaction) { await client.query("ROLLBACK"); insideTransaction = false; }
  };
  const rejected = async (sql, code) => {
    await client.query("SAVEPOINT b5s2_reject");
    try { await assert.rejects(client.query(sql), (error) => error.code === code); }
    finally {
      await client.query("ROLLBACK TO SAVEPOINT b5s2_reject");
      await client.query("RELEASE SAVEPOINT b5s2_reject");
    }
  };
  const asRole = async (role, task) => {
    await client.query("SAVEPOINT b5s2_role");
    try {
      await client.query(`SET LOCAL ROLE ${role}`);
      await task();
    } finally {
      await client.query("ROLLBACK TO SAVEPOINT b5s2_role");
      await client.query("RELEASE SAVEPOINT b5s2_role");
    }
  };
  const scalar = async (sql, params = []) => (await client.query(sql, params)).rows[0];
  try {
    const target = await scalar(`SELECT current_database() AS db, current_user AS actor,
      current_setting('data_directory') AS data, current_setting('port') AS port,
      current_setting('listen_addresses') AS listen,
      current_setting('server_version_num')::integer AS version`);
    assert.deepEqual(target, { db: database, actor: userInfo().username,
      data: join(root, "data"), port: "55432", listen: "127.0.0.1", version: 170011 });
    assert.equal((await scalar("SELECT to_regclass('catalog_private.collections') IS NULL AS absent")).absent, true);
    const productIds = await client.query("SELECT id, status FROM catalog_private.products WHERE status IN ('published','draft') ORDER BY id");
    const publishedId = productIds.rows.find((row) => row.status === "published")?.id;
    const draftId = productIds.rows.find((row) => row.status === "draft")?.id;
    assert.ok(publishedId && draftId, "dedicated synthetic fixture needs published and draft products");

    await t.test("failed migration transaction leaves no collections objects", async () => {
      await client.query("BEGIN"); insideTransaction = true;
      await assert.rejects(client.query(`${body}\nSELECT 1 / 0`), (error) => error.code === "22012");
      await rollback();
      assert.equal((await scalar("SELECT to_regclass('catalog_private.collections') IS NULL AS absent")).absent, true);
      assert.equal((await scalar("SELECT to_regclass('catalog_public.collections') IS NULL AS absent")).absent, true);
    });

    await t.test("unexpected private default ACL blocks the draft and rolls back", async () => {
      await client.query("BEGIN"); insideTransaction = true;
      await client.query("ALTER DEFAULT PRIVILEGES IN SCHEMA catalog_private GRANT SELECT ON TABLES TO catalog_import");
      await assert.rejects(client.query(body), (error) =>
        /Unreviewed private collections ACL/.test(error.message));
      await rollback();
      assert.equal((await scalar("SELECT to_regclass('catalog_private.collections') IS NULL AS absent")).absent, true);
    });

    await t.test("public reader UPDATE default ACL blocks the draft", async () => {
      await client.query("BEGIN"); insideTransaction = true;
      await client.query("ALTER DEFAULT PRIVILEGES IN SCHEMA catalog_private GRANT UPDATE ON TABLES TO catalog_public_reader");
      await assert.rejects(client.query(body), (error) =>
        /Unreviewed private collections ACL/.test(error.message));
      await rollback();
      assert.equal((await scalar("SELECT to_regclass('catalog_private.collections') IS NULL AS absent")).absent, true);
    });

    await t.test("unexpected guard function EXECUTE default ACL blocks the draft", async () => {
      await client.query("BEGIN"); insideTransaction = true;
      await client.query("ALTER DEFAULT PRIVILEGES IN SCHEMA catalog_private GRANT EXECUTE ON FUNCTIONS TO catalog_import");
      await assert.rejects(client.query(body), (error) =>
        /Unreviewed collections guard function EXECUTE ACL/.test(error.message));
      await rollback();
      assert.equal((await scalar("SELECT to_regclass('catalog_private.collections') IS NULL AS absent")).absent, true);
    });

    await t.test("unexpected public-view default ACL blocks the draft", async () => {
      await client.query("BEGIN"); insideTransaction = true;
      await client.query("ALTER DEFAULT PRIVILEGES IN SCHEMA catalog_public GRANT SELECT ON TABLES TO catalog_import");
      await assert.rejects(client.query(body), (error) =>
        /Unreviewed public collections view ACL/.test(error.message));
      await rollback();
      assert.equal((await scalar("SELECT to_regclass('catalog_public.collections') IS NULL AS absent")).absent, true);
    });

    await t.test("unexpected reader-role membership blocks the draft", async () => {
      await client.query("BEGIN"); insideTransaction = true;
      await client.query("GRANT catalog_public_reader TO catalog_import");
      await assert.rejects(client.query(body), (error) =>
        /Collections read role membership needs separate approval/.test(error.message));
      await rollback();
      assert.equal((await scalar("SELECT to_regclass('catalog_private.collections') IS NULL AS absent")).absent, true);
    });

    await t.test("existing public schema CREATE grant is not silently revoked", async () => {
      await client.query("BEGIN"); insideTransaction = true;
      await client.query("GRANT CREATE ON SCHEMA catalog_public TO catalog_public_reader");
      await assert.rejects(client.query(body), (error) =>
        /Existing public schema CREATE privilege needs separate review/.test(error.message));
      await rollback();
      assert.equal((await scalar("SELECT to_regclass('catalog_public.collections') IS NULL AS absent")).absent, true);
    });

    await client.query("BEGIN"); insideTransaction = true;
    await client.query(body);
    let firstId;
    let secondId;
    let thirdId;
    await t.test("1 Draft creation uses database defaults", async () => {
      const row = await scalar("INSERT INTO catalog_private.collections (slug) VALUES ('b5s2-first') RETURNING id,status,published_at");
      firstId = row.id;
      assert.equal(row.status, "draft");
      assert.equal(row.published_at, null);
    });
    await t.test("2 invalid slug is rejected", () => rejected(
      "INSERT INTO catalog_private.collections (slug) VALUES ('Bad Slug')", "23514"));
    await t.test("3 duplicate slug is rejected", () => rejected(
      "INSERT INTO catalog_private.collections (slug) VALUES ('b5s2-first')", "23505"));
    await t.test("4 invalid status is rejected", () => rejected(
      "INSERT INTO catalog_private.collections (slug,status) VALUES ('b5s2-invalid','active')", "23514"));
    await t.test("5 publishing without bilingual names is rejected", () => rejected(
      `UPDATE catalog_private.collections SET status='published' WHERE id='${firstId}'`, "23514"));
    await t.test("6 Draft to Published sets immutable first publication time", async () => {
      const row = await scalar(`UPDATE catalog_private.collections SET name_en='English',name_zh='中文',status='published'
        WHERE id=$1 RETURNING status,published_at`, [firstId]);
      assert.equal(row.status, "published");
      assert.ok(row.published_at);
    });
    await t.test("7 a Published collection may have zero members", async () => {
      assert.equal((await scalar("SELECT count(*)::integer AS n FROM catalog_private.product_collections WHERE collection_id=$1", [firstId])).n, 0);
    });
    await t.test("8 Published to Draft retains publication history", async () => {
      const before = await scalar("SELECT published_at FROM catalog_private.collections WHERE id=$1", [firstId]);
      const after = await scalar("UPDATE catalog_private.collections SET status='draft' WHERE id=$1 RETURNING status,published_at", [firstId]);
      assert.equal(after.status, "draft");
      assert.equal(after.published_at.toISOString(), before.published_at.toISOString());
    });
    await t.test("9 once-published slug cannot change while Draft", () => rejected(
      `UPDATE catalog_private.collections SET slug='b5s2-changed' WHERE id='${firstId}'`, "P0001"));
    await t.test("10 Published to Retired is allowed", async () => {
      await client.query("UPDATE catalog_private.collections SET status='published' WHERE id=$1", [firstId]);
      assert.equal((await scalar("UPDATE catalog_private.collections SET status='retired' WHERE id=$1 RETURNING status", [firstId])).status, "retired");
    });
    await t.test("11 Retired cannot be republished or edited", async () => {
      await rejected(`UPDATE catalog_private.collections SET status='published' WHERE id='${firstId}'`, "P0001");
      await rejected(`UPDATE catalog_private.collections SET name_en='changed' WHERE id='${firstId}'`, "P0001");
    });
    await t.test("12 duplicate product association is rejected", async () => {
      secondId = (await scalar("INSERT INTO catalog_private.collections (slug,name_en,name_zh,status) VALUES ('b5s2-second','Second','第二','published') RETURNING id")).id;
      await client.query("INSERT INTO catalog_private.product_collections (collection_id,product_id) VALUES ($1,$2)", [secondId,publishedId]);
      await rejected(`INSERT INTO catalog_private.product_collections (collection_id,product_id)
        VALUES ('${secondId}','${publishedId}')`, "23505");
    });
    await t.test("13 one product may belong to multiple collections", async () => {
      thirdId = (await scalar("INSERT INTO catalog_private.collections (slug,name_en,name_zh,status) VALUES ('b5s2-third','Third','第三','published') RETURNING id")).id;
      await client.query("INSERT INTO catalog_private.product_collections (collection_id,product_id) VALUES ($1,$2)", [thirdId,publishedId]);
      assert.equal((await scalar("SELECT count(*)::integer AS n FROM catalog_private.product_collections WHERE product_id=$1", [publishedId])).n, 2);
    });
    await t.test("14 nonexistent product UUID is rejected", () => rejected(
      `INSERT INTO catalog_private.product_collections (collection_id,product_id)
       VALUES ('${secondId}','00000000-0000-4000-8000-000000000000')`, "23503"));
    await t.test("15 duplicate sort values have deterministic UUID tie-break", async () => {
      await client.query("INSERT INTO catalog_private.product_collections (collection_id,product_id,sort_order) VALUES ($1,$2,0)", [secondId,draftId]);
      const ids = (await client.query("SELECT product_id FROM catalog_private.product_collections WHERE collection_id=$1 ORDER BY sort_order,product_id", [secondId])).rows.map((row) => row.product_id);
      assert.deepEqual(ids, [...ids].sort());
    });
    await t.test("16 Draft product remains linked but is absent from public membership", async () => {
      const ids = (await client.query("SELECT product_id FROM catalog_public.product_collections WHERE collection_id=$1", [secondId])).rows.map((row) => row.product_id);
      assert.deepEqual(ids, [publishedId]);
      assert.equal((await scalar("SELECT count(*)::integer AS n FROM catalog_private.product_collections WHERE collection_id=$1", [secondId])).n, 2);
    });
    await t.test("17 product unpublication removes only the public projection", async () => {
      await client.query("SAVEPOINT b5s2_product_status");
      try {
        await client.query("UPDATE catalog_private.products SET status='draft' WHERE id=$1", [publishedId]);
        assert.equal((await scalar("SELECT count(*)::integer AS n FROM catalog_public.product_collections WHERE collection_id=$1", [secondId])).n, 0);
        assert.equal((await scalar("SELECT count(*)::integer AS n FROM catalog_private.product_collections WHERE collection_id=$1", [secondId])).n, 2);
      } finally { await client.query("ROLLBACK TO SAVEPOINT b5s2_product_status"); await client.query("RELEASE SAVEPOINT b5s2_product_status"); }
    });
    await t.test("18 collection unpublication removes its public row and links", async () => {
      await client.query("SAVEPOINT b5s2_collection_status");
      try {
        await client.query("UPDATE catalog_private.collections SET status='draft' WHERE id=$1", [secondId]);
        assert.equal((await scalar("SELECT count(*)::integer AS n FROM catalog_public.collections WHERE id=$1", [secondId])).n, 0);
        assert.equal((await scalar("SELECT count(*)::integer AS n FROM catalog_public.product_collections WHERE collection_id=$1", [secondId])).n, 0);
      } finally { await client.query("ROLLBACK TO SAVEPOINT b5s2_collection_status"); await client.query("RELEASE SAVEPOINT b5s2_collection_status"); }
    });
    await t.test("19 anon sees safe views but no private rows", async () => {
      await asRole("anon", async () => {
        assert.equal((await scalar("SELECT count(*)::integer AS n FROM catalog_public.collections WHERE id=$1", [secondId])).n, 1);
        await rejected("SELECT id FROM catalog_private.collections", "42501");
        await rejected("SELECT collection_id FROM catalog_private.product_collections", "42501");
      });
    });
    await t.test("20 Admin runtime reads all states but cannot write", async () => {
      await asRole("catalog_admin_reader_runtime", async () => {
        assert.equal((await scalar("SELECT status FROM catalog_private.collections WHERE id=$1", [firstId])).status, "retired");
        await rejected("INSERT INTO catalog_private.collections (slug) VALUES ('b5s2-denied')", "42501");
        await rejected("UPDATE catalog_private.collections SET sort_order=1 WHERE false", "42501");
        await rejected("DELETE FROM catalog_private.product_collections WHERE false", "42501");
      });
    });
    await t.test("21 public projection columns and view owner are exact", async () => {
      const columns = (await client.query(`SELECT table_name,column_name FROM information_schema.columns
        WHERE table_schema='catalog_public' AND table_name IN ('collections','product_collections')
        ORDER BY table_name,ordinal_position`)).rows;
      assert.deepEqual(columns.filter((row) => row.table_name === "collections").map((row) => row.column_name),
        ["id","slug","name_en","name_zh","description_en","description_zh","sort_order"]);
      assert.deepEqual(columns.filter((row) => row.table_name === "product_collections").map((row) => row.column_name),
        ["collection_id","product_id","sort_order"]);
      const views = (await client.query(`SELECT relname,pg_get_userbyid(relowner) AS owner,reloptions
        FROM pg_class WHERE oid IN ('catalog_public.collections'::regclass,
          'catalog_public.product_collections'::regclass)`)).rows;
      assert.equal(views.length, 2);
      assert.ok(views.every((row) => row.owner === "catalog_public_reader" && row.reloptions?.includes("security_barrier=true")));
    });
    await t.test("22 private policies, no anon direct SELECT and no runtime writes", async () => {
      const policies = (await client.query(`SELECT tablename,policyname,cmd,roles FROM pg_policies
        WHERE schemaname='catalog_private' AND tablename IN ('collections','product_collections')`)).rows;
      assert.equal(policies.length, 4);
      assert.ok(policies.every((row) => row.cmd === "SELECT"));
      for (const table of ["collections", "product_collections"]) {
        assert.equal((await scalar(`SELECT has_table_privilege('anon','catalog_private.${table}','SELECT') AS allowed`)).allowed, false);
        assert.equal((await scalar(`SELECT has_table_privilege('catalog_admin_reader_runtime','catalog_private.${table}','INSERT,UPDATE,DELETE') AS allowed`)).allowed, false);
      }
    });
  } finally {
    await rollback().finally(() => client.end());
  }
});

test("B5-S3 two-session concurrency in an isolated disposable database", { skip: !concurrencyEnabled }, async (t) => {
  assert.notEqual(process.env.NODE_ENV, "production");
  assert.equal((await readFile(join(root, "data/PG_VERSION"), "utf8")).trim(), "17");
  const temporaryDatabase = "beauty_b2b_collections_b5s3_tmp";
  const options = { host: join(root, "socket"), port: 55432, user: userInfo().username,
    connectionTimeoutMillis: 2_000 };
  const control = new pg.Client({ ...options, database: "postgres" });
  let writer;
  let reader;
  let created = false;
  await control.connect();
  try {
    const identity = (await control.query(`SELECT current_database() AS db, current_user AS actor,
      current_setting('data_directory') AS data, current_setting('port') AS port,
      current_setting('listen_addresses') AS listen,
      current_setting('server_version_num')::integer AS version`)).rows[0];
    assert.deepEqual(identity, { db: "postgres", actor: userInfo().username,
      data: join(root, "data"), port: "55432", listen: "127.0.0.1", version: 170011 });
    assert.equal((await control.query("SELECT count(*)::integer AS n FROM pg_database WHERE datname=$1",
      [temporaryDatabase])).rows[0].n, 0, "disposable database must not already exist");
    await control.query(`CREATE DATABASE ${temporaryDatabase} TEMPLATE template0`);
    created = true;
    writer = new pg.Client({ ...options, database: temporaryDatabase });
    reader = new pg.Client({ ...options, database: temporaryDatabase });
    await writer.connect();
    await reader.connect();
    for (const client of [writer, reader]) {
      const target = (await client.query(`SELECT current_database() AS db,
        current_setting('data_directory') AS data, current_setting('port') AS port`)).rows[0];
      assert.deepEqual(target, { db: temporaryDatabase, data: join(root, "data"), port: "55432" });
      await client.query("SET statement_timeout = '4s'");
    }
    await writer.query(`CREATE SCHEMA catalog_private;
      CREATE SCHEMA catalog_public;
      CREATE TABLE catalog_private.products (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        status text NOT NULL CHECK (status IN ('draft','published','retired')));
      ALTER TABLE catalog_private.products ENABLE ROW LEVEL SECURITY;
      CREATE POLICY products_public_read ON catalog_private.products FOR SELECT
        TO catalog_public_reader USING (status = 'published');
      GRANT USAGE ON SCHEMA catalog_private TO catalog_public_reader, catalog_admin_reader_runtime;
      GRANT USAGE ON SCHEMA catalog_public TO anon;
      GRANT SELECT ON catalog_private.products TO catalog_public_reader;
      REVOKE ALL ON SCHEMA catalog_private, catalog_public FROM PUBLIC;
      REVOKE CREATE, TEMPORARY ON DATABASE ${temporaryDatabase} FROM PUBLIC;`);
    await writer.query(draft);
    const productId = (await writer.query(`INSERT INTO catalog_private.products (status)
      VALUES ('published') RETURNING id`)).rows[0].id;
    const addCollection = async (slug) => (await writer.query(`INSERT INTO catalog_private.collections
      (slug,name_en,name_zh,status) VALUES ($1,'English','中文','published') RETURNING id`,
    [slug])).rows[0].id;
    const publicCount = async (view, id) => {
      assert.ok(["collections", "product_collections"].includes(view));
      const column = view === "collections" ? "id" : "collection_id";
      return (await reader.query(`SELECT count(*)::integer AS n FROM catalog_public.${view}
        WHERE ${column}=$1`, [id])).rows[0].n;
    };
    const anonRead = async (view, id) => {
      await reader.query("SET ROLE anon");
      try { return await publicCount(view, id); }
      finally { await reader.query("RESET ROLE"); }
    };
    const waitForBlockedWriter = async () => {
      const writerPid = (await writer.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
      const readerPid = (await control.query(`SELECT pid FROM pg_stat_activity WHERE datname=$1
        AND usename=$2 AND pid <> $3 ORDER BY pid DESC LIMIT 1`,
      [temporaryDatabase, userInfo().username, writerPid])).rows[0]?.pid;
      assert.ok(readerPid, "second session must exist");
      for (let attempt = 0; attempt < 40; attempt++) {
        const blocked = (await writer.query("SELECT pg_blocking_pids($1::integer) AS pids", [readerPid])).rows[0].pids;
        if (blocked.includes(writerPid)) return;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      assert.fail("second session never blocked on the first session's row lock");
    };

    await t.test("A collection unpublication follows READ COMMITTED statement snapshots", async () => {
      const id = await addCollection("b5s3-a");
      await reader.query("BEGIN ISOLATION LEVEL READ COMMITTED READ ONLY");
      try {
        await reader.query("SET LOCAL ROLE anon");
        assert.equal(await publicCount("collections", id), 1);
        await writer.query("BEGIN");
        await writer.query("UPDATE catalog_private.collections SET status='draft' WHERE id=$1", [id]);
        assert.equal(await publicCount("collections", id), 1, "uncommitted change is invisible");
        await writer.query("COMMIT");
        assert.equal(await publicCount("collections", id), 0, "next statement sees committed Draft");
      } finally { await writer.query("ROLLBACK"); await reader.query("ROLLBACK"); }
    });

    await t.test("B product unpublication filters the public member but retains its link", async () => {
      const id = await addCollection("b5s3-b");
      await writer.query(`INSERT INTO catalog_private.product_collections (collection_id,product_id)
        VALUES ($1,$2)`, [id, productId]);
      assert.equal(await anonRead("product_collections", id), 1);
      await writer.query("BEGIN");
      try {
        await writer.query("UPDATE catalog_private.products SET status='draft' WHERE id=$1", [productId]);
        assert.equal(await anonRead("product_collections", id), 1);
        await writer.query("COMMIT");
        assert.equal(await anonRead("product_collections", id), 0);
        assert.equal((await writer.query(`SELECT count(*)::integer AS n FROM catalog_private.product_collections
          WHERE collection_id=$1`, [id])).rows[0].n, 1);
      } finally { await writer.query("ROLLBACK"); }
    });

    await t.test("C simultaneous updates serialize on one collection row", async () => {
      const id = await addCollection("b5s3-c");
      await writer.query("BEGIN");
      await reader.query("BEGIN");
      try {
        await writer.query("UPDATE catalog_private.collections SET status='draft' WHERE id=$1", [id]);
        const pending = reader.query("UPDATE catalog_private.collections SET status='retired' WHERE id=$1", [id]);
        await waitForBlockedWriter();
        await writer.query("COMMIT");
        await pending;
        await reader.query("COMMIT");
        assert.equal((await writer.query("SELECT status FROM catalog_private.collections WHERE id=$1", [id])).rows[0].status, "retired");
      } finally { await writer.query("ROLLBACK"); await reader.query("ROLLBACK"); }
    });

    await t.test("D concurrent modification cannot change a once-published slug", async () => {
      const id = await addCollection("b5s3-d");
      await writer.query("BEGIN");
      await reader.query("BEGIN");
      try {
        await writer.query("UPDATE catalog_private.collections SET name_en='changed' WHERE id=$1", [id]);
        const pending = reader.query("UPDATE catalog_private.collections SET slug='b5s3-escaped' WHERE id=$1", [id]);
        await waitForBlockedWriter();
        await writer.query("COMMIT");
        await assert.rejects(pending, (error) => error.code === "P0001");
        await reader.query("ROLLBACK");
        assert.equal((await writer.query("SELECT slug FROM catalog_private.collections WHERE id=$1", [id])).rows[0].slug, "b5s3-d");
      } finally { await writer.query("ROLLBACK"); await reader.query("ROLLBACK"); }
    });

    await t.test("E rollback leaves the other session seeing the last committed state", async () => {
      const id = await addCollection("b5s3-e");
      await writer.query("BEGIN");
      try {
        await writer.query("UPDATE catalog_private.collections SET status='draft' WHERE id=$1", [id]);
        assert.equal(await anonRead("collections", id), 1);
        await writer.query("ROLLBACK");
        assert.equal(await anonRead("collections", id), 1);
      } finally { await writer.query("ROLLBACK"); }
    });

    await t.test("F committed Draft and Retired filter; REPEATABLE READ retains only its old snapshot", async () => {
      const id = await addCollection("b5s3-f");
      await reader.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      try {
        await reader.query("SET LOCAL ROLE anon");
        assert.equal(await publicCount("collections", id), 1);
        await writer.query("UPDATE catalog_private.collections SET status='draft' WHERE id=$1", [id]);
        assert.equal(await publicCount("collections", id), 1, "old transaction snapshot remains visible");
        await reader.query("COMMIT");
        assert.equal(await anonRead("collections", id), 0, "new request sees Draft filtered");
        await writer.query("UPDATE catalog_private.collections SET status='retired' WHERE id=$1", [id]);
        assert.equal(await anonRead("collections", id), 0, "new request sees Retired filtered");
      } finally { await reader.query("ROLLBACK"); }
    });
  } finally {
    for (const client of [reader, writer]) {
      if (client) await client.end().catch(() => {});
    }
    try {
      if (created) {
        await control.query(`DROP DATABASE ${temporaryDatabase} WITH (FORCE)`);
        assert.equal((await control.query("SELECT count(*)::integer AS n FROM pg_database WHERE datname=$1",
          [temporaryDatabase])).rows[0].n, 0, "disposable database cleanup must be complete");
      }
    } finally { await control.end(); }
  }
});
