// Synthetic metadata only. The sole writes are temporary fixture files; no network or SQL.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile, readFile, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { SECTIONS } from "./catalog-a6-evidence-validator.mjs";
import { mapCatalogA6LegacyRows, validateCatalogA6LegacyAdapter } from
  "./catalog-a6-legacy-adapter.mjs";

const sha = (value) => createHash("sha256").update(value).digest("hex");
const row = (section,item,data) => ({section,item,row_key:`${section}:${item}`,data});
const role = (name,oid) => row("role",name,{role_name:name,role_oid:oid,connection_limit:-1,
  login:false,inherit:false,superuser:false,bypass_rls:false,create_db:false,
  create_role:false,replication:false});
const edge = (id="42",grantor="postgres",grantorOid="10") => row("membership",id,{
  membership_oid:id,member:"normal",member_oid:"11",parent:"postgres",parent_oid:"10",
  grantor,grantor_oid:grantorOid,member_name_resolved:true,parent_name_resolved:true,
  grantor_name_resolved:true,admin_option:false,inherit_option:true,set_option:false});
const mapRows = () => [role("postgres","10"),role("normal","11"),edge(),
  row("schema_acl","acl-1",{schema:"public",schema_oid:"2200",owner:"postgres",
    owner_oid:"10",acl_source:"EXPLICIT",grantee:"PUBLIC",grantee_oid:"0",
    grantor:"postgres",grantor_oid:"10",privilege:"USAGE",grantable:false})];
const find = (result,code) => result.findings.some((f) => f.code === code);

test("normal mapping retains every row and ACL field", () => {
  const source = mapRows(), result = mapCatalogA6LegacyRows(source);
  assert.equal(result.status,"MAPPED_UNTRUSTED");
  assert.equal(result.rows.length,source.length);
  assert.deepEqual(result.rows[3],source[3]);
  assert.equal(source[2].item,"42");
});
test("membership OID key maps to logical key without losing source OID", () => {
  const result = mapCatalogA6LegacyRows(mapRows()).rows[2];
  assert.equal(result.item,"normal->postgres");
  assert.equal(result.row_key,"membership:normal->postgres");
  assert.equal(result.source_item,"42");
  assert.equal(result.source_row_key,"membership:42");
  assert.equal(result.data.membership_oid,"42");
});
test("grantor and all three options survive mapping", () => {
  const result = mapCatalogA6LegacyRows(mapRows()).rows[2].data;
  assert.deepEqual([result.grantor,result.grantor_oid,result.admin_option,
    result.inherit_option,result.set_option],["postgres","10",false,true,false]);
});
test("missing member field blocks", () => {
  const rows = mapRows(); delete rows[2].data.member;
  assert.equal(mapCatalogA6LegacyRows(rows).status,"BLOCKED");
});
test("missing option blocks without defaulting", () => {
  const rows = mapRows(); delete rows[2].data.set_option;
  assert.equal(mapCatalogA6LegacyRows(rows).status,"BLOCKED");
});
test("different membership OIDs with one logical identifier block", () => {
  const rows = mapRows(); rows.push(edge("43"));
  assert.ok(find(mapCatalogA6LegacyRows(rows),"MEMBERSHIP_MAPPING_CONFLICT"));
});
test("different grantors on one logical membership block", () => {
  const rows = mapRows(); rows.push(role("other","12"),edge("43","other","12"));
  assert.ok(find(mapCatalogA6LegacyRows(rows),"MEMBERSHIP_MAPPING_CONFLICT"));
});
test("OID/name conflict blocks", () => {
  const rows = mapRows(); rows[2].data.member_oid="10";
  assert.ok(find(mapCatalogA6LegacyRows(rows),"MEMBERSHIP_IDENTITY_INVALID"));
});
test("duplicate OID identity blocks", () => {
  const rows = mapRows(); rows[1].data.role_oid="10";
  assert.ok(find(mapCatalogA6LegacyRows(rows),"ROLE_IDENTITY_CONFLICT"));
});
test("duplicate row identifier blocks", () => {
  const rows = mapRows(); rows.push(structuredClone(rows[3]));
  assert.ok(find(mapCatalogA6LegacyRows(rows),"DUPLICATE_IDENTIFIER"));
});
test("unknown section blocks", () => {
  assert.ok(find(mapCatalogA6LegacyRows([...mapRows(),row("unknown","x",{})]),
    "UNKNOWN_SECTION"));
});
test("missing ACL field blocks without filling a default", () => {
  const rows=mapRows(); delete rows[3].data.grantable;
  assert.ok(find(mapCatalogA6LegacyRows(rows),"ACL_FIELD_MISSING"));
});

