// Synthetic, local-only contract tests. No database client, network call or project file writes.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { validateCatalogA6Evidence, SECTIONS } from "./catalog-a6-evidence-validator.mjs";

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const put = (section,item,data) => ({section,item,row_key:`${section}:${item}`,data});
const targetRef = "nnmdcezigmguqolbxzmb"; // Public project reference only; no credentials.
const sqlText = "SELECT snapshot_row FROM synthetic_metadata_only;\n"; // Never executed.
const csv = (rows) => "snapshot_row\n" + rows.map((row) =>
  `"${JSON.stringify(row).replaceAll('"','""')}"`).join("\n") + "\n";
const jsonl = (rows) => rows.map((row) => JSON.stringify(row)).join("\n") + "\n";

function baseRows({membership=false,omitRole=false}={}) {
  const rows = [
    put("database","postgres",{name:"postgres",server_version:"17.11",database_oid:"5",
      current_user:"postgres",session_user:"postgres",captured_at_utc:"2026-11-09T03:49:32.000Z",
      owner:"postgres",owner_oid:"10",encoding:"UTF8"}),
    put("business_inventory","catalog-rfq-admin-prefixes",{complete:true}),
    put("permission_inventory","database-acl-and-membership",{complete:true,membership_count:0,
      database_acl_count:0,public_schema_acl_count:0,role_count:0,business_object_count:0,
      snapshot_row_count:0,duplicate_row_key_count:0,null_row_key_count:0}),
    put("migration_registry","supabase_migrations.schema_migrations",{exists:false}),
    put("schema","public",{exists:true,schema_oid:"2200",owner_oid:"10",owner:"postgres"}),
    put("database_acl_state","5",{database:"postgres",database_oid:"5",owner_oid:"10",
      acl_is_null:true,acl_source:"BUILTIN_DEFAULT",explicit_acl_entry_count:0}),
    put("database_builtin_acl","5:0:10:CONNECT",{database:"postgres",database_oid:"5",
      acl_source:"BUILTIN_REFERENCE",grantee:"PUBLIC",grantee_oid:"0",grantor:"postgres",
      grantor_oid:"10",privilege:"CONNECT",grantable:false}),
    put("public_database_privilege","5",{database:"postgres",database_oid:"5",
      acl_source:"BUILTIN_DEFAULT",connect:true,create:false,temp:true}),
    put("schema_acl_state","public",{schema:"public",schema_oid:"2200",exists:true,
      owner_oid:"10",acl_is_null:true,acl_source:"BUILTIN_DEFAULT",explicit_acl_entry_count:0}),
    put("public_schema_privilege","public",{schema:"public",schema_oid:"2200",exists:true,
      acl_source:"BUILTIN_DEFAULT",usage:true,create:false}),
    put("default_acl_state","postgres",{explicit_default_acl_record_count:0,
      explicit_default_acl_entry_count:0,zero_entries_mean_builtin_rules_still_apply:true}),
    put("default_acl_builtin","10:f:0:10:EXECUTE",{creator:"postgres",creator_oid:"10",
      schema:null,scope:"ALL_SCHEMAS",object_type:"f",
      acl_source:"BUILTIN_REFERENCE_NOT_EFFECTIVE_DEFAULT",grantee:"PUBLIC",grantee_oid:"0",
      grantor:"postgres",grantor_oid:"10",privilege:"EXECUTE",grantable:false}),
    put("effective_database","postgres",{role:"postgres",role_oid:"10",role_exists:true,
      connect:true,create:true,temp:true}),
    put("effective_schema","postgres:public",{role:"postgres",schema:"public",role_oid:"10",
      schema_oid:"2200",role_exists:true,schema_exists:true,usage:true,create:true}),
    put("snapshot_contract","catalog-a6-scheme-b-v1",{version:"catalog-a6-scheme-b-v1",
      project_ref_source:"EXTERNAL_DASHBOARD_EVIDENCE_REQUIRED",
      raw_export_completeness:"UNVERIFIED",execution_provenance:"UNVERIFIED"}),
  ];
  if (!omitRole) rows.push(put("role","postgres",{role_name:"postgres",role_oid:"10",
    connection_limit:-1,login:true,inherit:true,superuser:false,bypass_rls:false,
    create_db:false,create_role:false,replication:false}));
  if (membership) {
    rows.push(put("role","audit_parent",{role_name:"audit_parent",role_oid:"11",
      connection_limit:-1,login:false,inherit:false,superuser:false,bypass_rls:false,
      create_db:false,create_role:false,replication:false}));
    rows.push(put("effective_database","audit_parent",{role:"audit_parent",role_oid:"11",
      role_exists:true,connect:true,create:false,temp:true}));
    rows.push(put("effective_schema","audit_parent:public",{role:"audit_parent",
      schema:"public",role_oid:"11",schema_oid:"2200",role_exists:true,
      schema_exists:true,usage:true,create:false}));
    rows.push(put("membership","42",{membership_oid:"42",member:"postgres",
      member_oid:"10",parent:"audit_parent",parent_oid:"11",grantor:"postgres",
      grantor_oid:"10",member_name_resolved:true,parent_name_resolved:true,
      grantor_name_resolved:true,admin_option:false,inherit_option:false,set_option:false}));
  }
  return completeRows(rows);
}

