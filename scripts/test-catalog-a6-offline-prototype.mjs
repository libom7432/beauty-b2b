import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { readStableBundleFile, validateOfflineBundle } from "./catalog-a6-offline-prototype.mjs";
import { completeSnapshot } from "./catalog-supabase-snapshot-fixtures.mjs";

const ref = "syntheticref00000000";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const roleFlags = (login = false) => ({ login, inherit:false, superuser:false,
  bypass_rls:false, create_db:false, create_role:false, replication:false });

function emptyRows(registryExists = false) {
  const rows = [];
  const add = (section,item,data) => rows.push({section,item,data});
  add("database","synthetic_db",{name:"synthetic_db",owner:"synthetic_owner"});
  add("migration_registry","supabase_migrations.schema_migrations",{exists:registryExists});
  for (const name of ["catalog_private","catalog_public","rfq_private","admin_private"])
    add("schema",name,{exists:false});
  add("schema","public",{exists:true,owner:"synthetic_owner"});
  add("business_inventory","catalog-rfq-admin-prefixes",{complete:true});
  for (const name of ["anon","authenticated","service_role","postgres","authenticator"])
    add("role",name,roleFlags(name === "authenticator"));
  add("database_acl","PUBLIC:CONNECT",{grantee:"PUBLIC",privilege:"CONNECT",grantable:false});
  add("schema_acl","public:PUBLIC:USAGE",{schema:"public",grantee:"PUBLIC",
    privilege:"USAGE",grantable:false});
  for (const name of ["anon","authenticated"]) {
    add("effective_database",name,{role:name,connect:true,create:false,temp:false});
    add("effective_schema",`${name}:public`,{role:name,schema:"public",usage:true,create:false});
  }
  return rows;
}

function stageRows(stage) {
  if (stage === "empty") return emptyRows();
  const rows = completeSnapshot(stage === "admin-read" ? "post" : "pre");
  rows.find((row) => row.section === "database").data.owner = "synthetic_owner";
  for (const row of rows.filter((entry) => entry.section === "schema"))
    Object.assign(row.data,{exists:["catalog_private","catalog_public"].includes(row.item),
      owner:"synthetic_owner"});
  rows.push({section:"schema",item:"public",data:{exists:true,owner:"synthetic_owner"}});
  for (const name of ["authenticated","service_role","postgres","authenticator"])
    rows.push({section:"role",item:name,data:roleFlags(name === "authenticator")});
  rows.push({section:"business_inventory",item:"catalog-rfq-admin-prefixes",data:{complete:true}});
  rows.push({section:"database_acl",item:"synthetic_owner:CREATE",
    data:{grantee:"synthetic_owner",privilege:"CREATE",grantable:false}});
  rows.push({section:"schema_acl",item:"public:synthetic_owner:CREATE",
    data:{schema:"public",grantee:"synthetic_owner",privilege:"CREATE",grantable:false}});
  for (const name of ["anon","authenticated"]) {
    if (!rows.some((row) => row.section === "effective_database" && row.item === name))
      rows.push({section:"effective_database",item:name,data:{connect:true,create:false,temp:false}});
    rows.push({section:"effective_schema",item:`${name}:public`,data:{usage:true,create:false}});
  }
  for (const name of ["catalog_private","catalog_public"])
    rows.push({section:"business_object",item:`schema:${name}`,data:{kind:"schema"}});
  for (const name of ["catalog_private","catalog_public"])
    rows.push({section:"schema_acl",item:`${name}:synthetic_owner:USAGE`,
      data:{schema:name,grantee:"synthetic_owner",privilege:"USAGE"}});
  for (const name of ["catalog_private","catalog_public"])
    rows.push({section:"effective_schema",item:`anon:${name}`,
      data:{role:"anon",schema:name,usage:name === "catalog_public",create:false}});
  for (const row of rows.filter((entry) => entry.section === "relation" && entry.data.exists)) {
    rows.push({section:"business_object",item:`relation:${row.item}`,data:{kind:"relation"}});
    rows.push({section:"relation_acl",item:`${row.item}:${row.data.owner}:SELECT`,
      data:{relation:row.item,grantee:row.data.owner,privilege:"SELECT"}});
  }
  for (const row of rows.filter((entry) => entry.section === "function"))
    rows.push({section:"business_object",item:`function:${row.data.canonical_signature}`,
      data:{kind:"function"}});
  return rows;
}