const projectRef = "aaaaaaaaaaaaaaaaaaaa";
const sql = "SELECT synthetic_snapshot_row;\n"; // Text only; never executed.
const csv = (rows) => "snapshot_row\n"+rows.map((r) =>
  `"${JSON.stringify(r).replaceAll('"','""')}"`).join("\n")+"\n";
const jsonl = (rows) => rows.map((r) => JSON.stringify(r)).join("\n")+"\n";

function completeRows() {
  const rows = [
    row("database","postgres",{name:"postgres",server_version:"17.11",database_oid:"5",
      current_user:"postgres",session_user:"postgres",captured_at_utc:"2026-11-09T03:49:32.000Z",
      owner:"postgres",owner_oid:"10",encoding:"UTF8"}),
    row("business_inventory","catalog-rfq-admin-prefixes",{complete:true}),
    row("permission_inventory","database-acl-and-membership",{complete:true,
      membership_count:0,database_acl_count:0,public_schema_acl_count:0,role_count:0,
      business_object_count:0,snapshot_row_count:0,duplicate_row_key_count:0,
      null_row_key_count:0}),
    row("migration_registry","supabase_migrations.schema_migrations",{exists:false}),
    row("schema","public",{exists:true,schema_oid:"2200",owner_oid:"10",owner:"postgres"}),
    row("database_acl_state","5",{database:"postgres",database_oid:"5",owner_oid:"10",
      acl_is_null:false,acl_source:"EXPLICIT",explicit_acl_entry_count:1}),
    row("database_acl","5:0:10:CONNECT",{database:"postgres",database_oid:"5",
      owner:"postgres",owner_oid:"10",acl_source:"EXPLICIT",grantee:"PUBLIC",
      grantee_oid:"0",grantor:"postgres",grantor_oid:"10",privilege:"CONNECT",
      grantable:false}),
    row("database_builtin_acl","5:0:10:CONNECT",{database:"postgres",database_oid:"5",
      acl_source:"BUILTIN_REFERENCE",grantee:"PUBLIC",grantee_oid:"0",
      grantor:"postgres",grantor_oid:"10",privilege:"CONNECT",grantable:false}),
    row("public_database_privilege","5",{database:"postgres",database_oid:"5",
      acl_source:"EXPLICIT",connect:true,create:false,temp:false}),
    row("schema_acl_state","public",{schema:"public",schema_oid:"2200",exists:true,
      owner_oid:"10",acl_is_null:false,acl_source:"EXPLICIT",explicit_acl_entry_count:1}),
    row("schema_acl","2200:0:10:USAGE",{schema:"public",schema_oid:"2200",
      owner:"postgres",owner_oid:"10",acl_source:"EXPLICIT",grantee:"PUBLIC",
      grantee_oid:"0",grantor:"postgres",grantor_oid:"10",privilege:"USAGE",
      grantable:false}),
    row("public_schema_privilege","public",{schema:"public",schema_oid:"2200",
      exists:true,acl_source:"EXPLICIT",usage:true,create:false}),
    row("default_acl_state","postgres",{explicit_default_acl_record_count:0,
      explicit_default_acl_entry_count:0,zero_entries_mean_builtin_rules_still_apply:true}),
    row("default_acl_builtin","10:f:0:10:EXECUTE",{creator:"postgres",creator_oid:"10",
      schema:null,scope:"ALL_SCHEMAS",object_type:"f",
      acl_source:"BUILTIN_REFERENCE_NOT_EFFECTIVE_DEFAULT",grantee:"PUBLIC",
      grantee_oid:"0",grantor:"postgres",grantor_oid:"10",privilege:"EXECUTE",
      grantable:false}),
    row("snapshot_contract","catalog-a6-scheme-b-v1",{version:"catalog-a6-scheme-b-v1",
      project_ref_source:"EXTERNAL_DASHBOARD_EVIDENCE_REQUIRED",
      raw_export_completeness:"UNVERIFIED",execution_provenance:"UNVERIFIED"}),
    role("postgres","10"),
    row("effective_database","postgres",{role:"postgres",role_oid:"10",role_exists:true,
      connect:true,create:true,temp:false}),
    row("effective_schema","postgres:public",{role:"postgres",schema:"public",role_oid:"10",
      schema_oid:"2200",role_exists:true,schema_exists:true,usage:true,create:true}),
  ];
  const count = (s) => rows.filter((r) => r.section === s).length;
  Object.assign(rows[2].data,{membership_count:count("membership"),
    database_acl_count:count("database_acl"),public_schema_acl_count:count("schema_acl"),
    role_count:count("role"),business_object_count:count("business_object"),
    snapshot_row_count:rows.length+SECTIONS.length});
  return [...rows,...SECTIONS.map((s) => row("section_inventory",s,{section:s,
    row_count:s === "section_inventory" ? SECTIONS.length : count(s),
    is_empty:s !== "section_inventory" && count(s) === 0}))];
}