function completeRows(base) {
  const rows = base.filter((row) => row.section !== "section_inventory");
  const count = (s) => rows.filter((r) => r.section === s).length;
  const permission = rows.find((r) => r.section === "permission_inventory");
  if (permission) Object.assign(permission.data,{
    membership_count:count("membership"),database_acl_count:count("database_acl"),
    public_schema_acl_count:rows.filter((r) => r.section === "schema_acl" && r.data.schema === "public").length,
    role_count:count("role"),business_object_count:count("business_object"),
    snapshot_row_count:rows.length+SECTIONS.length,duplicate_row_key_count:0,null_row_key_count:0,
  });
  return [...rows,...SECTIONS.map((section) => put("section_inventory",section,{
    section,row_count:section === "section_inventory" ? SECTIONS.length : count(section),
    is_empty:section !== "section_inventory" && count(section) === 0,
  }))];
}

async function fixture(t, options={}) {
  const temp = await mkdtemp(path.join(tmpdir(),"catalog-a6-evidence-"));
  t.after(async () => { const {rm} = await import("node:fs/promises"); await rm(temp,{recursive:true,force:true}); });
  const bundle = path.join(temp,"bundle"), policyFile = path.join(temp,"approved-policy.json");
  for (const dir of ["approved","records","raw","exports"])
    await mkdir(path.join(bundle,dir),{recursive:true});
  const f = {
    temp,bundle,policyFile,
    rows:baseRows(options), sql:sqlText,
    policy:{kind:"CATALOG_A6_EVIDENCE_POLICY_V1",projectRef:targetRef,databaseName:"postgres",
      postgresVersion:"17.11",identity:{operator:"operator@example.invalid",currentUser:"postgres",
        sessionUser:"postgres"},queries:[{id:"snapshot",version:"catalog-a6-scheme-b-v1",sqlSha256:""}]},
    entry:{id:"snapshot",version:"catalog-a6-scheme-b-v1",
      approvedSqlFile:"approved/snapshot.sql",approvedSqlSha256:"",
      recordFile:"records/snapshot.json",recordSha256:"",
      rawExportFile:"raw/snapshot.csv",rawExportSha256:"",rawExportSourceId:"synthetic-export-1",
      jsonlFile:"exports/snapshot.jsonl",jsonlSha256:"",rowCount:0,
      columns:["snapshot_row"],truncated:false},
    record:{queryId:"snapshot",executionId:"synthetic-execution-1",projectRef:targetRef,
      databaseName:"postgres",postgresVersion:"17.11",operator:"operator@example.invalid",
      currentUser:"postgres",sessionUser:"postgres",executedAtUtc:"2026-11-09T03:49:32.000Z",
      success:true,sqlVersion:"catalog-a6-scheme-b-v1",executedSql:sqlText,executedSqlSha256:"",
      rawExportFile:"raw/snapshot.csv",rawExportSha256:"",rawExportSourceId:"synthetic-export-1",
      jsonlFile:"exports/snapshot.jsonl",jsonlSha256:"",rowCount:0,columns:["snapshot_row"],
      truncated:false},
  };
  f.write = async ({rawText,convertedText,recordText,policyText,manifestText,
    preserveSqlHash=false,preserveRawHash=false,preservePolicyAnchor=false}={}) => {
    const approvedBytes = Buffer.from(f.sql);
    const rawBytes = Buffer.from(rawText ?? csv(f.rows));
    const jsonlBytes = Buffer.from(convertedText ?? jsonl(f.rows));
    if (!preserveSqlHash) f.policy.queries[0].sqlSha256 = sha(approvedBytes);
    f.entry.approvedSqlSha256 = f.policy.queries[0].sqlSha256;
    if (!preserveRawHash) f.entry.rawExportSha256 = sha(rawBytes);
    f.entry.jsonlSha256 = sha(jsonlBytes);
    f.entry.rowCount = f.rows.length;
    f.record.executedSqlSha256 = sha(Buffer.from(f.record.executedSql ?? ""));
    f.record.rawExportSha256 = f.entry.rawExportSha256;
    f.record.jsonlSha256 = f.entry.jsonlSha256;
    f.record.rowCount = f.entry.rowCount;
    const recordBytes = Buffer.from(recordText ?? JSON.stringify(f.record));
    f.entry.recordSha256 = sha(recordBytes);
    const manifest = {kind:"CATALOG_A6_EVIDENCE_BUNDLE_V1",projectRef:targetRef,
      databaseName:"postgres",postgresVersion:"17.11",queries:[f.entry]};
    const policyBytes = Buffer.from(policyText ?? JSON.stringify(f.policy));
    if (!preservePolicyAnchor) f.anchor = sha(policyBytes);
    await Promise.all([
      writeFile(policyFile,policyBytes),writeFile(path.join(bundle,"manifest.json"),
        manifestText ?? JSON.stringify(manifest)),
      writeFile(path.join(bundle,"approved/snapshot.sql"),approvedBytes),
      writeFile(path.join(bundle,"records/snapshot.json"),recordBytes),
      writeFile(path.join(bundle,"raw/snapshot.csv"),rawBytes),
      writeFile(path.join(bundle,"exports/snapshot.jsonl"),jsonlBytes),
    ]);
  };
  await f.write();
  return f;
}
const check = (f) => validateCatalogA6Evidence(f.bundle,f.policyFile,f.anchor);
async function blocked(t,mutate,code,options={}) {
  const f = await fixture(t,options);
  await mutate(f);
  const out = await check(f);
  assert.equal(out.internalConsistency,"INTERNAL_CONSISTENCY_BLOCKED",JSON.stringify(out));
  assert.equal(out.sourceAuthentication,"SOURCE_AUTHENTICATION_UNVERIFIED");
  assert.equal(out.securityBaseline,"NOT_EVALUATED");
  if (code) assert.ok(out.findings.some((x) => x.code === code),JSON.stringify(out.findings));
}

