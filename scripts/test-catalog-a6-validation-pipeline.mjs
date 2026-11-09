// Synthetic A6 integration tests. All writes go to OS temporary directories.
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { SECTIONS } from "./catalog-a6-evidence-validator.mjs";
import { approvalMessage, baselineContent, canonicalJson } from "./catalog-a6-security-validator.mjs";
import { validateCatalogA6Pipeline } from "./catalog-a6-validation-pipeline.mjs";

const sha = (x) => createHash("sha256").update(x).digest("hex");
const ref = "nnmdcezigmguqolbxzmb";
const sql = "SELECT synthetic_snapshot_row;\n"; // Never executed.
const {privateKey,publicKey} = generateKeyPairSync("ed25519");
const keyPem = publicKey.export({type:"spki",format:"pem"});
const row = (section,item,data) => ({section,item,row_key:`${section}:${item}`,data});
const csv = (rows) => "snapshot_row\n" + rows.map((r) =>
  `"${JSON.stringify(r).replaceAll('"','""')}"`).join("\n") + "\n";
const jsonl = (rows) => rows.map((r) => JSON.stringify(r)).join("\n") + "\n";

function permissions() {
  return {
    roles:[
      {name:"postgres",connectionLimit:-1,superuser:true,createDb:true,createRole:true,
        login:true,replication:false,bypassRls:true,inherit:true},
      {name:"normal",connectionLimit:-1,superuser:false,createDb:false,createRole:false,
        login:true,replication:false,bypassRls:false,inherit:true},
    ],
    memberships:[{member:"normal",parent:"postgres",grantor:"postgres",
      adminOption:false,inheritOption:false,setOption:false}],
    database:{name:"postgres",serverVersion:"17.11",owner:"postgres",
      public:{connect:true,create:false,temp:false},aclIsNull:false,aclSource:"EXPLICIT"},
    schemas:[{name:"public",exists:true,owner:"postgres",aclIsNull:false,aclSource:"EXPLICIT"}],
    publicSchemas:[{name:"public",exists:true,usage:true,create:false,aclSource:"EXPLICIT"}],
    databaseAcl:[{aclSource:"EXPLICIT",grantee:"PUBLIC",grantor:"postgres",
      privilege:"CONNECT",grantable:false}],
    databaseBuiltinAcl:[{aclSource:"BUILTIN_REFERENCE",grantee:"PUBLIC",grantor:"postgres",
      privilege:"TEMPORARY",grantable:false}],
    schemaAcl:[{schema:"public",aclSource:"EXPLICIT",grantee:"PUBLIC",grantor:"postgres",
      privilege:"USAGE",grantable:false}],
    schemaBuiltinAcl:[{schema:"public",aclSource:"BUILTIN_REFERENCE",grantee:"postgres",
      grantor:"postgres",privilege:"CREATE",grantable:false}],
    defaultAcl:[],
    defaultAclBuiltin:[{creator:"postgres",scope:"ALL_SCHEMAS",schema:null,objectType:"f",
      aclSource:"BUILTIN_REFERENCE_NOT_EFFECTIVE_DEFAULT",grantee:"PUBLIC",
      grantor:"postgres",privilege:"EXECUTE",grantable:false}],
    effectiveDatabase:[
      {role:"postgres",roleExists:true,connect:true,create:true,temp:false},
      {role:"normal",roleExists:true,connect:true,create:false,temp:false},
    ],
    effectiveSchema:[
      {role:"postgres",schema:"public",roleExists:true,schemaExists:true,usage:true,create:true},
      {role:"normal",schema:"public",roleExists:true,schemaExists:true,usage:true,create:false},
    ],
    privilegedSetRolePaths:[],
  };
}
const oid = {postgres:"10",normal:"11",unapproved:"12"};
function baseRows(p) {
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
    row("public_database_privilege","5",{database:"postgres",database_oid:"5",
      acl_source:"EXPLICIT",connect:true,create:false,temp:false}),
    row("schema_acl_state","public",{schema:"public",schema_oid:"2200",exists:true,
      owner_oid:"10",acl_is_null:false,acl_source:"EXPLICIT",explicit_acl_entry_count:1}),
    row("public_schema_privilege","public",{schema:"public",schema_oid:"2200",exists:true,
      acl_source:"EXPLICIT",usage:true,create:false}),
    row("default_acl_state","postgres",{explicit_default_acl_record_count:0,
      explicit_default_acl_entry_count:0,zero_entries_mean_builtin_rules_still_apply:true}),
    row("snapshot_contract","catalog-a6-scheme-b-v1",{version:"catalog-a6-scheme-b-v1",
      project_ref_source:"EXTERNAL_DASHBOARD_EVIDENCE_REQUIRED",
      raw_export_completeness:"UNVERIFIED",execution_provenance:"UNVERIFIED"}),
  ];
  p.roles.forEach((r) => rows.push(row("role",r.name,{role_name:r.name,role_oid:oid[r.name],
    connection_limit:r.connectionLimit,login:r.login,inherit:r.inherit,superuser:r.superuser,
    bypass_rls:r.bypassRls,create_db:r.createDb,create_role:r.createRole,
    replication:r.replication})));
  p.memberships.forEach((m,i) => rows.push(row("membership",String(100+i),{
    membership_oid:String(100+i),member:m.member,member_oid:oid[m.member],
    parent:m.parent,parent_oid:oid[m.parent],grantor:m.grantor,grantor_oid:oid[m.grantor],
    member_name_resolved:true,parent_name_resolved:true,grantor_name_resolved:true,
    admin_option:m.adminOption,inherit_option:m.inheritOption,set_option:m.setOption})));
  const acl = (section,items) => items.forEach((a,i) => rows.push(row(section,String(i+1),{
    ...(section === "database_acl" ? {database:"postgres",database_oid:"5",
      owner:"postgres",owner_oid:"10"} : {}),
    ...(section === "database_builtin_acl" ? {database:"postgres",database_oid:"5"} : {}),
    ...(section === "schema_acl" ? {schema_oid:"2200",owner:"postgres",owner_oid:"10"} : {}),
    ...(section === "schema_builtin_acl" ? {schema_oid:"2200"} : {}),
    ...(a.schema !== undefined ? {schema:a.schema} : {}),
    ...(a.creator !== undefined ? {creator:a.creator,creator_oid:oid[a.creator],
      scope:a.scope,object_type:a.objectType} : {}),
    acl_source:a.aclSource,grantee:a.grantee,grantee_oid:a.grantee === "PUBLIC" ? "0" : oid[a.grantee],
    grantor:a.grantor,grantor_oid:oid[a.grantor],privilege:a.privilege,grantable:a.grantable,
  })));
  acl("database_acl",p.databaseAcl); acl("database_builtin_acl",p.databaseBuiltinAcl);
  acl("schema_acl",p.schemaAcl); acl("schema_builtin_acl",p.schemaBuiltinAcl);
  acl("default_acl",p.defaultAcl); acl("default_acl_builtin",p.defaultAclBuiltin);
  p.effectiveDatabase.forEach((x) => rows.push(row("effective_database",x.role,{
    role:x.role,role_oid:oid[x.role],role_exists:x.roleExists,
    connect:x.connect,create:x.create,temp:x.temp})));
  p.effectiveSchema.forEach((x) => rows.push(row("effective_schema",`${x.role}:${x.schema}`,{
    role:x.role,schema:x.schema,role_oid:oid[x.role],schema_oid:"2200",
    role_exists:x.roleExists,schema_exists:x.schemaExists,usage:x.usage,create:x.create})));
  return rows;
}
function completeRows(base) {
  const rows = base.filter((r) => r.section !== "section_inventory");
  const n = (s) => rows.filter((r) => r.section === s).length;
  Object.assign(rows.find((r) => r.section === "permission_inventory").data,{
    membership_count:n("membership"),database_acl_count:n("database_acl"),
    public_schema_acl_count:rows.filter((r) => r.section === "schema_acl" &&
      r.data.schema === "public").length,
    role_count:n("role"),business_object_count:n("business_object"),
    snapshot_row_count:rows.length+SECTIONS.length,duplicate_row_key_count:0,null_row_key_count:0,
  });
  return [...rows,...SECTIONS.map((s) => row("section_inventory",s,{
    section:s,row_count:s === "section_inventory" ? SECTIONS.length : n(s),
    is_empty:s !== "section_inventory" && n(s) === 0,
  }))];
}
function baseline(p,status="SYNTHETIC_APPROVED") {
  const b = {kind:"CATALOG_A6_SECURITY_BASELINE_V1",baselineId:"SYNTHETIC-a6-v1",
    version:"1",projectRef:ref,databaseName:"postgres",postgresVersion:"17.11",
    approval:{status,approver:"Synthetic Reviewer",signedRecordRef:"synthetic://approval/1",
      signedAtUtc:"2026-11-09T03:49:32.000Z",signerKeyId:"synthetic-key-1",
      signatureBase64:""},contentSha256:"",permissions:p};
  b.contentSha256 = sha(Buffer.from(canonicalJson(baselineContent(b))));
  b.approval.signatureBase64 = sign(null,approvalMessage(b),privateKey).toString("base64");
  return Buffer.from(JSON.stringify(b));
}
async function fixture(t) {
  const temp = await mkdtemp(path.join(tmpdir(),"catalog-a6-pipeline-"));
  t.after(() => rm(temp,{recursive:true,force:true}));
  const bundle = path.join(temp,"bundle"), policyFile = path.join(temp,"policy.json"),
    baselineFile = path.join(temp,"baseline.json");
  for (const dir of ["approved","records","raw","exports"])
    await mkdir(path.join(bundle,dir),{recursive:true});
  const p = permissions();
  const f = {temp,bundle,policyFile,baselineFile,rows:baseRows(p),
    baselineStatus:"SYNTHETIC_APPROVED",baselineBytes:null,
    policy:{kind:"CATALOG_A6_EVIDENCE_POLICY_V1",projectRef:ref,databaseName:"postgres",
      postgresVersion:"17.11",identity:{operator:"synthetic-operator@example.invalid",
        currentUser:"postgres",sessionUser:"postgres"},queries:[{id:"snapshot",
        version:"catalog-a6-scheme-b-v1",sqlSha256:sha(Buffer.from(sql))}]},
    record:{queryId:"snapshot",executionId:"SYNTHETIC-execution-1",projectRef:ref,
      databaseName:"postgres",postgresVersion:"17.11",
      operator:"synthetic-operator@example.invalid",currentUser:"postgres",sessionUser:"postgres",
      executedAtUtc:"2026-11-09T03:49:32.000Z",success:true,
      sqlVersion:"catalog-a6-scheme-b-v1",executedSql:sql,executedSqlSha256:sha(Buffer.from(sql)),
      rawExportFile:"raw/snapshot.csv",rawExportSha256:"",rawExportSourceId:"SYNTHETIC-export-1",
      jsonlFile:"exports/snapshot.jsonl",jsonlSha256:"",rowCount:0,
      columns:["snapshot_row"],truncated:false},
  };
  f.commit = async () => {
    const rows = completeRows(f.rows), rawBytes = Buffer.from(csv(rows)),
      jsonlBytes = Buffer.from(jsonl(rows));
    f.record.rawExportSha256 = sha(rawBytes); f.record.jsonlSha256 = sha(jsonlBytes);
    f.record.rowCount = rows.length;
    const recordBytes = Buffer.from(JSON.stringify(f.record));
    const entry = {id:"snapshot",version:"catalog-a6-scheme-b-v1",
      approvedSqlFile:"approved/snapshot.sql",approvedSqlSha256:sha(Buffer.from(sql)),
      recordFile:"records/snapshot.json",recordSha256:sha(recordBytes),
      rawExportFile:"raw/snapshot.csv",rawExportSha256:sha(rawBytes),
      rawExportSourceId:"SYNTHETIC-export-1",jsonlFile:"exports/snapshot.jsonl",
      jsonlSha256:sha(jsonlBytes),rowCount:rows.length,columns:["snapshot_row"],truncated:false};
    const manifest = {kind:"CATALOG_A6_EVIDENCE_BUNDLE_V1",projectRef:ref,
      databaseName:"postgres",postgresVersion:"17.11",queries:[entry]};
    const policyBytes = Buffer.from(JSON.stringify(f.policy));
    f.policyAnchor = sha(policyBytes);
    if (!f.baselineBytes) f.baselineBytes = baseline(p,f.baselineStatus);
    f.baselineAnchor = sha(f.baselineBytes);
    await Promise.all([
      writeFile(policyFile,policyBytes),writeFile(baselineFile,f.baselineBytes),
      writeFile(path.join(bundle,"manifest.json"),JSON.stringify(manifest)),
      writeFile(path.join(bundle,"approved/snapshot.sql"),sql),
      writeFile(path.join(bundle,"records/snapshot.json"),recordBytes),
      writeFile(path.join(bundle,"raw/snapshot.csv"),rawBytes),
      writeFile(path.join(bundle,"exports/snapshot.jsonl"),jsonlBytes),
    ]);
  };
  f.options = (mode="synthetic") => ({bundleDirectory:bundle,policyFile,
    expectedPolicySha256:f.policyAnchor,baselineFile,expectedBaselineSha256:f.baselineAnchor,
    trustedTarget:{projectRef:ref,databaseName:"postgres",postgresVersion:"17.11"},
    approvalTrust:{trustedApprovalPublicKeyPem:keyPem,trustedSignerKeyId:"synthetic-key-1",
      trustedApprovalRecordRef:"synthetic://approval/1"},mode});
  await f.commit();
  return f;
}
const run = (f,mode) => validateCatalogA6Pipeline(f.options(mode));
async function blockedTest(t,mutate,code) {
  const f = await fixture(t);
  await mutate(f);
  const out = await run(f);
  assert.equal(out.overallStatus,"BLOCKED",JSON.stringify(out));
  assert.equal(out.sourceAuthenticationStatus,"SOURCE_AUTHENTICATION_UNVERIFIED");
  if (code) assert.ok(out.reasonCodes.includes(code),JSON.stringify(out));
}
function assertSecurityNotRun(out,code,stage="EVIDENCE_VALIDATION") {
  assert.equal(out.evidenceStatus,"INTERNAL_CONSISTENCY_BLOCKED",JSON.stringify(out));
  assert.equal(out.baselineApprovalStatus,"BLOCKED",JSON.stringify(out));
  assert.equal(out.securityStatus,"BLOCKED",JSON.stringify(out));
  assert.equal(out.overallStatus,"BLOCKED",JSON.stringify(out));
  assert.equal(out.failureStage,stage,JSON.stringify(out));
  assert.ok(out.reasonCodes.includes("SECURITY_NOT_RUN"),JSON.stringify(out));
  assert.ok(out.reasonCodes.includes(code),JSON.stringify(out));
}