async function fixture(t) {
  const temp = await mkdtemp(path.join(tmpdir(),"catalog-a6-legacy-"));
  t.after(() => rm(temp,{recursive:true,force:true}));
  const bundle = path.join(temp,"bundle"), policyFile = path.join(temp,"policy.json");
  for (const dir of ["approved","records","raw","exports"])
    await mkdir(path.join(bundle,dir),{recursive:true});
  const historyBundle=path.join(temp,"history"),
    historyPolicyFile=path.join(temp,"history-policy.json");
  for (const dir of ["approved","records","raw","exports"])
    await mkdir(path.join(historyBundle,dir),{recursive:true});
  const f = {bundle,policyFile,rows:completeRows(),anchor:"",historyBundle,
    historyPolicyFile,historyAnchor:"",historyVersions:[]};
  f.write = async () => {
    const raw = csv(f.rows), converted = jsonl(f.rows);
    const policy = {kind:"CATALOG_A6_EVIDENCE_POLICY_V1",projectRef,
      databaseName:"postgres",postgresVersion:"17.11",identity:{operator:"synthetic",
        currentUser:"postgres",sessionUser:"postgres"},queries:[{id:"snapshot",
        version:"catalog-a6-scheme-b-v1",sqlSha256:sha(sql)}]};
    const entry = {id:"snapshot",version:"catalog-a6-scheme-b-v1",
      approvedSqlFile:"approved/snapshot.sql",approvedSqlSha256:sha(sql),
      recordFile:"records/snapshot.json",recordSha256:"",
      rawExportFile:"raw/snapshot.csv",rawExportSha256:sha(raw),
      rawExportSourceId:"synthetic",jsonlFile:"exports/snapshot.jsonl",
      jsonlSha256:sha(converted),rowCount:f.rows.length,columns:["snapshot_row"],truncated:false};
    const record = {queryId:"snapshot",executionId:"synthetic",projectRef,
      databaseName:"postgres",postgresVersion:"17.11",operator:"synthetic",
      currentUser:"postgres",sessionUser:"postgres",executedAtUtc:"2026-11-09T03:49:32.000Z",
      success:true,sqlVersion:"catalog-a6-scheme-b-v1",executedSql:sql,
      executedSqlSha256:sha(sql),rawExportFile:entry.rawExportFile,
      rawExportSha256:entry.rawExportSha256,rawExportSourceId:entry.rawExportSourceId,
      jsonlFile:entry.jsonlFile,jsonlSha256:entry.jsonlSha256,rowCount:entry.rowCount,
      columns:entry.columns,truncated:false};
    const recordText = JSON.stringify(record); entry.recordSha256=sha(recordText);
    const manifest = {kind:"CATALOG_A6_EVIDENCE_BUNDLE_V1",projectRef,
      databaseName:"postgres",postgresVersion:"17.11",queries:[entry]};
    const policyText = JSON.stringify(policy); f.anchor=sha(policyText);
    await Promise.all([
      writeFile(policyFile,policyText),writeFile(path.join(bundle,"manifest.json"),
        JSON.stringify(manifest)),writeFile(path.join(bundle,entry.approvedSqlFile),sql),
      writeFile(path.join(bundle,entry.recordFile),recordText),
      writeFile(path.join(bundle,entry.rawExportFile),raw),
      writeFile(path.join(bundle,entry.jsonlFile),converted),
    ]);
    if (f.writeHistory) await f.writeHistory();
  };
  f.writeHistory=async () => {
    const historySql="SELECT version FROM supabase_migrations.schema_migrations ORDER BY version;\n";
    const raw=`version\n${f.historyVersions.map((v) => `${v}\n`).join("")}`;
    const converted=f.historyVersions.map((v) => JSON.stringify({version:v})+"\n").join("");
    const snapshotManifest=await readFile(path.join(bundle,"manifest.json"));
    const snapshotJsonl=await readFile(path.join(bundle,"exports/snapshot.jsonl"));
    const policy={kind:"CATALOG_A6_HISTORY_POLICY_V1",projectRef,
      databaseName:"postgres",postgresVersion:"17.11",identity:{operator:"synthetic",
        currentUser:"postgres",sessionUser:"postgres"},queries:[{id:"migration_history",
        version:"catalog-a6-migration-history-v1",sqlSha256:sha(historySql)}]};
    const entry={id:"migration_history",version:"catalog-a6-migration-history-v1",
      approvedSqlFile:"approved/history.sql",approvedSqlSha256:sha(historySql),
      recordFile:"records/history.json",recordSha256:"",rawExportFile:"raw/history.csv",
      rawExportSha256:sha(raw),jsonlFile:"exports/history.jsonl",jsonlSha256:sha(converted),
      rowCount:f.historyVersions.length,columns:["version"],truncated:false,
      exportId:"synthetic-history-export"};
    const manifest={kind:"CATALOG_A6_HISTORY_BUNDLE_V1",projectRef,databaseName:"postgres",
      postgresVersion:"17.11",snapshotManifestSha256:sha(snapshotManifest),
      snapshotJsonlSha256:sha(snapshotJsonl),queries:[entry]};
    const record={queryId:entry.id,executionId:"synthetic-history-execution",projectRef,
      databaseName:"postgres",postgresVersion:"17.11",operator:"synthetic",
      currentUser:"postgres",sessionUser:"postgres",executedAtUtc:"2026-11-09T03:49:32.000Z",
      success:true,sqlVersion:entry.version,executedSql:historySql,
      executedSqlSha256:sha(historySql),rawExportFile:entry.rawExportFile,
      rawExportSha256:entry.rawExportSha256,jsonlFile:entry.jsonlFile,
      jsonlSha256:entry.jsonlSha256,rowCount:entry.rowCount,columns:entry.columns,
      truncated:false,exportId:entry.exportId,
      snapshotManifestSha256:manifest.snapshotManifestSha256,
      snapshotJsonlSha256:manifest.snapshotJsonlSha256};
    const recordText=JSON.stringify(record); entry.recordSha256=sha(recordText);
    const policyText=JSON.stringify(policy); f.historyAnchor=sha(policyText);
    await Promise.all([writeFile(historyPolicyFile,policyText),
      writeFile(path.join(historyBundle,"manifest.json"),JSON.stringify(manifest)),
      writeFile(path.join(historyBundle,entry.approvedSqlFile),historySql),
      writeFile(path.join(historyBundle,entry.recordFile),recordText),
      writeFile(path.join(historyBundle,entry.rawExportFile),raw),
      writeFile(path.join(historyBundle,entry.jsonlFile),converted)]);
  };
  await f.write();
  return f;
}
const run = (f,options={}) => validateCatalogA6LegacyAdapter({bundleDirectory:f.bundle,
  policyFile:f.policyFile,expectedPolicySha256:f.anchor,stage:"empty",
  adminIdentity:"absent",historyBundleDirectory:f.historyBundle,
  historyPolicyFile:f.historyPolicyFile,
  expectedHistoryPolicySha256:f.historyAnchor,...options});