function addExplicitSchemaAcl(f,schema="public",oid="2200") {
  f.rows.push(put("schema_acl",`${oid}:0:10:USAGE`,{schema,schema_oid:oid,
    owner:"postgres",owner_oid:"10",acl_source:"EXPLICIT",grantee:"PUBLIC",
    grantee_oid:"0",grantor:"postgres",grantor_oid:"10",privilege:"USAGE",
    grantable:false}));
  const state = f.rows.find((r) => r.section === "schema_acl_state" && r.item === schema);
  state.data.acl_is_null = false;
  state.data.acl_source = "EXPLICIT";
  state.data.explicit_acl_entry_count++;
  f.rows.find((r) => r.section === "public_schema_privilege" && r.item === schema)
    .data.acl_source = "EXPLICIT";
  f.rows = completeRows(f.rows);
}
function addSecondSchema(f) {
  f.rows.push(put("schema","catalog_private",{exists:true,schema_oid:"2300",
    owner_oid:"10",owner:"postgres"}));
  f.rows.push(put("schema_acl_state","catalog_private",{schema:"catalog_private",
    schema_oid:"2300",exists:true,owner_oid:"10",acl_is_null:false,
    acl_source:"EXPLICIT",explicit_acl_entry_count:0}));
  f.rows.push(put("public_schema_privilege","catalog_private",{schema:"catalog_private",
    schema_oid:"2300",exists:true,acl_source:"EXPLICIT",usage:false,create:false}));
  f.rows.push(put("effective_schema","postgres:catalog_private",{role:"postgres",
    schema:"catalog_private",role_oid:"10",schema_oid:"2300",role_exists:true,
    schema_exists:true,usage:true,create:true}));
  f.rows = completeRows(f.rows);
}