function finishRows(rows) {
  const section = (name) => rows.filter((row) => row.section === name);
  rows.push({section:"permission_inventory",item:"database-acl-and-membership",data:{
    complete:true, membership_count:section("membership").length,
    database_acl_count:section("database_acl").length,
    public_schema_acl_count:section("schema_acl").filter((r) => r.data.schema === "public").length,
    role_count:section("role").length, business_object_count:section("business_object").length,
    snapshot_row_count:rows.length + 1,
  }});
  return rows;
}

async function fixture({ registryExists = false, stage = "empty", adminIdentity = "absent",
  versions = [], mutateRows, mutate, omitFiles = [] } = {}) {
  const directory = await mkdtemp(path.join(tmpdir(),"catalog-a6-offline-"));
  const bundle = path.join(directory,"bundle");
  await mkdir(bundle);
  for (const subdir of ["approved","records","exports"]) await mkdir(path.join(bundle,subdir));
  const policyFile = path.join(directory,"separate-policy.json");
  const rows = stageRows(stage);
  rows.find((row) => row.section === "migration_registry").data.exists = registryExists;
  mutateRows?.(rows);
  finishRows(rows);
  const snapshotSql = "SELECT 1 AS synthetic_metadata;\n"; // Stored and compared, never executed.
  const historySql = "SELECT 1 AS synthetic_version;\n";
  const policy = {kind:"CATALOG_A6_OFFLINE_POLICY_V1",projectRef:ref,stage,adminIdentity,
    approvedIdentity:{operator:"synthetic-operator",currentUser:"synthetic_db_user",
      sessionUser:"synthetic_db_user"},baselineApproval:"NOT_APPROVED",
    sqlSha256:{snapshot:hash(snapshotSql),
      "migration-history":hash(historySql)}};
  const manifest = {kind:"CATALOG_A6_OFFLINE_BUNDLE_V1",projectRef:ref,stage,adminIdentity,
    queries:[]};
  const files = new Map();
  const records = {};
  function addQuery(id,sql,exportContent,rowCount) {
    const approvedSqlFile = `approved/${id}.sql`;
    const executionRecordFile = `records/${id}.json`;
    const exportFile = `exports/${id}.${id === "snapshot" ? "jsonl" : "txt"}`;
    const exportSha256 = hash(exportContent);
    files.set(approvedSqlFile,sql);
    files.set(exportFile,exportContent);
    const record = {queryId:id,executionId:`synthetic-${id}-1`,projectRef:ref,
      operator:"synthetic-operator",currentUser:"synthetic_db_user",
      sessionUser:"synthetic_db_user",executedAtUtc:"2026-11-09T00:00:00.000Z",
      success:true,executedSql:sql,executedSqlSha256:hash(sql),
      exportFile,exportSha256,rowCount};
    records[id] = record;
    manifest.queries.push({id,approvedSqlFile,approvedSqlSha256:hash(sql),
      executionRecordFile,executionRecordSha256:"",exportFile,exportSha256});
  }
  addQuery("snapshot",snapshotSql,rows.map((row) => JSON.stringify(row)).join("\n") + "\n",
    rows.length);
  if (registryExists) addQuery("migration-history",historySql,
    versions.length ? `${versions.join("\n")}\n` : "",versions.length);
  mutate?.({policy,manifest,records,files});
  for (const entry of manifest.queries) if (records[entry.id]) {
    const bytes = JSON.stringify(records[entry.id]);
    files.set(entry.executionRecordFile,bytes);
    entry.executionRecordSha256 = hash(bytes);
  }
  const policyBytes = JSON.stringify(policy);
  await writeFile(policyFile,policyBytes);
  await writeFile(path.join(bundle,"manifest.json"),JSON.stringify(manifest));
  for (const [relative,content] of files) if (!omitFiles.includes(relative))
    await writeFile(path.join(bundle,relative),content);
  return {directory,bundle,policyFile,policySha256:hash(policyBytes)};
}