test("missing stage blocks before checker", async (t) => {
  const f = await fixture(t); assert.ok(find(await run(f,{stage:undefined}),"STAGE_INVALID"));
});
test("missing independent B1 anchor blocks", async (t) => {
  const f = await fixture(t); assert.ok(find(await run(f,{expectedPolicySha256:undefined}),
    "EVIDENCE_ANCHOR_MISSING"));
});
test("B1 rejection blocks arbitrary changed JSONL", async (t) => {
  const f = await fixture(t);
  await writeFile(path.join(f.bundle,"exports/snapshot.jsonl"),"{}\n");
  assert.ok(find(await run(f,{mode:"synthetic"}),"EVIDENCE_BLOCKED"));
});
test("formal mode uses history evidence but old BLOCK stays BLOCKED", async (t) => {
  const f = await fixture(t);
  const out = await run(f);
  assert.equal(out.status,"BLOCKED");
  assert.equal(out.legacyCheckerStatus,"LEGACY_BLOCKED");
  assert.ok(out.historyBinding);
});
test("missing history anchor blocks", async (t) => {
  const f = await fixture(t);
  assert.ok(find(await run(f,{mode:"synthetic",expectedHistoryPolicySha256:undefined}),
    "HISTORY_ANCHOR_MISSING"));
});
test("legacy BLOCK remains BLOCKED, including missing stage objects", async (t) => {
  const f = await fixture(t);
  const out = await run(f,{mode:"synthetic"});
  assert.equal(out.status,"BLOCKED");
  assert.equal(out.legacyCheckerStatus,"LEGACY_BLOCKED");
  assert.ok(out.findings.length > 0);
});
test("PUBLIC TEMP is not relaxed", async (t) => {
  const f = await fixture(t);
  f.rows.find((r) => r.section === "database_acl").data.privilege="TEMPORARY";
  f.rows.find((r) => r.section === "public_database_privilege").data.temp=true;
  await f.write();
  const out = await run(f,{mode:"synthetic"});
  assert.ok(find(out,"PUBLIC_DATABASE_CREATE_OR_TEMP"));
});
test("PUBLIC CREATE is not relaxed", async (t) => {
  const f = await fixture(t);
  f.rows.find((r) => r.section === "database_acl").data.privilege="CREATE";
  f.rows.find((r) => r.section === "public_database_privilege").data.create=true;
  await f.write();
  const out = await run(f,{mode:"synthetic"});
  assert.ok(find(out,"PUBLIC_DATABASE_CREATE_OR_TEMP"));
});
test("Admin Read runtime TEMP true cannot pass", async (t) => {
  const f = await fixture(t);
  f.rows.find((r) => r.section === "migration_registry").data.exists=true;
  f.historyVersions=["20261013120000","20261018120000","20261020120000"];
  f.rows.push(role("catalog_admin_reader_runtime","11"));
  f.rows.push(row("effective_database","catalog_admin_reader_runtime",{
    role:"catalog_admin_reader_runtime",role_oid:"11",role_exists:true,
    connect:true,create:false,temp:true}));
  f.rows.push(row("effective_schema","catalog_admin_reader_runtime:public",{
    role:"catalog_admin_reader_runtime",schema:"public",role_oid:"11",
    schema_oid:"2200",role_exists:true,schema_exists:true,usage:false,create:false}));
  f.rows.find((r) => r.section === "permission_inventory").data.role_count++;
  f.rows.find((r) => r.section === "permission_inventory").data.snapshot_row_count += 3;
  for (const section of ["role","effective_database","effective_schema"]) {
    const inventory=f.rows.find((r) => r.section === "section_inventory" && r.item === section);
    inventory.data.row_count++; inventory.data.is_empty=false;
  }
  await f.write();
  const out = await run(f,{mode:"synthetic",stage:"admin-read",adminIdentity:"present"});
  assert.equal(out.status,"BLOCKED");
  assert.equal(out.legacyCheckerStatus,"LEGACY_BLOCKED");
  assert.ok(find(out,"READER_DATABASE_PRIVILEGES"));
});