test("correct target identity, SQL, CSV and JSONL yield only internal consistency PASS",async (t) => {
  const out = await check(await fixture(t));
  assert.equal(out.internalConsistency,"INTERNAL_CONSISTENCY_PASS",JSON.stringify(out));
  assert.equal(out.sourceAuthentication,"SOURCE_AUTHENTICATION_UNVERIFIED");
  assert.equal(out.rawExportCompleteness,"RAW_EXPORT_COMPLETENESS_UNVERIFIED");
  assert.equal(out.securityBaseline,"NOT_EVALUATED");
  assert.equal(Object.hasOwn(out,"overall"),false);
});
test("wrong Project Ref blocks",(t) => blocked(t,async (f) => {
  f.policy.projectRef = "aaaaaaaaaaaaaaaaaaaa"; await f.write();
},"PROJECT_REF_MISMATCH"));
test("wrong database blocks",(t) => blocked(t,async (f) => {
  f.policy.databaseName = "other"; await f.write();
},"DATABASE_MISMATCH"));
test("full PostgreSQL version mismatch blocks, including suffix",(t) => blocked(t,async (f) => {
  f.policy.postgresVersion = "17.11 (other build)"; await f.write();
},"POSTGRES_VERSION_MISMATCH"));
test("wrong execution identity blocks",(t) => blocked(t,async (f) => {
  f.record.operator = "other@example.invalid"; await f.write();
},"EXECUTION_IDENTITY_MISMATCH"));
test("SQL file hash mismatch blocks",(t) => blocked(t,async (f) => {
  f.sql += "-- changed\n"; await f.write({preserveSqlHash:true});
},"SQL_HASH_MISMATCH"));
test("actual executed SQL byte mismatch blocks",(t) => blocked(t,async (f) => {
  f.record.executedSql += " "; await f.write();
},"EXECUTED_SQL_MISMATCH"));
test("raw export hash mismatch blocks",(t) => blocked(t,async (f) => {
  await f.write({rawText:csv(f.rows)+" ",preserveRawHash:true});
},"RAW_HASH_MISMATCH"));
test("missing execution record blocks",(t) => blocked(t,async (f) => {
  const {unlink} = await import("node:fs/promises");
  await unlink(path.join(f.bundle,"records/snapshot.json"));
},"DECLARED_FILE_MISSING"));
test("duplicate JSON object key in record blocks before acceptance",(t) => blocked(t,async (f) => {
  await f.write({recordText:JSON.stringify(f.record).replace('"queryId":"snapshot"',
    '"queryId":"snapshot","queryId":"snapshot"')});
},"DUPLICATE_JSON_KEY"));
test("duplicate escaped JSON key in JSONL blocks",(t) => blocked(t,async (f) => {
  const text = jsonl(f.rows).replace('"section":"database"',
    '"section":"database","\\u0073ection":"database"');
  await f.write({convertedText:text});
},"DUPLICATE_JSON_KEY"));
test("missing section inventory entry blocks",(t) => blocked(t,async (f) => {
  f.rows = f.rows.filter((r) => !(r.section === "section_inventory" && r.item === "membership"));
  await f.write();
},"SECTION_INVENTORY_INCOMPLETE"));
test("unknown section blocks",(t) => blocked(t,async (f) => {
  f.rows.push(put("unapproved","x",{value:true})); await f.write();
},"UNKNOWN_SECTION"));
test("duplicate row key blocks even with self-consistent file hashes",(t) => blocked(t,async (f) => {
  f.rows.push(structuredClone(f.rows.find((r) => r.section === "role"))); await f.write();
},"DUPLICATE_ROW_KEY"));
test("null row key blocks",(t) => blocked(t,async (f) => {
  f.rows[0].row_key = null; await f.write();
},"SNAPSHOT_ROW_INVALID"));
test("dynamic section count conflict blocks",(t) => blocked(t,async (f) => {
  f.rows.find((r) => r.section === "section_inventory" && r.item === "role").data.row_count++;
  await f.write();
},"SECTION_COUNT_MISMATCH"));
test("empty required role section blocks despite corrected self-reported counts",(t) => blocked(t,async (f) => {
  f.rows = baseRows({omitRole:true}); await f.write();
},"REQUIRED_SECTION_EMPTY"));
test("declared truncation blocks",(t) => blocked(t,async (f) => {
  f.entry.truncated = true; await f.write();
},"EXPORT_TRUNCATED"));
test("A1 membership OID item is accepted",async (t) => {
  const f = await fixture(t,{membership:true});
  const out = await check(f);
  assert.equal(out.internalConsistency,"INTERNAL_CONSISTENCY_PASS",JSON.stringify(out));
});
test("matching role, database and Schema OIDs remain valid",async (t) => {
  const f = await fixture(t,{membership:true});
  const out = await check(f);
  assert.equal(out.internalConsistency,"INTERNAL_CONSISTENCY_PASS",JSON.stringify(out));
});
test("effective database role OID pointing at another role blocks despite refreshed hashes",
  (t) => blocked(t,async (f) => {
    f.rows.find((r) => r.section === "effective_database" && r.item === "postgres")
      .data.role_oid = "11";
    await f.write();
  },"EFFECTIVE_ROLE_OID_MISMATCH",{membership:true}));
