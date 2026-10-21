import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import test from "node:test";
import pg from "pg";
import { checkCatalogPermissionSnapshot } from "./check-catalog-supabase-snapshot.mjs";
import { completeSnapshot } from "./catalog-supabase-snapshot-fixtures.mjs";

const root = join(homedir(),"Library/Application Support/BeautyB2B/pg17-b4-test");
const sql = await readFile(new URL("./catalog-supabase-permission-snapshot.sql",import.meta.url),"utf8");
const migrationSql = await readFile(new URL("./catalog-supabase-migration-history.sql",import.meta.url),"utf8");
const baseVersions = ["20261010112952", "20261011120000", "20261013120000", "20261018120000"];
const readerVersion = "20261020120000";

// A complete metadata-only baseline lets the CLI's PASS decision be tested
// without representing the intentionally divergent local cluster as Supabase.

async function runCheckerCli(rows, stage, versions) {
  const directory = await mkdtemp(join(tmpdir(),"beauty-catalog-snapshot-"));
  try {
    const snapshotPath = join(directory,"snapshot.jsonl");
    const historyPath = join(directory,"versions.txt");
    await writeFile(snapshotPath,rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
    if (versions !== null) await writeFile(historyPath,versions.join("\n") + "\n");
    const args = [new URL("./check-catalog-supabase-snapshot.mjs",import.meta.url).pathname,
      snapshotPath,stage,...(versions === null ? [] : [historyPath])];
    const result = spawnSync(process.execPath,args,{encoding:"utf8"});
    assert.equal(result.error,undefined);
    assert.equal(result.stderr,"");
    return {status:result.status,...JSON.parse(result.stdout)};
  } finally { await rm(directory,{recursive:true,force:true}); }
}

test("pre and post migration history gates return the correct CLI decision and exit code", async () => {
  const scenarios = [
    ["pre",baseVersions,"PASS",0,null],
    ["pre",[...baseVersions,readerVersion],"BLOCKED",1,"READ_ROLE_MIGRATION_ALREADY_APPLIED"],
    ["post",[...baseVersions,readerVersion],"PASS",0,null],
    ["post",baseVersions,"BLOCKED",1,"MISSING_MIGRATION"],
    ["post",[...baseVersions.slice(1),readerVersion],"BLOCKED",1,"MISSING_MIGRATION"],
    ["post",null,"BLOCKED",1,"MIGRATION_HISTORY_UNVERIFIED"],
    ["post",[...baseVersions,readerVersion,"not-a-version"],"BLOCKED",1,"MIGRATION_HISTORY_INVALID"],
    ["post",[...baseVersions,readerVersion,readerVersion],"BLOCKED",1,"MIGRATION_HISTORY_INVALID"],
  ];
  for (const [stage,versions,decision,status,code] of scenarios) {
    const result = await runCheckerCli(completeSnapshot(stage),stage,versions);
    assert.equal(result.status,status,`${stage}: ${JSON.stringify(versions)}: ${JSON.stringify(result.findings)}`);
    assert.equal(result.decision,decision);
    if (code) assert.ok(result.findings.some((finding) => finding.code === code));
    else assert.deepEqual(result.findings,[]);
  }
  assert.equal(checkCatalogPermissionSnapshot(completeSnapshot("post"),
    {stage:"post",migrationVersions:"20261020120000"}).decision,"BLOCKED");
});

test("snapshot SQL stays SELECT-only and returns complete metadata from the dedicated cluster", async () => {
  assert.notEqual(process.env.NODE_ENV,"production");
  assert.equal(process.env.RUN_LOCAL_CATALOG_SNAPSHOT_TESTS,"1");
  assert.equal((await readFile(join(root,"data/PG_VERSION"),"utf8")).trim(),"17");
  assert.equal((sql.match(/;/g) ?? []).length,1);
  assert.equal((migrationSql.match(/;/g) ?? []).length,1);
  assert.match(sql,/^WITH\s/m);
  assert.match(migrationSql,/^SELECT\s/m);
  const client = new pg.Client({host:join(root,"socket"),port:55432,
    user:userInfo().username,database:"beauty_b2b_catalog_test",connectionTimeoutMillis:2000});
  await client.connect();
  try {
    const target = (await client.query(`SELECT current_database() db,
      current_setting('data_directory') data,current_setting('port') port,
      current_setting('listen_addresses') listen`)).rows[0];
    assert.deepEqual(target,{db:"beauty_b2b_catalog_test",data:join(root,"data"),
      port:"55432",listen:"127.0.0.1"});
    await client.query("BEGIN READ ONLY");
    try {
      const rows = (await client.query(sql)).rows.map((r) => r.snapshot_row);
      const sections = new Set(rows.map((r) => r.section));
      for (const name of ["database","migration_registry","schema","relation","policy",
        "database_acl","schema_acl","relation_acl","role","function",
        "function_acl","function_effective","effective_database","effective_schema",
        "effective_relation"]) assert.ok(sections.has(name),`missing ${name}`);
      const inventory = rows.find((r) => r.section === "permission_inventory")?.data;
      assert.equal(inventory?.role_count,rows.filter((r) => r.section === "role").length);
      assert.equal(inventory?.business_object_count,
        rows.filter((r) => r.section === "business_object").length);
      assert.equal(inventory?.snapshot_row_count,rows.length);
      for (const membership of rows.filter((r) => r.section === "membership"))
        for (const field of ["admin_option","inherit_option","set_option"])
          assert.equal(typeof membership.data[field],"boolean",`${membership.item}:${field}`);
      assert.equal(rows.filter((r) => r.section === "relation").length,14);
      assert.equal(rows.find((r) => r.section === "role" &&
        r.item === "catalog_admin_reader_runtime")?.data?.login,true);
      assert.equal((await client.query("SHOW transaction_read_only")).rows[0].transaction_read_only,"on");
      assert.equal((await client.query("SELECT txid_current_if_assigned() AS id")).rows[0].id,null);

      const baseline = checkCatalogPermissionSnapshot(rows,{stage:"post"});
      assert.equal(baseline.decision,"BLOCKED");
      assert.ok(baseline.findings.some((f) => f.code === "MISSING_MIGRATION_REGISTRY"));
      assert.ok(baseline.findings.some((f) => f.code === "UNKNOWN_PRIVATE_FUNCTION"));
      const codes = (mutated) => new Set(checkCatalogPermissionSnapshot(mutated,{stage:"post"}).findings.map((f) => f.code));
      const append = (row) => [...rows,row];
      assert.ok(codes(append({section:"function",item:"catalog_private.unknown()",
        data:{canonical_signature:"catalog_private.unknown()",owner:"synthetic"}}))
        .has("UNKNOWN_PRIVATE_FUNCTION"));
      assert.ok(codes(append({section:"function_acl",item:"synthetic-purge:catalog_admin:EXECUTE",
        data:{signature:"catalog_private.purge_due_catalog_receipt_results(p_limit integer)",
          grantee:"catalog_admin",privilege:"EXECUTE"}})).has("UNKNOWN_FUNCTION_GRANTEE"));
      assert.ok(codes(append({section:"membership",item:"catalog_admin_reader_runtime->catalog_import",
        data:{member:"catalog_admin_reader_runtime",parent:"catalog_import"}}))
        .has("UNREVIEWED_ROLE_MEMBERSHIP"));
      assert.ok(codes(append({section:"function_effective",
        item:"catalog_private.product_row_guard():synthetic_other_role",
        data:{signature:"catalog_private.product_row_guard()",role:"synthetic_other_role",
          execute:true,schema_usage:true}})).has("UNKNOWN_FUNCTION_CALLER"));
      const changedRls = rows.map((r) => r.section === "relation" &&
        r.item === "catalog_private.products" ? {...r,data:{...r.data,rls_enabled:false}} : r);
      assert.ok(codes(changedRls).has("RLS_DISABLED"));
      const missingObject = rows.map((r) => r.section === "relation" &&
        r.item === "catalog_public.products" ? {...r,data:{...r.data,exists:false}} : r);
      assert.ok(codes(missingObject).has("MISSING_PUBLIC_VIEW"));
      assert.ok(codes(rows.filter((r) => r.section !== "function" ||
        !r.item.startsWith("catalog_private.product_row_guard("))).has("MISSING_FOUNDATION_FUNCTION"));
      assert.ok(new Set(checkCatalogPermissionSnapshot(rows,{stage:"pre",
        migrationVersions:["20261010112952"]}).findings.map((f) => f.code))
        .has("MISSING_MIGRATION"));
      assert.ok(codes(append({section:"function",
        item:"catalog_private.purge_due_catalog_receipt_results(p_limit integer)",
        data:{canonical_signature:"catalog_private.purge_due_catalog_receipt_results(integer)",
          owner:"unexpected_owner",security_definer:true,
          search_path:["search_path=pg_catalog, pg_temp"]}}))
        .has("RECEIPT_FUNCTION_IDENTITY"));
    } finally { await client.query("ROLLBACK"); }
  } finally { await client.end(); }
});