test("verified empty history is bound to the same snapshot", async (t) => {
  const f=await fixture(t),out=await run(f,{mode:"synthetic"});
  assert.equal(out.legacyCheckerStatus,"LEGACY_BLOCKED");
  assert.equal(out.historyBinding.snapshotJsonlSha256,
    sha(await readFile(path.join(f.bundle,"exports/snapshot.jsonl"))));
  assert.equal(out.historyBinding.snapshotManifestSha256,
    sha(await readFile(path.join(f.bundle,"manifest.json"))));
  assert.equal(out.historyBinding.stage,"empty");
});
test("history Manifest cannot claim another snapshot", async (t) => {
  const f=await fixture(t);
  const file=path.join(f.historyBundle,"manifest.json");
  const manifest=JSON.parse(await readFile(file,"utf8"));
  manifest.snapshotManifestSha256="0".repeat(64);
  await writeFile(file,JSON.stringify(manifest));
  const out=await run(f,{mode:"synthetic"});
  assert.equal(out.legacyCheckerStatus,"NOT_INTEGRATED");
  assert.ok(find(out,"HISTORY_MANIFEST_INVALID"));
});
test("snapshot JSONL replacement blocks before legacy invocation", async (t) => {
  const f=await fixture(t);
  await writeFile(path.join(f.bundle,"exports/snapshot.jsonl"),"{}\n");
  const out=await run(f,{mode:"synthetic"});
  assert.equal(out.legacyCheckerStatus,"NOT_INTEGRATED");
  assert.ok(find(out,"EVIDENCE_BLOCKED"));
});
test("history file replacement blocks with B1 reason", async (t) => {
  const f=await fixture(t);
  await writeFile(path.join(f.historyBundle,"raw/history.csv"),"version\n20261013120000\n");
  const out=await run(f,{mode:"synthetic"});
  assert.equal(out.legacyCheckerStatus,"NOT_INTEGRATED");
  assert.ok(find(out,"HISTORY_RAW_HASH_MISMATCH"));
});
test("caller-supplied versions cannot replace B1 history", async (t) => {
  const f=await fixture(t);
  const out=await run(f,{mode:"synthetic",syntheticMigrationVersions:[]});
  assert.equal(out.legacyCheckerStatus,"NOT_INTEGRATED");
  assert.ok(find(out,"CALLER_HISTORY_FORBIDDEN"));
});
test("duplicate history version blocks before legacy invocation", async (t) => {
  const f=await fixture(t);
  f.rows.find((r) => r.section === "migration_registry").data.exists=true;
  f.historyVersions=["20261013120000","20261013120000"];
  await f.write();
  const out=await run(f,{mode:"synthetic",stage:"foundation"});
  assert.equal(out.legacyCheckerStatus,"NOT_INTEGRATED");
  assert.ok(find(out,"HISTORY_DUPLICATE_VERSION"));
});
test("invalid history version blocks before legacy invocation", async (t) => {
  const f=await fixture(t);
  f.rows.find((r) => r.section === "migration_registry").data.exists=true;
  f.historyVersions=["bad"];
  await f.write();
  const out=await run(f,{mode:"synthetic",stage:"foundation"});
  assert.equal(out.legacyCheckerStatus,"NOT_INTEGRATED");
  assert.ok(find(out,"HISTORY_VERSION_INVALID"));
});
test("missing history export blocks before legacy invocation", async (t) => {
  const f=await fixture(t);
  await unlink(path.join(f.historyBundle,"raw/history.csv"));
  const out=await run(f,{mode:"synthetic"});
  assert.equal(out.legacyCheckerStatus,"NOT_INTEGRATED");
  assert.ok(find(out,"DECLARED_FILE_MISSING"));
});
test("foundation uses its verified version set", async (t) => {
  const f=await fixture(t);
  f.rows.find((r) => r.section === "migration_registry").data.exists=true;
  f.historyVersions=["20261013120000"];
  await f.write();
  const out=await run(f,{mode:"synthetic",stage:"foundation"});
  assert.equal(out.legacyCheckerStatus,"LEGACY_BLOCKED");
  assert.equal(out.historyBinding.stage,"foundation");
  assert.equal(find(out,"MISSING_MIGRATION"),false);
});
test("Admin Read uses its verified version set", async (t) => {
  const f=await fixture(t);
  f.rows.find((r) => r.section === "migration_registry").data.exists=true;
  f.historyVersions=["20261013120000","20261018120000","20261020120000"];
  await f.write();
  const out=await run(f,{mode:"synthetic",stage:"admin-read",adminIdentity:"present"});
  assert.equal(out.legacyCheckerStatus,"LEGACY_BLOCKED");
  assert.equal(out.historyBinding.stage,"admin-read");
  assert.equal(find(out,"MISSING_MIGRATION"),false);
});
test("Admin Identity cannot be inferred from foundation version", async (t) => {
  const f=await fixture(t);
  f.rows.find((r) => r.section === "migration_registry").data.exists=true;
  f.historyVersions=["20261013120000"];
  await f.write();
  const out=await run(f,{mode:"synthetic",stage:"foundation",adminIdentity:"present"});
  assert.equal(out.legacyCheckerStatus,"NOT_INTEGRATED");
  assert.ok(find(out,"HISTORY_STAGE_MISMATCH"));
});
test("history from another snapshot cannot be reused", async (t) => {
  const source=await fixture(t),target=await fixture(t);
  target.rows.find((r) => r.section === "public_database_privilege").data.create=true;
  await target.write();
  await writeFile(path.join(target.historyBundle,"manifest.json"),
    await readFile(path.join(source.historyBundle,"manifest.json")));
  const out=await run(target,{mode:"synthetic"});
  assert.equal(out.legacyCheckerStatus,"NOT_INTEGRATED");
  assert.ok(find(out,"HISTORY_MANIFEST_INVALID"));
});