test("effective Schema role OID pointing at another role blocks",
  (t) => blocked(t,async (f) => {
    f.rows.find((r) => r.section === "effective_schema" && r.item === "postgres:public")
      .data.role_oid = "11";
    await f.write();
  },"EFFECTIVE_ROLE_OID_MISMATCH",{membership:true}));
test("effective Schema OID pointing at an unknown Schema blocks",
  (t) => blocked(t,async (f) => {
    f.rows.find((r) => r.section === "effective_schema").data.schema_oid = "9999";
    await f.write();
  },"SCHEMA_OID_MISMATCH"));
test("database ACL state OID contradicting database identity blocks",
  (t) => blocked(t,async (f) => {
    f.rows.find((r) => r.section === "database_acl_state").data.database_oid = "9999";
    await f.write();
  },"DATABASE_OID_MISMATCH"));
test("Schema ACL OID pointing at another Schema blocks despite refreshed hashes",
  (t) => blocked(t,async (f) => {
    addSecondSchema(f);
    addExplicitSchemaAcl(f);
    f.rows.find((r) => r.section === "schema_acl").data.schema_oid = "2300";
    await f.write();
  },"SCHEMA_OID_MISMATCH"));
for (const field of ["member_oid","parent_oid","grantor_oid"])
  test(`membership ${field} mismatch blocks`,(t) => blocked(t,async (f) => {
    f.rows.find((r) => r.section === "membership").data[field] = "9999";
    await f.write();
  },"ROLE_IDENTITY_MISMATCH",{membership:true}));
