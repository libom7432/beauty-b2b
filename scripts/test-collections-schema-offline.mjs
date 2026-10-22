import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const draft = await readFile(new URL("../docs/sql/collections-schema-security.b5s2.draft.sql", import.meta.url), "utf8");

test("draft is outside migrations and explicitly non-deployable", () => {
  assert.match(draft, /^-- DRAFT \/ NOT APPROVED FOR MIGRATION/m);
  assert.match(draft, /^BEGIN;[\s\S]*COMMIT;\s*$/m);
  assert.ok(!new URL("../docs/sql/collections-schema-security.b5s2.draft.sql", import.meta.url)
    .pathname.includes("/supabase/migrations/"));
});

test("only the two approved private collection tables are created", () => {
  assert.deepEqual([...draft.matchAll(/CREATE TABLE\s+([\w.]+)/g)].map((match) => match[1]),
    ["catalog_private.collections", "catalog_private.product_collections"]);
  assert.doesNotMatch(draft, /(?:ALTER|DROP)\s+TABLE\s+catalog_private\.(?:products|categories|product_variants|product_categories|product_images|product_translations)\b/i);
});

test("collection identity, status, names and publication history have database guards", () => {
  for (const expression of [
    /slug text NOT NULL UNIQUE CHECK/, /status text NOT NULL DEFAULT 'draft' CHECK/,
    /btrim\(name_en\) <> '' AND btrim\(name_zh\) <> ''/,
    /OLD\.published_at IS NOT NULL AND NEW\.slug IS DISTINCT FROM OLD\.slug/,
    /OLD\.status = 'retired'/,
    /NEW\.published_at := now\(\)/,
  ]) assert.match(draft, expression);
});

test("membership uses product UUID and restricts deletion", () => {
  assert.match(draft, /product_id uuid NOT NULL REFERENCES catalog_private\.products\(id\) ON DELETE RESTRICT/);
  assert.match(draft, /PRIMARY KEY \(collection_id, product_id\)/);
  assert.match(draft, /\(collection_id, sort_order, product_id\)/);
  assert.doesNotMatch(draft, /\bsku\b/i);
});

test("RLS and grants keep the runtime role SELECT-only", () => {
  assert.equal([...draft.matchAll(/ENABLE ROW LEVEL SECURITY/g)].length, 2);
  assert.equal([...draft.matchAll(/FOR SELECT\s+TO catalog_admin_reader_runtime/g)].length, 2);
  assert.equal([...draft.matchAll(/FOR SELECT\s+TO catalog_public_reader/g)].length, 2);
  assert.doesNotMatch(draft, /GRANT\s+(?:INSERT|UPDATE|DELETE|TRUNCATE|ALL)\s+ON[^;]+TO\s+catalog_admin_reader_runtime/i);
});

test("public membership filters both collection and product status", () => {
  assert.match(draft, /c\.status = 'published'/);
  assert.match(draft, /p\.status = 'published'/);
  assert.match(draft, /ALTER VIEW catalog_public\.collections OWNER TO catalog_public_reader/);
  assert.match(draft, /ALTER VIEW catalog_public\.product_collections OWNER TO catalog_public_reader/);
  assert.doesNotMatch(draft, /\bstorage_key\b[^\n]*AS\s+\w+/i);
});

test("unreviewed default ACLs cause a migration failure", () => {
  assert.match(draft, /aclexplode\(coalesce\(c\.relacl, acldefault\('r', c\.relowner\)\)\)/);
  assert.match(draft, /Unreviewed private collections ACL/);
  assert.match(draft, /Unreviewed public collections view ACL/);
  assert.match(draft, /Collections private-table effective privileges exceed read-only design/);
  assert.match(draft, /acl\.privilege_type <> 'SELECT' OR acl\.is_grantable/);
  assert.match(draft, /Unreviewed collections guard function EXECUTE ACL/);
  assert.match(draft, /rolreplication/);
  assert.match(draft, /has_table_privilege\('catalog_public_reader', 'catalog_private\.collections', 'UPDATE'\)/);
});

test("no automatic rule collection, import expansion or collection write identity", () => {
  assert.doesNotMatch(draft, /CREATE TABLE[^;]*\brules\b/i);
  assert.doesNotMatch(draft, /GRANT[^;]*TO\s+catalog_import/i);
  assert.doesNotMatch(draft, /CREATE ROLE/i);
});