async function withFixture(t,options) {
  const f = await fixture(options);
  t.after(() => rm(f.directory,{recursive:true,force:true}));
  return validateOfflineBundle(f.bundle,f.policyFile,f.policySha256);
}
const evidenceCodes = (result) => result.evidence.findings.map((f) => f.code);
const securityCodes = (result) => result.security.findings.map((f) => f.code);

test("complete synthetic chain passes evidence while unsigned security baseline blocks", async (t) => {
  const result = await withFixture(t);
  assert.equal(result.scope,"OFFLINE_PROTOTYPE_ONLY");
  assert.equal(result.policyAuthenticity,"UNVERIFIED_OFFLINE_INPUT");
  assert.equal(result.executionAuthenticity,"UNVERIFIED_OFFLINE_RECORD");
  assert.equal(result.evidence.decision,"PASS");
  assert.equal(result.security.checkerDecision,"PASS");
  assert.equal(result.security.decision,"BLOCKED");
  assert.ok(securityCodes(result).includes("BASELINE_NOT_APPROVED"));
});

test("all queries must use the independently pinned operator and database identity", async (t) => {
  const cases = [
    ["operator", "unexpected-operator"],
    ["currentUser", "unexpected_db_user"],
    ["sessionUser", "unexpected_session_user"],
  ];
  for (const [field,value] of cases) {
    const result = await withFixture(t,{mutate:({records}) => { records.snapshot[field] = value; }});
    assert.equal(result.evidence.decision,"BLOCKED",field);
    assert.ok(evidenceCodes(result).includes("EXECUTION_IDENTITY_MISMATCH"),field);
  }
  const missing = await withFixture(t,{mutate:({records}) => { delete records.snapshot.operator; }});
  assert.ok(evidenceCodes(missing).includes("EXECUTION_IDENTITY_MISSING"));
  const twoQueries = await withFixture(t,{registryExists:true,mutate:({records}) => {
    records["migration-history"].currentUser = "different_db_user";
  }});
  assert.ok(evidenceCodes(twoQueries).includes("EXECUTION_IDENTITY_MISMATCH"));
});

test("policy bytes require an independent SHA-256 anchor", async (t) => {
  const f = await fixture();
  t.after(() => rm(f.directory,{recursive:true,force:true}));
  const missingAnchor = await validateOfflineBundle(f.bundle,f.policyFile);
  assert.ok(evidenceCodes(missingAnchor).includes("POLICY_ANCHOR_MISSING"));
  const policy = JSON.parse(await readFile(f.policyFile,"utf8"));
  policy.approvedIdentity.operator = "altered-operator";
  await writeFile(f.policyFile,JSON.stringify(policy));
  const altered = await validateOfflineBundle(f.bundle,f.policyFile,f.policySha256);
  assert.equal(altered.evidence.decision,"BLOCKED");
  assert.ok(evidenceCodes(altered).includes("POLICY_HASH_MISMATCH"));
});

test("approved SQL policy hash mismatch blocks evidence", async (t) => {
  const result = await withFixture(t,{mutate:({policy}) => { policy.sqlSha256.snapshot = "0".repeat(64); }});
  assert.ok(evidenceCodes(result).includes("SQL_HASH_POLICY_MISMATCH"));
});