test("duplicate role OID mapping blocks",(t) => blocked(t,async (f) => {
  f.rows.find((r) => r.section === "role" && r.item === "audit_parent").data.role_oid = "10";
  await f.write();
},"ROLE_IDENTITY_CONFLICT",{membership:true}));
test("duplicate Schema OID mapping blocks",(t) => blocked(t,async (f) => {
  addSecondSchema(f);
  f.rows.find((r) => r.section === "schema" && r.item === "catalog_private")
    .data.schema_oid = "2200";
  await f.write();
},"SCHEMA_IDENTITY_CONFLICT"));
test("unknown effective role OID blocks",(t) => blocked(t,async (f) => {
  f.rows.find((r) => r.section === "effective_database").data.role_oid = "9999";
  await f.write();
},"EFFECTIVE_ROLE_OID_MISMATCH"));
test("NULL Schema ACL with zero explicit entries remains valid",async (t) => {
  const out = await check(await fixture(t));
  assert.equal(out.internalConsistency,"INTERNAL_CONSISTENCY_PASS",JSON.stringify(out));
});
test("correct explicit Schema ACL count remains valid",async (t) => {
  const f = await fixture(t);
  addExplicitSchemaAcl(f);
  await f.write();
  const out = await check(f);
  assert.equal(out.internalConsistency,"INTERNAL_CONSISTENCY_PASS",JSON.stringify(out));
});
test("separate Schemas with one explicit ACL and one empty ACL remain valid",async (t) => {
  const f = await fixture(t);
  addSecondSchema(f);
  addExplicitSchemaAcl(f);
  await f.write();
  const out = await check(f);
  assert.equal(out.internalConsistency,"INTERNAL_CONSISTENCY_PASS",JSON.stringify(out));
});
test("Schema ACL declared 99 entries while one exists blocks",(t) => blocked(t,async (f) => {
  addExplicitSchemaAcl(f);
  f.rows.find((r) => r.section === "schema_acl_state" && r.item === "public")
    .data.explicit_acl_entry_count = 99;
  await f.write();
},"SCHEMA_ACL_COUNT_MISMATCH"));
test("Schema ACL counts are checked separately for each Schema",(t) => blocked(t,async (f) => {
  addSecondSchema(f);
  addExplicitSchemaAcl(f,"public","2200");
  f.rows.find((r) => r.section === "schema_acl_state" && r.item === "catalog_private")
    .data.explicit_acl_entry_count = 1;
  await f.write();
},"SCHEMA_ACL_COUNT_MISMATCH"));
test("legacy membership member-to-parent item is rejected for A1",(t) => blocked(t,async (f) => {
  f.rows = baseRows({membership:true});
  const row = f.rows.find((r) => r.section === "membership");
  row.item = "postgres->audit_parent"; row.row_key = `membership:${row.item}`;
  await f.write();
},"MEMBERSHIP_FORMAT_INVALID"));
test("independent policy hash still blocks self-consistent policy edits",(t) => blocked(t,async (f) => {
  f.policy.identity.operator = "other@example.invalid";
  await f.write({preservePolicyAnchor:true});
},"POLICY_HASH_MISMATCH"));
test("unapproved field structure blocks",(t) => blocked(t,async (f) => {
  f.rows.find((r) => r.section === "role").data.extra = true; await f.write();
},"UNAPPROVED_FIELD_STRUCTURE"));
test("extra raw export file blocks",(t) => blocked(t,async (f) => {
  await writeFile(path.join(f.bundle,"raw/extra.csv"),"snapshot_row\n");
},"UNDECLARED_FILE"));
test("raw CSV and JSONL divergence blocks even if each hash is updated",(t) => blocked(t,async (f) => {
  const changed = structuredClone(f.rows);
  changed.find((r) => r.section === "role").data.login = false;
  await f.write({convertedText:jsonl(changed)});
},"CONVERSION_MISMATCH"));
test("JSONL object key order may change without changing exported values",async (t) => {
  const f = await fixture(t);
  const reordered = f.rows.map((r) => ({data:r.data,row_key:r.row_key,item:r.item,section:r.section}));
  await f.write({convertedText:jsonl(reordered)});
  const out = await check(f);
  assert.equal(out.internalConsistency,"INTERNAL_CONSISTENCY_PASS",JSON.stringify(out));
});
test("missing policy identity blocks",(t) => blocked(t,async (f) => {
  delete f.policy.identity.operator; await f.write();
},"POLICY_INVALID"));
test("snapshot database identity mismatch blocks",(t) => blocked(t,async (f) => {
  f.rows.find((r) => r.section === "database").data.server_version = "17.10";
  await f.write();
},"DATABASE_IDENTITY_MISMATCH"));
test("extra execution record blocks",(t) => blocked(t,async (f) => {
  await writeFile(path.join(f.bundle,"records/unlisted.json"),"{}");
},"UNDECLARED_FILE"));
test("missing raw export blocks",(t) => blocked(t,async (f) => {
  const {unlink} = await import("node:fs/promises");
  await unlink(path.join(f.bundle,"raw/snapshot.csv"));
},"DECLARED_FILE_MISSING"));
test("duplicate key in independent policy blocks",(t) => blocked(t,async (f) => {
  const text = JSON.stringify(f.policy).replace('"databaseName":"postgres"',
    '"databaseName":"postgres","databaseName":"other"');
  await f.write({policyText:text});
},"DUPLICATE_JSON_KEY"));
test("duplicate key in manifest blocks",(t) => blocked(t,async (f) => {
  const manifest = {kind:"CATALOG_A6_EVIDENCE_BUNDLE_V1",projectRef:targetRef,
    databaseName:"postgres",postgresVersion:"17.11",queries:[f.entry]};
  const text = JSON.stringify(manifest).replace('"projectRef":',
    `"projectRef":"${targetRef}","projectRef":`);
  await f.write({manifestText:text});
},"DUPLICATE_JSON_KEY"));
test("source identifier conflict blocks but matching identifier never authenticates source",(t) => blocked(t,async (f) => {
  f.record.rawExportSourceId = "different-source"; await f.write();
},"EXECUTION_FILE_MAPPING_MISMATCH"));
test("required public schema row cannot disappear behind self-consistent inventory",(t) => blocked(t,async (f) => {
  f.rows = completeRows(f.rows.filter((r) => !(r.section === "schema" && r.item === "public")));
  await f.write();
},"REQUIRED_ROW_MISSING_OR_DUPLICATE"));
