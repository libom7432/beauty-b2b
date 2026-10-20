import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { homedir, userInfo } from "node:os";
import { join } from "node:path";
import pg from "pg";

// Explicit, fixed local target. This script never accepts a database URL or host override.
const root = join(homedir(), "Library/Application Support/BeautyB2B/pg17-b4-test");
const database = "beauty_b2b_catalog_test";
const pgVersion = (await readFile(join(root, "data/PG_VERSION"), "utf8")).trim();
assert.equal(pgVersion, "17");
const client = new pg.Client({ host: join(root, "socket"), port: 55432,
  user: userInfo().username, database, connectionTimeoutMillis: 2_000, ssl: false });
const uuid = (number) => `${String(number).padStart(8, "0")}-0000-4000-8000-000000000000`;
const tables = ["products", "product_variants", "categories", "product_categories",
  "product_images", "product_translations"];
const readerPassword = randomBytes(32).toString("base64url");
const deniedPassword = randomBytes(32).toString("base64url");

await client.connect();
try {
  const settings = (await client.query(`SELECT current_database() AS db,
    current_setting('data_directory') AS data, current_setting('port') AS port,
    current_setting('listen_addresses') AS listen`)).rows[0];
  assert.deepEqual(settings, { db: database, data: join(root, "data"), port: "55432", listen: "127.0.0.1" });
  assert.equal((await client.query("SELECT count(*)::integer AS n FROM catalog_private.products")).rows[0].n, 0,
    "Refuse to seed a nonempty catalog");
  await client.query("BEGIN");
  // The passwords contain only base64url characters and are never printed or committed.
  await client.query(`CREATE ROLE catalog_read_local LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS
    NOCREATEDB NOCREATEROLE PASSWORD '${readerPassword}'`);
  await client.query(`CREATE ROLE catalog_no_policy_test LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS
    NOCREATEDB NOCREATEROLE PASSWORD '${deniedPassword}'`);
  await client.query(`REVOKE ALL ON DATABASE ${database} FROM PUBLIC`);
  await client.query(`GRANT CONNECT ON DATABASE ${database} TO catalog_read_local, catalog_no_policy_test`);
  await client.query("GRANT USAGE ON SCHEMA catalog_private, catalog_public TO catalog_read_local");
  await client.query("GRANT USAGE ON SCHEMA catalog_private TO catalog_no_policy_test");
  await client.query("GRANT SELECT ON ALL TABLES IN SCHEMA catalog_private TO catalog_read_local");
  await client.query("GRANT SELECT ON ALL TABLES IN SCHEMA catalog_public TO catalog_read_local");
  await client.query("GRANT SELECT ON catalog_private.products TO catalog_no_policy_test");
  await client.query("REVOKE ALL ON ALL FUNCTIONS IN SCHEMA catalog_private FROM PUBLIC");
  await client.query("CREATE FUNCTION catalog_private.local_import_probe() RETURNS integer LANGUAGE sql AS 'SELECT 1'");
  await client.query("REVOKE ALL ON FUNCTION catalog_private.local_import_probe() FROM PUBLIC");
  for (const table of tables) {
    await client.query(`CREATE POLICY local_reader_${table} ON catalog_private.${table}
      FOR SELECT TO catalog_read_local USING (true)`);
  }
  // A synthetic RFQ sentinel makes the access-denial check non-vacuous.
  await client.query("CREATE SCHEMA rfq_private");
  await client.query("CREATE TABLE rfq_private.sentinel (id integer PRIMARY KEY)");
  await client.query("INSERT INTO rfq_private.sentinel VALUES (1)");

  const categoryRows = [
    [701, null, "nails", "published", "Nails", "美甲"],
    [702, 701, "press-on", "published", "Press-on", "穿戴甲"],
    [703, null, "internal-draft", "draft", "Draft category", "草稿分类"],
    [704, null, "retired-category", "retired", "Retired category", "下架分类"],
  ];
  for (const [id, parent, slug, status, en, zh] of categoryRows) {
    await client.query(`INSERT INTO catalog_private.categories
      (id, parent_id, slug, status, name_en, name_zh) VALUES ($1,$2,$3,$4,$5,$6)`,
    [uuid(id), parent === null ? null : uuid(parent), slug, status, en, zh]);
  }

  for (let number = 1; number <= 9; number++) {
    const status = number === 2 || number === 9 ? "draft" : number === 3 ? "retired" : "published";
    const code = number === 9 ? "CN-甲" : `FAMILY-${String(number).padStart(2, "0")}`;
    const productId = uuid(number);
    await client.query(`INSERT INTO catalog_private.products
      (id, product_code, slug, product_type, status, featured) VALUES ($1,$2,$3,'press-on',$4,$5)`,
    [productId, code, `family-${number}`, status, number === 1]);
    await client.query(`INSERT INTO catalog_private.product_categories
      (product_id, category_id, is_primary) VALUES ($1,$2,true)`, [productId, uuid(702)]);
    if (number === 1) {
      for (const extra of [703, 704]) await client.query(`INSERT INTO catalog_private.product_categories
        (product_id, category_id, is_primary, sort_order) VALUES ($1,$2,false,$3)`,
      [productId, uuid(extra), extra]);
    }
    const enName = number === 1 ? "Rose%_Set" : number === 2 ? "Draft Family" :
      number === 4 ? "Back\\Slash" : `Family ${number}`;
    const zhName = number === 1 ? "玫瑰甲片" : `美甲商品${number}`;
    for (const locale of status === "published" ? ["en", "zh"] : ["en"]) {
      const name = locale === "en" ? enName : zhName;
      await client.query(`INSERT INTO catalog_private.product_translations
        (product_id, locale, name, short_description, description, seo_title, seo_description)
        VALUES ($1,$2,$3,'Synthetic short','Synthetic description','Synthetic SEO','Synthetic SEO description')`,
      [productId, locale, name]);
    }
    const variantStatus = status;
    await client.query(`INSERT INTO catalog_private.product_variants
      (id, product_id, sku, status, attributes, moq_quantity, moq_unit, reference_price, reference_currency)
      VALUES ($1,$2,$3,$4,$5,100,'pieces',12.3400,'USD')`,
    [uuid(100 + number), productId, `SKU-${String(number).padStart(2, "0")}`,
      variantStatus, JSON.stringify({ size: "short" })]);
    if (number === 1) {
      await client.query(`INSERT INTO catalog_private.product_variants
        (id, product_id, sku, status, attributes, moq_quantity, moq_unit)
        VALUES ($1,$2,'SKU-01-DRAFT','draft',$3,200,'pieces')`,
      [uuid(111), productId, JSON.stringify({ size: "long" })]);
    }
    if (number !== 9) {
      await client.query(`INSERT INTO catalog_private.product_images
        (id, product_id, storage_key, public_url, role, status, alt_en, alt_zh)
        VALUES ($1,$2,$3,$4,'primary',$5,'Synthetic image','合成图片')`,
      [uuid(200 + number), productId, `private/synthetic/${number}/primary.webp`,
        `https://example.invalid/synthetic/${number}/primary.webp`, status]);
    }
    if (number === 1) {
      await client.query(`INSERT INTO catalog_private.product_images
        (id, product_id, storage_key, public_url, role, status)
        VALUES ($1,$2,'private/synthetic/1/draft.webp','https://example.invalid/synthetic/1/draft.webp','detail','draft')`,
      [uuid(301), productId]);
      await client.query(`INSERT INTO catalog_private.product_images
        (id, product_id, variant_id, storage_key, public_url, role, status, alt_en, alt_zh)
        VALUES ($1,$2,$3,'private/synthetic/1/variant.webp',
          'https://example.invalid/synthetic/1/variant.webp','variant','published','Variant','规格')`,
      [uuid(302), productId, uuid(101)]);
    }
  }
  await client.query("COMMIT");
  await writeFile(join(root, "reader.password"), readerPassword, { mode: 0o600, flag: "wx" });
  await writeFile(join(root, "denied.password"), deniedPassword, { mode: 0o600, flag: "wx" });
  process.stdout.write("Isolated catalog roles and synthetic fixtures created. No credentials printed.\n");
} catch (error) {
  try { await client.query("ROLLBACK"); } catch { /* Preserve original failure. */ }
  throw error;
} finally {
  await client.end();
}