test("actual executed SQL text differing from approved bytes blocks evidence", async (t) => {
  const result = await withFixture(t,{mutate:({records}) => {
    records.snapshot.executedSql = "SELECT 2 AS synthetic_metadata;\n";
    records.snapshot.executedSqlSha256 = hash(records.snapshot.executedSql);
  }});
  assert.ok(evidenceCodes(result).includes("EXECUTED_SQL_DIFFERS"));
});

test("missing UTC execution time blocks evidence", async (t) => {
  const result = await withFixture(t,{mutate:({records}) => { delete records.snapshot.executedAtUtc; }});
  assert.ok(evidenceCodes(result).includes("UTC_TIME_MISSING_OR_INVALID"));
});

test("missing export and wrong export hash each block", async (t) => {
  const missing = await withFixture(t,{omitFiles:["exports/snapshot.jsonl"]});
  assert.ok(evidenceCodes(missing).includes("EXPORT_MISSING"));
  const wrong = await withFixture(t,{mutate:({manifest}) => {
    manifest.queries[0].exportSha256 = "f".repeat(64);
  }});
  assert.ok(evidenceCodes(wrong).includes("EXPORT_HASH_MISMATCH"));
});

test("duplicate or missing snapshot query blocks", async (t) => {
  const duplicate = await withFixture(t,{mutate:({manifest}) => {
    manifest.queries.push({...manifest.queries[0]});
  }});
  assert.ok(evidenceCodes(duplicate).includes("DUPLICATE_QUERY"));
  const missing = await withFixture(t,{mutate:({manifest}) => { manifest.queries = []; }});
  assert.ok(evidenceCodes(missing).includes("MISSING_QUERY"));
});

test("Project Ref disagreement blocks evidence", async (t) => {
  const result = await withFixture(t,{mutate:({policy}) => {
    policy.projectRef = "differentref00000000";
  }});
  assert.ok(evidenceCodes(result).includes("PROJECT_REF_MISMATCH"));
});

test("empty absent permits no migration registry and no history query", async (t) => {
  const result = await withFixture(t,{registryExists:false,stage:"empty",adminIdentity:"absent"});
  assert.equal(result.evidence.decision,"PASS");
  assert.equal(result.security.checkerDecision,"PASS");
  assert.ok(!securityCodes(result).includes("MISSING_MIGRATION_REGISTRY"));
  assert.ok(!securityCodes(result).includes("MIGRATION_HISTORY_INVALID"));
});

test("all three Catalog-only phases have complete positive synthetic snapshots", async (t) => {
  const empty = await withFixture(t,{stage:"empty",adminIdentity:"absent"});
  assert.equal(empty.evidence.decision,"PASS");
  assert.equal(empty.security.checkerDecision,"PASS",JSON.stringify(empty.security.findings));
  assert.equal(empty.security.decision,"BLOCKED");
  const foundation = await withFixture(t,{registryExists:true,stage:"foundation",
    versions:["20261013120000"]});
  assert.equal(foundation.evidence.decision,"PASS");
  assert.equal(foundation.security.checkerDecision,"PASS",JSON.stringify(foundation.security.findings));
  assert.equal(foundation.security.decision,"BLOCKED");
  const adminRead = await withFixture(t,{registryExists:true,stage:"admin-read",
    versions:["20261013120000","20261020120000"]});
  assert.equal(adminRead.evidence.decision,"PASS");
  assert.equal(adminRead.security.checkerDecision,"PASS",JSON.stringify(adminRead.security.findings));
  assert.equal(adminRead.security.decision,"BLOCKED");
  const missingVersion = await withFixture(t,{registryExists:true,stage:"admin-read",
    versions:["20261013120000"]});
  assert.ok(securityCodes(missingVersion).includes("MISSING_MIGRATION"));
});