test("complete SYNTHETIC B1 and C1 path never yields formal overall PASS",async (t) => {
  const f = await fixture(t);
  const out = await run(f);
  assert.equal(out.evidenceStatus,"INTERNAL_CONSISTENCY_PASS",JSON.stringify(out));
  assert.equal(out.baselineApprovalStatus,"SYNTHETIC_VERIFIED");
  assert.equal(out.securityStatus,"SYNTHETIC_PASS");
  assert.equal(out.overallStatus,"SYNTHETIC_MATCH_ONLY");
  assert.equal(out.rawExportCompletenessStatus,"RAW_EXPORT_COMPLETENESS_UNVERIFIED");
  assert.equal(out.legacyCheckerStatus,"NOT_INTEGRATED");
});
test("formal mode remains BLOCKED despite matching synthetic data",async (t) => {
  const out = await run(await fixture(t),"formal");
  assert.equal(out.overallStatus,"BLOCKED");
  assert.equal(out.securityStatus,"BLOCKED");
});
test("Evidence BLOCKED skips Security",(t) => blockedTest(t,async (f) => {
  f.record.success = false; await f.commit();
},"EXECUTION_RECORD_INVALID"));
test("Evidence BLOCKED does not invoke C1",async (t) => {
  const f = await fixture(t);
  f.record.success = false;
  await f.commit();
  assertSecurityNotRun(await run(f),"EXECUTION_RECORD_INVALID");
});
test("JSONL changed after B1 cannot invoke C1",async (t) => {
  const f = await fixture(t);
  const out = await validateCatalogA6Pipeline({...f.options(),
    afterEvidenceValidationForTest:() =>
      writeFile(path.join(f.bundle,"exports/snapshot.jsonl"),"{}\n")});
  assertSecurityNotRun(out,"EVIDENCE_CHANGED","EVIDENCE_REREAD");
});
test("manifest mapping changed after B1 cannot invoke C1",async (t) => {
  const f = await fixture(t);
  const out = await validateCatalogA6Pipeline({...f.options(),
    afterEvidenceValidationForTest:async () => {
      const file = path.join(f.bundle,"manifest.json");
      const manifest = JSON.parse(await (await import("node:fs/promises")).readFile(file,"utf8"));
      manifest.queries[0].jsonlFile = "exports/other.jsonl";
      await writeFile(file,JSON.stringify(manifest));
    }});
  assertSecurityNotRun(out,"EVIDENCE_CHANGED","EVIDENCE_REREAD");
});
test("JSONL row count changed after B1 cannot invoke C1",async (t) => {
  const f = await fixture(t);
  const out = await validateCatalogA6Pipeline({...f.options(),
    afterEvidenceValidationForTest:async () => {
      const file = path.join(f.bundle,"exports/snapshot.jsonl");
      const original = await (await import("node:fs/promises")).readFile(file,"utf8");
      await writeFile(file,original+original.split("\n")[0]+"\n");
    }});
  assertSecurityNotRun(out,"EVIDENCE_CHANGED","EVIDENCE_REREAD");
});
test("synthetic mutation hook is rejected in formal mode",async (t) => {
  const f = await fixture(t);
  const out = await validateCatalogA6Pipeline({...f.options("formal"),
    afterEvidenceValidationForTest:() => { throw new Error("must not run"); }});
  assert.equal(out.evidenceStatus,"INTERNAL_CONSISTENCY_BLOCKED",JSON.stringify(out));
  assert.equal(out.securityStatus,"BLOCKED",JSON.stringify(out));
  assert.equal(out.overallStatus,"BLOCKED",JSON.stringify(out));
  assert.ok(out.reasonCodes.includes("PIPELINE_INPUT_INVALID"),JSON.stringify(out));
});
test("Project Ref mismatch blocks",(t) => blockedTest(t,async (f) => {
  f.policy.projectRef = "aaaaaaaaaaaaaaaaaaaa"; await f.commit();
},"PROJECT_OR_DATABASE_MISMATCH"));
test("database name mismatch blocks",(t) => blockedTest(t,async (f) => {
  f.policy.databaseName = "other"; await f.commit();
},"PROJECT_OR_DATABASE_MISMATCH"));
test("PostgreSQL full version mismatch blocks",(t) => blockedTest(t,async (f) => {
  f.policy.postgresVersion = "17.10"; await f.commit();
},"PROJECT_OR_DATABASE_MISMATCH"));
test("SQL hash mismatch blocks",(t) => blockedTest(t,async (f) => {
  await writeFile(path.join(f.bundle,"approved/snapshot.sql"),sql+" ");
},"SQL_HASH_MISMATCH"));
test("raw CSV hash mismatch blocks",(t) => blockedTest(t,async (f) => {
  await writeFile(path.join(f.bundle,"raw/snapshot.csv"),"snapshot_row\n");
},"RAW_HASH_MISMATCH"));
test("JSONL hash mismatch blocks",(t) => blockedTest(t,async (f) => {
  await writeFile(path.join(f.bundle,"exports/snapshot.jsonl"),"{}\n");
},"JSONL_HASH_MISMATCH"));
test("unapproved baseline blocks despite Evidence PASS",(t) => blockedTest(t,async (f) => {
  f.baselineBytes = baseline(permissions(),"PENDING"); await f.commit();
},"BASELINE_UNAPPROVED"));
test("invalid baseline signature blocks",(t) => blockedTest(t,async (f) => {
  const b = JSON.parse(f.baselineBytes.toString());
  b.approval.signatureBase64 = Buffer.alloc(64).toString("base64");
  f.baselineBytes = Buffer.from(JSON.stringify(b)); await f.commit();
},"BASELINE_UNAPPROVED"));
test("unknown role blocks",(t) => blockedTest(t,async (f) => {
  f.rows.push(row("role","unapproved",{...f.rows.find((r) => r.section === "role").data,
    role_name:"unapproved",role_oid:"12"}));
  f.rows.push(row("effective_database","unapproved",{role:"unapproved",role_oid:"12",
    role_exists:true,connect:true,create:false,temp:false}));
  f.rows.push(row("effective_schema","unapproved:public",{role:"unapproved",schema:"public",
    role_oid:"12",schema_oid:"2200",role_exists:true,schema_exists:true,
    usage:true,create:false}));
  await f.commit();
},"UNKNOWN_ROLE"));
test("role attribute expansion blocks",(t) => blockedTest(t,async (f) => {
  f.rows.find((r) => r.section === "role" && r.item === "normal").data.bypass_rls = true;
  await f.commit();
},"ROLE_PRIVILEGE_DRIFT"));
test("self-consistent wrong effective role OID blocks before C1",async (t) => {
  const f = await fixture(t);
  f.rows.find((r) => r.section === "effective_database" && r.item === "normal")
    .data.role_oid = "10";
  await f.commit();
  assertSecurityNotRun(await run(f),"EFFECTIVE_ROLE_OID_MISMATCH");
});
test("self-consistent wrong Schema ACL OID blocks before C1",async (t) => {
  const f = await fixture(t);
  f.rows.find((r) => r.section === "schema_acl" && r.data.schema === "public")
    .data.schema_oid = "9999";
  await f.commit();
  assertSecurityNotRun(await run(f),"SCHEMA_OID_MISMATCH");
});
test("self-consistent Schema ACL count mismatch blocks before C1",async (t) => {
  const f = await fixture(t);
  f.rows.find((r) => r.section === "schema_acl_state" && r.item === "public")
    .data.explicit_acl_entry_count = 99;
  await f.commit();
  assertSecurityNotRun(await run(f),"SCHEMA_ACL_COUNT_MISMATCH");
});
test("new membership edge blocks",(t) => blockedTest(t,async (f) => {
  f.rows.push(row("membership","101",{...f.rows.find((r) => r.section === "membership").data,
    membership_oid:"101",member:"postgres",member_oid:"10",parent:"normal",parent_oid:"11"}));
  await f.commit();
},"UNKNOWN_MEMBERSHIP"));
test("membership option drift blocks",(t) => blockedTest(t,async (f) => {
  f.rows.find((r) => r.section === "membership").data.admin_option = true;
  await f.commit();
},"MEMBERSHIP_OPTION_DRIFT"));
test("PUBLIC CREATE expansion blocks",(t) => blockedTest(t,async (f) => {
  f.rows.find((r) => r.section === "public_database_privilege").data.create = true;
  await f.commit();
},"PUBLIC_PRIVILEGE_DRIFT"));
test("PUBLIC TEMP conflict blocks",(t) => blockedTest(t,async (f) => {
  f.rows.find((r) => r.section === "public_database_privilege").data.temp = true;
  await f.commit();
},"PUBLIC_PRIVILEGE_DRIFT"));
test("default ACL expansion blocks",(t) => blockedTest(t,async (f) => {
  f.rows.push(row("default_acl","9:0:10:EXECUTE",{default_acl_oid:"9",creator:"postgres",creator_oid:"10",
    schema:null,schema_oid:"0",scope:"ALL_SCHEMAS",object_type:"f",
    acl_source:"EXPLICIT_DEFAULT_ACL",grantee:"PUBLIC",grantee_oid:"0",
    grantor:"postgres",grantor_oid:"10",privilege:"EXECUTE",grantable:false}));
  f.rows.find((r) => r.section === "default_acl_state").data.explicit_default_acl_entry_count = 1;
  f.rows.find((r) => r.section === "default_acl_state").data.explicit_default_acl_record_count = 1;
  await f.commit();
},"DEFAULT_ACL_EXPANSION"));
test("new high privilege SET ROLE path blocks",(t) => blockedTest(t,async (f) => {
  f.rows.find((r) => r.section === "membership").data.set_option = true;
  await f.commit();
},"PRIVILEGED_ROLE_REACHABILITY_DRIFT"));
test("missing trust anchor or module input error fails closed",async (t) => {
  const f = await fixture(t);
  const out = await validateCatalogA6Pipeline({...f.options(),expectedPolicySha256:"bad"});
  assert.equal(out.overallStatus,"BLOCKED");
  assert.equal(out.securityStatus,"BLOCKED");
  assert.ok(out.reasonCodes.includes("PIPELINE_INPUT_INVALID"));
});
test("source authentication remains unverified on synthetic match",async (t) => {
  const out = await run(await fixture(t));
  assert.equal(out.sourceAuthenticationStatus,"SOURCE_AUTHENTICATION_UNVERIFIED");
  assert.notEqual(out.overallStatus,"PASS");
});
test("raw export completeness remains unverified on synthetic match",async (t) => {
  const out = await run(await fixture(t));
  assert.equal(out.rawExportCompletenessStatus,"RAW_EXPORT_COMPLETENESS_UNVERIFIED");
  assert.notEqual(out.overallStatus,"PASS");
});
test("bundle read exception fails closed",async (t) => {
  const f = await fixture(t);
  await rm(path.join(f.bundle,"manifest.json"));
  const out = await run(f);
  assert.equal(out.overallStatus,"BLOCKED");
  assert.equal(out.securityStatus,"BLOCKED");
  assert.ok(out.reasonCodes.includes("PIPELINE_ERROR"));
});