function makePassingEmpty(f) {
  const base=f.rows.filter((r) => r.section !== "section_inventory");
  const newRoles=[["anon","11"],["authenticated","12"],["service_role","13"],
    ["authenticator","14"]];
  for (const [who,id] of newRoles) {
    const r=role(who,id); if (who === "authenticator") r.data.login=true;
    base.push(r);
    base.push(row("effective_database",who,{role:who,role_oid:id,role_exists:true,
      connect:true,create:false,temp:false}));
    base.push(row("effective_schema",`${who}:public`,{role:who,schema:"public",
      role_oid:id,schema_oid:"2200",role_exists:true,schema_exists:true,
      usage:true,create:false}));
  }
  const allRoles=[["postgres","10"],...newRoles];
  for (const schema of ["catalog_private","catalog_public","rfq_private","admin_private"]) {
    base.push(row("schema",schema,{exists:false,schema_oid:null,owner_oid:null,owner:null}));
    base.push(row("schema_acl_state",schema,{schema,schema_oid:null,exists:false,
      owner_oid:null,acl_is_null:null,acl_source:"ABSENT",explicit_acl_entry_count:null}));
    base.push(row("public_schema_privilege",schema,{schema,schema_oid:null,
      exists:false,acl_source:"ABSENT",usage:false,create:false}));
    for (const [who,id] of allRoles) base.push(row("effective_schema",`${who}:${schema}`,{
      role:who,schema,role_oid:id,schema_oid:null,role_exists:true,
      schema_exists:false,usage:false,create:false}));
  }
  const count=(section) => base.filter((r) => r.section === section).length;
  const permission=base.find((r) => r.section === "permission_inventory").data;
  Object.assign(permission,{membership_count:count("membership"),
    database_acl_count:count("database_acl"),public_schema_acl_count:base.filter((r) =>
      r.section === "schema_acl" && r.data.schema === "public").length,
    role_count:count("role"),business_object_count:count("business_object"),
    snapshot_row_count:base.length+SECTIONS.length});
  f.rows=[...base,...SECTIONS.map((s) => row("section_inventory",s,{section:s,
    row_count:s === "section_inventory" ? SECTIONS.length : count(s),
    is_empty:s !== "section_inventory" && count(s) === 0}))];
}
test("synthetic legacy PASS does not become formal approval", async (t) => {
  const f=await fixture(t); makePassingEmpty(f); await f.write();
  const synthetic=await run(f,{mode:"synthetic"});
  assert.equal(synthetic.status,"SYNTHETIC_MATCH_ONLY",JSON.stringify(synthetic));
  assert.equal(synthetic.legacyCheckerStatus,"SYNTHETIC_PASS");
  assert.equal(synthetic.sourceAuthentication,"SOURCE_AUTHENTICATION_UNVERIFIED");
  const formal=await run(f);
  assert.equal(formal.status,"BLOCKED");
  assert.equal(formal.legacyCheckerStatus,"INTERNAL_MATCH_ONLY");
  assert.equal(formal.rawExportCompleteness,"RAW_EXPORT_COMPLETENESS_UNVERIFIED");
});