test("unknown role and PUBLIC TEMP remain security blockers", async (t) => {
  const result = await withFixture(t,{mutateRows:(rows) => {
    rows.push({section:"role",item:"unknown_custom_role",data:roleFlags()});
    rows.push({section:"database_acl",item:"PUBLIC:TEMPORARY",data:{grantee:"PUBLIC",
      privilege:"TEMPORARY",grantable:false}});
  }});
  assert.equal(result.evidence.decision,"PASS");
  assert.ok(securityCodes(result).includes("UNKNOWN_BUSINESS_ROLE"));
  assert.ok(securityCodes(result).includes("PUBLIC_DATABASE_CREATE_OR_TEMP"));
  assert.equal(result.security.decision,"BLOCKED");
});

test("unknown membership edge and database CREATE remain security blockers", async (t) => {
  const result = await withFixture(t,{mutateRows:(rows) => {
    rows.push({section:"membership",item:"authenticator->service_role",data:{
      member:"authenticator",parent:"service_role",admin_option:false,
      inherit_option:false,set_option:true}});
    rows.push({section:"database_acl",item:"PUBLIC:CREATE",data:{
      grantee:"PUBLIC",privilege:"CREATE",grantable:false}});
  }});
  assert.equal(result.evidence.decision,"PASS");
  assert.ok(securityCodes(result).includes("UNREVIEWED_ROLE_MEMBERSHIP"));
  assert.ok(securityCodes(result).includes("PUBLIC_DATABASE_CREATE_OR_TEMP"));
});

test("failed query and record/export mapping conflict block evidence", async (t) => {
  const result = await withFixture(t,{mutate:({records}) => {
    records.snapshot.success = false;
    records.snapshot.exportFile = "exports/unrelated.jsonl";
  }});
  assert.ok(evidenceCodes(result).includes("QUERY_NOT_SUCCESSFUL"));
  assert.ok(evidenceCodes(result).includes("EXECUTION_EXPORT_MISMATCH"));
  assert.ok(securityCodes(result).includes("EVIDENCE_INVALID"));
});

test("internally rehashed truncated snapshot still fails its inventory", async (t) => {
  const result = await withFixture(t,{mutate:({manifest,records,files}) => {
    const original = files.get("exports/snapshot.jsonl").trimEnd().split("\n");
    const truncated = `${original.filter((line) => JSON.parse(line).section !== "role" ||
      JSON.parse(line).item !== "postgres").join("\n")}\n`;
    files.set("exports/snapshot.jsonl",truncated);
    manifest.queries[0].exportSha256 = hash(truncated);
    records.snapshot.exportSha256 = hash(truncated);
    records.snapshot.rowCount = original.length - 1;
  }});
  assert.ok(evidenceCodes(result).includes("SNAPSHOT_INVENTORY_MISMATCH"));
  assert.equal(result.security.decision,"BLOCKED");
});

test("duplicate execution ID and unsafe evidence path block", async (t) => {
  const duplicate = await withFixture(t,{registryExists:true,mutate:({records}) => {
    records["migration-history"].executionId = records.snapshot.executionId;
  }});
  assert.ok(evidenceCodes(duplicate).includes("DUPLICATE_OR_MISSING_EXECUTION_ID"));
  const pathTraversal = await withFixture(t,{mutate:({manifest}) => {
    manifest.queries[0].approvedSqlFile = "../separate-policy.json";
  }});
  assert.ok(evidenceCodes(pathTraversal).includes("APPROVED_SQL_MISSING"));
});

test("symlinks and final-file replacement cannot pass stable descriptor reads", async (t) => {
  const f = await fixture();
  t.after(() => rm(f.directory,{recursive:true,force:true}));
  await symlink("snapshot.sql",path.join(f.bundle,"approved","linked.sql"));
  await assert.rejects(readStableBundleFile(f.bundle,"approved/linked.sql"),/symlink/);
  await symlink(path.join(f.bundle,"approved"),path.join(f.bundle,"approved-link"));
  await assert.rejects(readStableBundleFile(f.bundle,"approved-link/snapshot.sql"),/symlink/);
  const linkedRoot = path.join(f.directory,"linked-bundle");
  await symlink(f.bundle,linkedRoot);
  const linkedResult = await validateOfflineBundle(linkedRoot,f.policyFile,f.policySha256);
  assert.ok(evidenceCodes(linkedResult).includes("BUNDLE_UNAVAILABLE"));
  await assert.rejects(readStableBundleFile(f.bundle,"../separate-policy.json"),/unsafe relative path/);
  const target = path.join(f.bundle,"approved","snapshot.sql");
  await assert.rejects(readStableBundleFile(f.bundle,"approved/snapshot.sql",async () => {
    await rename(target,`${target}.old`);
    await writeFile(target,"replacement content");
  }),/changed during read/);
});

