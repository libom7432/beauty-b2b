import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const url = process.env.CATALOG_TEST_DATABASE_URL;
const expectedDir = process.env.CATALOG_TEST_DATA_DIR;
if (process.env.CATALOG_TEST_ENABLE !== "1" || !url || !expectedDir) {
  throw new Error("Explicit local catalog test switch, URL, and data directory are required");
}
const parsed = new URL(url);
if (parsed.protocol !== "postgresql:" || parsed.hostname !== "127.0.0.1" ||
    parsed.port !== "55439" || parsed.pathname !== "/catalog_schema_test") {
  throw new Error("Refusing non-isolated catalog test database target");
}

const client = new pg.Client({ connectionString: url });
await client.connect();
let tests = 0;
async function query(sql, values = []) { return client.query(sql, values); }
async function mustFail(sql, values = []) {
  await query("SAVEPOINT expect_failure");
  let failed = false;
  try { await query(sql, values); } catch { failed = true; }
  await query("ROLLBACK TO SAVEPOINT expect_failure");
  await query("RELEASE SAVEPOINT expect_failure");
  assert.equal(failed, true, `Expected failure: ${sql.slice(0, 100)}`);
  tests++;
}
try {
  const preflight = (await query(`SELECT current_database() AS db, current_user AS role,
    host(inet_server_addr()) AS host, inet_server_port() AS port,
    current_setting('data_directory') AS data_dir,
    current_setting('server_version_num')::integer AS version,
    to_regnamespace('catalog_private') IS NULL AS fresh`)).rows[0];
  assert.equal(preflight.db, "catalog_schema_test");
  assert.equal(preflight.host, "127.0.0.1");
  assert.equal(preflight.port, 55439);
  assert.equal(fs.realpathSync(preflight.data_dir), fs.realpathSync(expectedDir));
  assert.ok(preflight.version >= 170000 && preflight.fresh);
  const existingRfq = (await query("SELECT to_regnamespace('rfq_private') IS NOT NULL AS present")).rows[0];
  assert.equal(existingRfq.present, false);
  if (!(await query("SELECT 1 FROM pg_roles WHERE rolname = 'anon'")).rowCount) {
    await query("CREATE ROLE anon NOLOGIN NOINHERIT");
  }
  if (!(await query("SELECT 1 FROM pg_roles WHERE rolname = 'rfq_api'")).rowCount) {
    await query("CREATE ROLE rfq_api NOLOGIN NOINHERIT");
  }
  const migration = fs.readFileSync(path.join(root, "supabase/migrations/20261013120000_create_catalog_foundation.sql"), "utf8");
  await query(migration);
  assert.equal((await query("SELECT count(*)::integer AS n FROM information_schema.tables WHERE table_schema = 'catalog_private'")).rows[0].n, 6);
  tests++;

  await query("BEGIN");
  const category = (await query(`INSERT INTO catalog_private.categories (slug,status,name_en,name_zh)
    VALUES ('press-on-nails','published','Press-On Nails','穿戴甲') RETURNING id`)).rows[0].id;
  const product = (await query(`INSERT INTO catalog_private.products (product_code,slug,product_type)
    VALUES ('REAL-PO-001','real-press-on','press_on_nails') RETURNING id`)).rows[0].id;
  await query("UPDATE catalog_private.products SET status = 'published' WHERE id = $1", [product]);
  await mustFail("SET CONSTRAINTS ALL IMMEDIATE");
  await query("SET CONSTRAINTS ALL DEFERRED");
  await query(`INSERT INTO catalog_private.product_categories (product_id,category_id,is_primary) VALUES ($1,$2,true)`, [product, category]);
  const variant = (await query(`INSERT INTO catalog_private.product_variants
    (product_id,sku,status,attributes,moq_quantity,moq_unit)
    VALUES ($1,'REAL-PO-001-R','published','{"Color":" Rose  Pink "}',100,'sets') RETURNING id`, [product])).rows[0].id;
  for (const [locale, name] of [["en", "Real Press-On"], ["zh", "真实穿戴甲"]]) {
    await query(`INSERT INTO catalog_private.product_translations
      (product_id,locale,name,short_description,description,seo_title,seo_description)
      VALUES ($1,$2,$3,'Short','Long description','SEO title','SEO description')`, [product, locale, name]);
  }
  const image = (await query(`INSERT INTO catalog_private.product_images
    (product_id,storage_key,public_url,role,status,alt_en,alt_zh)
    VALUES ($1,'products/real-001.webp','/images/real-001.webp','primary','published','Press-on nails','穿戴甲') RETURNING id`, [product])).rows[0].id;
  await query("SET CONSTRAINTS ALL IMMEDIATE");
  assert.ok((await query("SELECT published_at FROM catalog_private.products WHERE id=$1", [product])).rows[0].published_at);
  tests++;

  await mustFail(`INSERT INTO catalog_private.product_variants
    (product_id,sku,attributes,moq_quantity,moq_unit)
    VALUES ($1,'REAL-PO-001-DUP','{"color":"rose pink"}',100,'sets')`, [product]);
  await mustFail("UPDATE catalog_private.products SET slug='changed-slug' WHERE id=$1", [product]);
  await mustFail("UPDATE catalog_private.products SET product_code='CHANGED' WHERE id=$1", [product]);
  await mustFail("UPDATE catalog_private.product_variants SET sku='CHANGED' WHERE id=$1", [variant]);
  await mustFail("UPDATE catalog_private.product_variants SET moq_quantity=0 WHERE id=$1", [variant]);
  await mustFail("DELETE FROM catalog_private.product_variants WHERE id=$1", [variant]);
  await mustFail("DELETE FROM catalog_private.products WHERE id=$1", [product]);
  await mustFail("UPDATE catalog_private.product_variants SET status='retired' WHERE id=$1", [variant]);
  await mustFail("DELETE FROM catalog_private.product_translations WHERE product_id=$1 AND locale='zh'", [product]);
  await mustFail("UPDATE catalog_private.product_translations SET name='' WHERE product_id=$1 AND locale='zh'", [product]);
  await mustFail("DELETE FROM catalog_private.product_images WHERE id=$1", [image]);
  await mustFail("UPDATE catalog_private.product_images SET alt_zh='' WHERE id=$1", [image]);
  await mustFail("UPDATE catalog_private.product_images SET status='draft' WHERE id=$1", [image]);
  await mustFail("DELETE FROM catalog_private.product_categories WHERE product_id=$1 AND category_id=$2", [product, category]);
  await mustFail("UPDATE catalog_private.product_categories SET is_primary=false WHERE product_id=$1 AND category_id=$2", [product, category]);
  await mustFail("UPDATE catalog_private.categories SET status='retired' WHERE id=$1", [category]);
  await mustFail("UPDATE catalog_private.products SET status='retired' WHERE id=$1", [product]);

  const other = (await query(`INSERT INTO catalog_private.products (product_code,slug,product_type)
    VALUES ('REAL-PO-002','other-product','press_on_nails') RETURNING id`)).rows[0].id;
  const otherVariant = (await query(`INSERT INTO catalog_private.product_variants
    (product_id,sku,attributes,moq_quantity,moq_unit)
    VALUES ($1,'REAL-PO-002-R','{"color":"blue"}',100,'sets') RETURNING id`, [other])).rows[0].id;
  await mustFail(`INSERT INTO catalog_private.product_images
    (product_id,variant_id,storage_key,public_url,role)
    VALUES ($1,$2,'wrong-variant','/wrong.webp','variant')`, [product, otherVariant]);
  await mustFail(`INSERT INTO catalog_private.product_variants
    (product_id,sku,attributes,moq_quantity,moq_unit)
    VALUES ($1,'REAL-PO-001-R','{"color":"blue"}',100,'sets')`, [other]);

  await query("SET LOCAL ROLE anon");
  assert.equal((await query("SELECT count(*)::integer AS n FROM catalog_public.products")).rows[0].n, 1);
  assert.equal((await query("SELECT count(*)::integer AS n FROM catalog_public.product_variants")).rows[0].n, 1);
  assert.equal((await query("SELECT count(*)::integer AS n FROM catalog_public.product_images")).rows[0].n, 1);
  await mustFail("SELECT * FROM catalog_private.products");
  await mustFail("INSERT INTO catalog_private.products(product_code,slug,product_type) VALUES ('X','x','x')");
  await query("RESET ROLE");
  tests++;

  // A single transaction may retire the product and its SKU together.
  await query("SET CONSTRAINTS ALL DEFERRED");
  await query("UPDATE catalog_private.products SET status='retired' WHERE id=$1", [product]);
  await query("UPDATE catalog_private.product_variants SET status='retired' WHERE id=$1", [variant]);
  await query("SET CONSTRAINTS ALL IMMEDIATE");
  tests++;
  await query("ROLLBACK");

  // Permission test uses role switching in a transaction on the isolated cluster.
  await query("BEGIN");
  await query("SET LOCAL ROLE anon");
  assert.equal((await query("SELECT count(*)::integer AS n FROM catalog_public.products")).rows[0].n, 0);
  tests++;
  await mustFail("SELECT * FROM catalog_private.products");
  await mustFail("INSERT INTO catalog_private.products(product_code,slug,product_type) VALUES ('X','x','x')");
  await mustFail("INSERT INTO catalog_public.products(product_code,slug,product_type) VALUES ('X','x','x')");
  await query("ROLLBACK");

  const roles = (await query(`SELECT rolname, rolcanlogin, rolbypassrls FROM pg_roles
    WHERE rolname IN ('catalog_admin','catalog_import') ORDER BY rolname`)).rows;
  assert.deepEqual(roles.map(({ rolname, rolcanlogin, rolbypassrls }) => [rolname, rolcanlogin, rolbypassrls]),
    [["catalog_admin", false, false], ["catalog_import", false, false]]);
  const grants = (await query(`SELECT
    has_table_privilege('catalog_import','catalog_private.products','INSERT') AS import_insert,
    has_table_privilege('catalog_import','catalog_private.products','DELETE') AS import_delete,
    has_table_privilege('catalog_admin','catalog_private.products','UPDATE') AS admin_update,
    has_table_privilege('anon','catalog_private.products','SELECT') AS anon_private_select`)).rows[0];
  assert.deepEqual(grants, { import_insert: true, import_delete: false, admin_update: true, anon_private_select: false });
  tests++;

  // Commit a wholly synthetic fixture. The checks below verify committed state,
  // including failures raised by deferred triggers at COMMIT rather than by SET CONSTRAINTS.
  await query("BEGIN");
  const liveCategory = (await query(`INSERT INTO catalog_private.categories(slug,status,name_en,name_zh)
    VALUES ('live-category','published','Live category','已发布分类') RETURNING id`)).rows[0].id;
  async function completeProduct(code, slug, sku, attributes, imageKey) {
    const pid = (await query(`INSERT INTO catalog_private.products(product_code,slug,product_type)
      VALUES ($1,$2,'press_on_nails') RETURNING id`, [code, slug])).rows[0].id;
    await query(`INSERT INTO catalog_private.product_categories(product_id,category_id,is_primary)
      VALUES ($1,$2,true)`, [pid, liveCategory]);
    const vid = (await query(`INSERT INTO catalog_private.product_variants
      (product_id,sku,status,attributes,moq_quantity,moq_unit)
      VALUES ($1,$2,'published',$3,100,'sets') RETURNING id`, [pid, sku, attributes])).rows[0].id;
    for (const [locale, name] of [["en", "Synthetic product"], ["zh", "合成测试商品"]]) {
      await query(`INSERT INTO catalog_private.product_translations
        (product_id,locale,name,short_description,description,seo_title,seo_description)
        VALUES ($1,$2,$3,'Short','Description','SEO title','SEO description')`, [pid, locale, name]);
    }
    const iid = (await query(`INSERT INTO catalog_private.product_images
      (product_id,storage_key,public_url,role,status,alt_en,alt_zh)
      VALUES ($1,$2,$3,'primary','published','Synthetic image','合成测试图片') RETURNING id`,
      [pid, imageKey, `/images/${imageKey}.webp`])).rows[0].id;
    await query("UPDATE catalog_private.products SET status='published' WHERE id=$1", [pid]);
    return { pid, vid, iid };
  }
  const live = await completeProduct("SYN-LIVE", "synthetic-live", "SYN-LIVE-A", { Color: "Rose" }, "synthetic-live");
  const retired = await completeProduct("SYN-OLD", "synthetic-retired", "SYN-OLD-A", { Color: "Old" }, "synthetic-old");
  const draft = (await query(`INSERT INTO catalog_private.products(product_code,slug,product_type)
    VALUES ('SYN-DRAFT','synthetic-draft','press_on_nails') RETURNING id`)).rows[0].id;
  await query(`INSERT INTO catalog_private.product_variants
    (product_id,sku,status,attributes,moq_quantity,moq_unit)
    VALUES ($1,'SYN-LIVE-DRAFT','draft','{"color":"blue"}',100,'sets')`, [live.pid]);
  await query("UPDATE catalog_private.products SET status='retired' WHERE id=$1", [retired.pid]);
  await query("UPDATE catalog_private.product_variants SET status='retired' WHERE id=$1", [retired.vid]);
  await query("COMMIT");
  tests++;

  async function rejectCommit(label, mutation, verify) {
    await query("BEGIN");
    await mutation();
    let failed = false;
    try { await query("COMMIT"); } catch { failed = true; }
    assert.equal(failed, true, `${label}: COMMIT should fail`);
    await verify();
    tests++;
  }
  await rejectCommit("last published SKU", async () => {
    await query("UPDATE catalog_private.product_variants SET status='retired' WHERE id=$1", [live.vid]);
  }, async () => assert.equal((await query("SELECT status FROM catalog_private.product_variants WHERE id=$1", [live.vid])).rows[0].status, "published"));
  await rejectCommit("only primary category", async () => {
    await query("DELETE FROM catalog_private.product_categories WHERE product_id=$1", [live.pid]);
  }, async () => assert.equal((await query("SELECT count(*)::integer AS n FROM catalog_private.product_categories WHERE product_id=$1", [live.pid])).rows[0].n, 1));
  await rejectCommit("only primary image", async () => {
    await query("DELETE FROM catalog_private.product_images WHERE id=$1", [live.iid]);
  }, async () => assert.equal((await query("SELECT count(*)::integer AS n FROM catalog_private.product_images WHERE id=$1", [live.iid])).rows[0].n, 1));
  await rejectCommit("required translation", async () => {
    await query("DELETE FROM catalog_private.product_translations WHERE product_id=$1 AND locale='zh'", [live.pid]);
  }, async () => assert.equal((await query("SELECT count(*)::integer AS n FROM catalog_private.product_translations WHERE product_id=$1", [live.pid])).rows[0].n, 2));
  await rejectCommit("published SKU on retired product", async () => {
    await query("UPDATE catalog_private.product_variants SET status='published' WHERE id=$1", [retired.vid]);
  }, async () => assert.equal((await query("SELECT status FROM catalog_private.product_variants WHERE id=$1", [retired.vid])).rows[0].status, "retired"));

  // These constraints reject the statement itself; committing the surrounding
  // transaction still leaves the committed fixture unchanged.
  await query("BEGIN");
  await mustFail("DELETE FROM catalog_private.product_variants WHERE id=$1", [live.vid]);
  await mustFail(`INSERT INTO catalog_private.product_variants
    (product_id,sku,attributes,moq_quantity,moq_unit)
    VALUES ($1,'SYN-DUP-COMBO','{"color":" ROSE "}',100,'sets')`, [live.pid]);
  await mustFail(`INSERT INTO catalog_private.product_variants
    (product_id,sku,attributes,moq_quantity,moq_unit)
    VALUES ($1,'SYN-LIVE-A','{"color":"new"}',100,'sets')`, [draft]);
  const otherSku = (await query(`INSERT INTO catalog_private.product_variants
    (product_id,sku,attributes,moq_quantity,moq_unit)
    VALUES ($1,'SYN-DRAFT-SKU','{"color":"draft"}',100,'sets') RETURNING id`, [draft])).rows[0].id;
  await mustFail(`INSERT INTO catalog_private.product_images
    (product_id,variant_id,storage_key,public_url,role)
    VALUES ($1,$2,'cross-product','/cross.webp','variant')`, [live.pid, otherSku]);
  await query("COMMIT");
  assert.equal((await query("SELECT count(*)::integer AS n FROM catalog_private.product_variants WHERE sku IN ('SYN-DUP-COMBO','SYN-LIVE-A')")).rows[0].n, 1);
  assert.equal((await query("SELECT status FROM catalog_private.product_variants WHERE id=$1", [live.vid])).rows[0].status, "published");
  assert.equal((await query("SELECT count(*)::integer AS n FROM catalog_private.product_images WHERE storage_key='cross-product'")).rows[0].n, 0);
  tests++;

  await query("BEGIN");
  await query("SET LOCAL ROLE anon");
  const visible = (await query("SELECT slug FROM catalog_public.products ORDER BY slug")).rows.map((row) => row.slug);
  assert.deepEqual(visible, ["synthetic-live"]);
  assert.deepEqual((await query("SELECT sku FROM catalog_public.product_variants ORDER BY sku")).rows.map((row) => row.sku), ["SYN-LIVE-A"]);
  assert.equal((await query("SELECT count(*)::integer AS n FROM catalog_public.categories")).rows[0].n, 1);
  assert.equal((await query("SELECT count(*)::integer AS n FROM catalog_public.product_categories")).rows[0].n, 1);
  assert.equal((await query("SELECT count(*)::integer AS n FROM catalog_public.product_images")).rows[0].n, 1);
  assert.equal((await query("SELECT count(*)::integer AS n FROM catalog_public.product_translations")).rows[0].n, 2);
  await mustFail("SELECT * FROM catalog_private.products");
  await mustFail("INSERT INTO catalog_private.products(product_code,slug,product_type) VALUES ('BAD','bad','bad')");
  await mustFail("UPDATE catalog_private.products SET slug='bad' WHERE id=$1", [live.pid]);
  await mustFail("DELETE FROM catalog_private.products WHERE id=$1", [live.pid]);
  await query("ROLLBACK");
  tests++;

  await query("BEGIN");
  await query("SET LOCAL ROLE catalog_import");
  await mustFail("DELETE FROM catalog_private.product_images WHERE id=$1", [live.iid]);
  await query("ROLLBACK");
  tests++;

  const roleAudit = (await query(`SELECT r.rolname, r.rolcanlogin, r.rolinherit, r.rolbypassrls,
    EXISTS (SELECT 1 FROM pg_auth_members m WHERE m.member = r.oid) AS has_membership
    FROM pg_roles r WHERE r.rolname IN ('catalog_public_reader','catalog_admin','catalog_import','rfq_api') ORDER BY r.rolname`)).rows;
  assert.equal(roleAudit.length, 4);
  assert.ok(roleAudit.every((row) => !row.rolcanlogin && !row.rolinherit && !row.rolbypassrls && !row.has_membership));
  const rfqGrants = (await query(`SELECT has_schema_privilege('rfq_api','catalog_private','USAGE') AS private_usage,
    has_schema_privilege('rfq_api','catalog_public','USAGE') AS public_usage,
    has_table_privilege('rfq_api','catalog_private.products','SELECT') AS read_product,
    has_table_privilege('rfq_api','catalog_public.products','SELECT') AS read_public`)).rows[0];
  assert.deepEqual(rfqGrants, { private_usage: false, public_usage: false, read_product: false, read_public: false });
  const viewAudit = (await query(`SELECT count(*)::integer AS n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_roles r ON r.oid=c.relowner WHERE n.nspname='catalog_public' AND c.relkind='v'
      AND r.rolname='catalog_public_reader' AND c.reloptions @> ARRAY['security_barrier=true']`)).rows[0].n;
  assert.equal(viewAudit, 6);
  tests++;

  await query("BEGIN");
  await query("SET LOCAL ROLE catalog_public_reader");
  assert.deepEqual((await query("SELECT slug FROM catalog_private.products ORDER BY slug")).rows.map((row) => row.slug), ["synthetic-live"]);
  assert.deepEqual((await query("SELECT sku FROM catalog_private.product_variants ORDER BY sku")).rows.map((row) => row.sku), ["SYN-LIVE-A"]);
  await mustFail("UPDATE catalog_private.products SET slug='bad' WHERE id=$1", [live.pid]);
  await query("ROLLBACK");
  tests++;

  // A separately authenticated role cannot acquire catalog roles by inheritance or SET ROLE.
  if (!(await query("SELECT 1 FROM pg_roles WHERE rolname = 'catalog_untrusted_test'")).rowCount) {
    await query("CREATE ROLE catalog_untrusted_test LOGIN NOINHERIT");
  }
  const untrusted = new pg.Client({ connectionString: url.replace('catalog_test_owner@', 'catalog_untrusted_test@') });
  await untrusted.connect();
  try {
    await assert.rejects(untrusted.query("SELECT * FROM catalog_private.products"));
    await assert.rejects(untrusted.query("SELECT * FROM catalog_public.products"));
    await assert.rejects(untrusted.query("SET ROLE catalog_admin"));
    await assert.rejects(untrusted.query("SET ROLE catalog_import"));
  } finally { await untrusted.end(); }
  await query("DROP ROLE catalog_untrusted_test");
  tests++;

  // Replacement in one committed transaction is valid, without a transient
  // published-state gap leaking into the final database state.
  await query("BEGIN");
  const replacementCategory = (await query(`INSERT INTO catalog_private.categories(slug,status,name_en,name_zh)
    VALUES ('replacement-category','published','Replacement','替换分类') RETURNING id`)).rows[0].id;
  await query("UPDATE catalog_private.product_categories SET is_primary=false WHERE product_id=$1 AND category_id=$2", [live.pid, liveCategory]);
  await query("DELETE FROM catalog_private.product_categories WHERE product_id=$1 AND category_id=$2", [live.pid, liveCategory]);
  await query("INSERT INTO catalog_private.product_categories(product_id,category_id,is_primary) VALUES ($1,$2,true)", [live.pid, replacementCategory]);
  await query("UPDATE catalog_private.product_variants SET status='retired' WHERE id=$1", [live.vid]);
  const replacementSku = (await query(`INSERT INTO catalog_private.product_variants
    (product_id,sku,status,attributes,moq_quantity,moq_unit)
    VALUES ($1,'SYN-LIVE-B','published','{"color":"new"}',100,'sets') RETURNING id`, [live.pid])).rows[0].id;
  await query("UPDATE catalog_private.product_images SET status='retired' WHERE id=$1", [live.iid]);
  const replacementImage = (await query(`INSERT INTO catalog_private.product_images
    (product_id,storage_key,public_url,role,status,alt_en,alt_zh)
    VALUES ($1,'synthetic-new','/images/synthetic-new.webp','primary','published','New image','新图片') RETURNING id`, [live.pid])).rows[0].id;
  await query("DELETE FROM catalog_private.product_translations WHERE product_id=$1 AND locale='zh'", [live.pid]);
  await query(`INSERT INTO catalog_private.product_translations
    (product_id,locale,name,short_description,description,seo_title,seo_description)
    VALUES ($1,'zh','替换翻译','简述','详细描述','标题','描述')`, [live.pid]);
  await query("COMMIT");
  assert.equal((await query("SELECT count(*)::integer AS n FROM catalog_private.product_categories WHERE product_id=$1 AND is_primary", [live.pid])).rows[0].n, 1);
  assert.equal((await query("SELECT status FROM catalog_private.product_variants WHERE id=$1", [replacementSku])).rows[0].status, "published");
  assert.equal((await query("SELECT status FROM catalog_private.product_images WHERE id=$1", [replacementImage])).rows[0].status, "published");
  tests++;
  console.log(`Catalog schema migration and ${tests} assertions passed on isolated PostgreSQL`);
} finally {
  await client.end();
}