test("undeclared execution record and export each block evidence", async (t) => {
  for (const [directory,name] of [["records","extra.json"],["exports","extra.jsonl"]]) {
    const f = await fixture();
    t.after(() => rm(f.directory,{recursive:true,force:true}));
    await writeFile(path.join(f.bundle,directory,name),"synthetic-extra");
    const result = await validateOfflineBundle(f.bundle,f.policyFile,f.policySha256);
    assert.equal(result.evidence.decision,"BLOCKED");
    assert.ok(evidenceCodes(result).includes("UNDECLARED_EVIDENCE_FILE"));
  }
});

test("missing declared record or export blocks inventory validation", async (t) => {
  for (const missing of ["records/snapshot.json","exports/snapshot.jsonl"]) {
    const result = await withFixture(t,{omitFiles:[missing]});
    assert.equal(result.evidence.decision,"BLOCKED");
    assert.ok(evidenceCodes(result).includes("DECLARED_EVIDENCE_FILE_MISSING"),missing);
  }
});

test("symlink and non-regular entry inside evidence directories block", async (t) => {
  const linked = await fixture();
  t.after(() => rm(linked.directory,{recursive:true,force:true}));
  await symlink("snapshot.json",path.join(linked.bundle,"records","linked.json"));
  const linkedResult = await validateOfflineBundle(linked.bundle,linked.policyFile,
    linked.policySha256);
  assert.equal(linkedResult.evidence.decision,"BLOCKED");
  assert.ok(evidenceCodes(linkedResult).includes("EVIDENCE_FILE_TYPE_INVALID"));
  const directory = await fixture();
  t.after(() => rm(directory.directory,{recursive:true,force:true}));
  await mkdir(path.join(directory.bundle,"exports","unexpected.jsonl"));
  const directoryResult = await validateOfflineBundle(directory.bundle,directory.policyFile,
    directory.policySha256);
  assert.equal(directoryResult.evidence.decision,"BLOCKED");
  assert.ok(evidenceCodes(directoryResult).includes("EVIDENCE_FILE_TYPE_INVALID"));
});

test("case-conflicting and noncanonical manifest paths block", async (t) => {
  const conflict = await withFixture(t,{registryExists:true,mutate:({manifest}) => {
    manifest.queries[1].executionRecordFile = "records/Snapshot.json";
  }});
  assert.equal(conflict.evidence.decision,"BLOCKED");
  assert.ok(evidenceCodes(conflict).includes("EVIDENCE_FILENAME_CASE_COLLISION"));
  assert.ok(evidenceCodes(conflict).includes("EVIDENCE_FILENAME_INVALID"));
  const noncanonical = await withFixture(t,{mutate:({manifest}) => {
    manifest.queries[0].exportFile = "exports/Bad Name.jsonl";
  }});
  assert.ok(evidenceCodes(noncanonical).includes("EVIDENCE_FILENAME_INVALID"));
});

test("two queries cannot map to the same record or export file", async (t) => {
  for (const field of ["executionRecordFile","exportFile"]) {
    const result = await withFixture(t,{registryExists:true,mutate:({manifest}) => {
      manifest.queries[1][field] = manifest.queries[0][field];
    }});
    assert.equal(result.evidence.decision,"BLOCKED");
    assert.ok(evidenceCodes(result).includes("DUPLICATE_FILE_MAPPING"),field);
  }
});
