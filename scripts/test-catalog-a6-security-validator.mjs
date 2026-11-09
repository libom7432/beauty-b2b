// Synthetic in-memory security comparison tests. No database client, network or file writes.
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { test } from "node:test";
import { approvalMessage, baselineContent, canonicalJson,
  validateCatalogA6Security } from "./catalog-a6-security-validator.mjs";

const sha = (x) => createHash("sha256").update(x).digest("hex");
const projectRef = "nnmdcezigmguqolbxzmb";
const row = (section,item,data) => ({section,item,row_key:`${section}:${item}`,data});
const roleIds = {normal:"11",high:"12",catalog_admin_reader_runtime:"13"};
const {privateKey,publicKey} = generateKeyPairSync("ed25519");
const keyPem = publicKey.export({type:"spki",format:"pem"});

function approvedPermissions() {
  return {
    roles:[
      {name:"normal",connectionLimit:-1,superuser:false,createDb:false,createRole:false,
        login:true,replication:false,bypassRls:false,inherit:true},
      {name:"high",connectionLimit:-1,superuser:true,createDb:true,createRole:true,
        login:false,replication:false,bypassRls:true,inherit:true},
      {name:"catalog_admin_reader_runtime",connectionLimit:-1,superuser:false,createDb:false,
        createRole:false,login:true,replication:false,bypassRls:false,inherit:false},
    ],
    memberships:[{member:"normal",parent:"high",grantor:"high",adminOption:false,
      inheritOption:false,setOption:false}],
    database:{name:"postgres",serverVersion:"17.11",owner:"high",
      public:{connect:true,create:false,temp:false},
      aclIsNull:false,aclSource:"EXPLICIT"},
    schemas:[{name:"public",exists:true,owner:"high",aclIsNull:false,aclSource:"EXPLICIT"}],
    publicSchemas:[{name:"public",exists:true,usage:true,create:false,aclSource:"EXPLICIT"}],
    databaseAcl:[{aclSource:"EXPLICIT",grantee:"PUBLIC",grantor:"high",
      privilege:"CONNECT",grantable:false}],
    databaseBuiltinAcl:[{aclSource:"BUILTIN_REFERENCE",grantee:"PUBLIC",grantor:"high",
      privilege:"TEMPORARY",grantable:false}],
    schemaAcl:[{schema:"public",aclSource:"EXPLICIT",grantee:"PUBLIC",grantor:"high",
      privilege:"USAGE",grantable:false}],
    schemaBuiltinAcl:[{schema:"public",aclSource:"BUILTIN_REFERENCE",grantee:"high",
      grantor:"high",privilege:"CREATE",grantable:false}],
    defaultAcl:[],
    defaultAclBuiltin:[{creator:"high",scope:"ALL_SCHEMAS",schema:null,objectType:"f",
      aclSource:"BUILTIN_REFERENCE_NOT_EFFECTIVE_DEFAULT",grantee:"PUBLIC",grantor:"high",
      privilege:"EXECUTE",grantable:false}],
    effectiveDatabase:[
      {role:"normal",roleExists:true,connect:true,create:false,temp:false},
      {role:"high",roleExists:true,connect:true,create:true,temp:false},
      {role:"catalog_admin_reader_runtime",roleExists:true,connect:true,create:false,temp:false},
    ],
    effectiveSchema:[
      {role:"normal",schema:"public",roleExists:true,schemaExists:true,usage:true,create:false},
      {role:"high",schema:"public",roleExists:true,schemaExists:true,usage:true,create:true},
      {role:"catalog_admin_reader_runtime",schema:"public",roleExists:true,
        schemaExists:true,usage:true,create:false},
    ],
    privilegedSetRolePaths:[],
  };
}

function snapshot(p) {
  const rows = [
    row("database","postgres",{name:"postgres",server_version:p.database.serverVersion,
      owner:p.database.owner,owner_oid:roleIds[p.database.owner]}),
    row("database_acl_state","5",{database:"postgres",acl_is_null:p.database.aclIsNull,
      acl_source:p.database.aclSource,owner_oid:roleIds[p.database.owner]}),
    row("public_database_privilege","5",{connect:p.database.public.connect,
      create:p.database.public.create,temp:p.database.public.temp}),
    row("default_acl_state","postgres",{explicit_default_acl_entry_count:p.defaultAcl.length,
      zero_entries_mean_builtin_rules_still_apply:true}),
  ];
  p.roles.forEach((r) => rows.push(row("role",r.name,{role_name:r.name,
    role_oid:roleIds[r.name] ?? "99",connection_limit:r.connectionLimit,
    superuser:r.superuser,create_db:r.createDb,create_role:r.createRole,login:r.login,
    replication:r.replication,bypass_rls:r.bypassRls,inherit:r.inherit})));
  p.memberships.forEach((m,i) => rows.push(row("membership",String(i+100),{
    membership_oid:String(i+100),member:m.member,member_oid:roleIds[m.member] ?? "99",
    parent:m.parent,parent_oid:roleIds[m.parent] ?? "99",grantor:m.grantor,
    grantor_oid:roleIds[m.grantor] ?? "99",member_name_resolved:true,
    parent_name_resolved:true,grantor_name_resolved:true,admin_option:m.adminOption,
    inherit_option:m.inheritOption,set_option:m.setOption})));
  p.schemas.forEach((s) => {
    rows.push(row("schema",s.name,{exists:s.exists,owner:s.owner,
      owner_oid:s.owner ? roleIds[s.owner] : null}));
    rows.push(row("schema_acl_state",s.name,{schema:s.name,
      exists:s.exists,owner_oid:s.owner ? roleIds[s.owner] : null,
      acl_is_null:s.aclIsNull,acl_source:s.aclSource}));
  });
  p.publicSchemas.forEach((s) => rows.push(row("public_schema_privilege",s.name,{
    schema:s.name,exists:s.exists,usage:s.usage,create:s.create,acl_source:s.aclSource})));
  const acl = (section,items) => items.forEach((a,i) => rows.push(row(section,String(i+1),{
    ...(a.schema !== undefined ? {schema:a.schema} : {}),
    ...(a.creator !== undefined ? {creator:a.creator,creator_oid:roleIds[a.creator],
      scope:a.scope,object_type:a.objectType} : {}),
    acl_source:a.aclSource,grantee:a.grantee,grantee_oid:a.grantee === "PUBLIC" ? "0" : roleIds[a.grantee],
    grantor:a.grantor,grantor_oid:roleIds[a.grantor],
    privilege:a.privilege,grantable:a.grantable})));
  acl("database_acl",p.databaseAcl);
  acl("database_builtin_acl",p.databaseBuiltinAcl);
  acl("schema_acl",p.schemaAcl);
  acl("schema_builtin_acl",p.schemaBuiltinAcl);
  acl("default_acl",p.defaultAcl);
  acl("default_acl_builtin",p.defaultAclBuiltin);
  p.effectiveDatabase.forEach((x) => rows.push(row("effective_database",x.role,{
    role:x.role,role_exists:x.roleExists,connect:x.connect,create:x.create,temp:x.temp})));
  p.effectiveSchema.forEach((x) => rows.push(row("effective_schema",`${x.role}:${x.schema}`,{
    role:x.role,schema:x.schema,role_exists:x.roleExists,schema_exists:x.schemaExists,
    usage:x.usage,create:x.create})));
  return rows;
}

function signedBaseline(permissions=approvedPermissions(),status="SYNTHETIC_APPROVED") {
  const b = {kind:"CATALOG_A6_SECURITY_BASELINE_V1",baselineId:"synthetic-a6-v1",
    version:"1",projectRef,databaseName:"postgres",postgresVersion:"17.11",
    approval:{status,approver:"Synthetic Reviewer",signedRecordRef:"synthetic://approval/1",
      signedAtUtc:"2026-11-09T03:49:32.000Z",signerKeyId:"synthetic-key-1",
      signatureBase64:""},contentSha256:"",permissions};
  b.contentSha256 = sha(Buffer.from(canonicalJson(baselineContent(b))));
  b.approval.signatureBase64 = sign(null,approvalMessage(b),privateKey).toString("base64");
  const bytes = Buffer.from(JSON.stringify(b));
  return {b,bytes,anchor:sha(bytes)};
}
const trust = {mode:"synthetic",expectedProjectRef:projectRef,
  expectedDatabaseName:"postgres",expectedPostgresVersion:"17.11",
  trustedApprovalPublicKeyPem:keyPem,trustedSignerKeyId:"synthetic-key-1",
  trustedApprovalRecordRef:"synthetic://approval/1"};
function run(rows,baseline=signedBaseline(),overrides={}) {
  return validateCatalogA6Security(rows,baseline.bytes,baseline.anchor,{...trust,...overrides});
}
function blockedTest(name,mutate,code) {
  test(name,() => {
    const p = approvedPermissions(),rows = snapshot(p);
    mutate(rows,p);
    const out = run(rows);
    assert.equal(out.security.status,"BLOCKED",JSON.stringify(out));
    if (code) assert.ok(out.security.findings.some((x) => x.code === code),JSON.stringify(out));
  });
}

test("matching signed synthetic baseline yields synthetic-only comparison PASS",() => {
  const out = run(snapshot(approvedPermissions()));
  assert.equal(out.baselineValidation.status,"SYNTHETIC_VERIFIED",JSON.stringify(out));
  assert.equal(out.permissionComparison.status,"PASS",JSON.stringify(out));
  assert.equal(out.security.status,"SYNTHETIC_PASS",JSON.stringify(out));
});
test("pending approval remains BLOCKED even with identical permissions",() => {
  const out = run(snapshot(approvedPermissions()),signedBaseline(approvedPermissions(),"PENDING"));
  assert.equal(out.permissionComparison.status,"PASS",JSON.stringify(out));
  assert.equal(out.security.status,"BLOCKED");
  assert.ok(out.security.findings.some((x) => x.code === "BASELINE_UNAPPROVED"));
});
test("synthetic approval cannot yield formal Security PASS",() => {
  const out = run(snapshot(approvedPermissions()),signedBaseline(),{mode:"formal"});
  assert.equal(out.security.status,"BLOCKED");
});
test("full-file baseline hash mismatch blocks",() => {
  const b = signedBaseline();
  const out = validateCatalogA6Security(snapshot(approvedPermissions()),b.bytes,"0".repeat(64),trust);
  assert.equal(out.security.status,"BLOCKED");
  assert.ok(out.security.findings.some((x) => x.code === "BASELINE_HASH_MISMATCH"));
});
test("content field change invalidates content hash and signature",() => {
  const b = signedBaseline();
  b.b.permissions.roles[0].createDb = true;
  b.bytes = Buffer.from(JSON.stringify(b.b)); b.anchor = sha(b.bytes);
  const out = run(snapshot(approvedPermissions()),b);
  assert.equal(out.security.status,"BLOCKED");
  assert.ok(out.security.findings.some((x) => x.code === "BASELINE_HASH_MISMATCH"));
});
test("recomputed content hash without trusted new signature stays BLOCKED",() => {
  const b = signedBaseline();
  b.b.permissions.roles[0].createDb = true;
  b.b.contentSha256 = sha(Buffer.from(canonicalJson(baselineContent(b.b))));
  b.bytes = Buffer.from(JSON.stringify(b.b)); b.anchor = sha(b.bytes);
  const out = run(snapshot(approvedPermissions()),b);
  assert.equal(out.security.status,"BLOCKED");
  assert.ok(out.security.findings.some((x) => x.code === "BASELINE_UNAPPROVED"));
});
blockedTest("unknown role",(rows) => {
  rows.push(row("role","unknown",{...rows.find((r) => r.section === "role").data,
    role_name:"unknown",role_oid:"99"}));
},"UNKNOWN_ROLE");
blockedTest("missing role",(rows) => {
  rows.splice(rows.findIndex((r) => r.section === "role" && r.item === "normal"),1);
},"MISSING_ROLE");
blockedTest("role privilege expansion",(rows) => {
  rows.find((r) => r.section === "role" && r.item === "normal").data.bypass_rls = true;
},"ROLE_PRIVILEGE_DRIFT");
for (const [field,label] of [["admin_option","admin"],["inherit_option","inherit"],
  ["set_option","set"]]) blockedTest(`${label} membership option drift`,(rows) => {
    rows.find((r) => r.section === "membership").data[field] = true;
  },"MEMBERSHIP_OPTION_DRIFT");
blockedTest("membership grantor drift",(rows) => {
  rows.find((r) => r.section === "membership").data.grantor = "normal";
},"MEMBERSHIP_GRANTOR_DRIFT");
blockedTest("membership OID cannot contradict role names",(rows) => {
  rows.find((r) => r.section === "membership").data.member_oid = "12";
},"MEMBERSHIP_IDENTITY_INVALID");
blockedTest("unknown membership edge",(rows) => {
  rows.push(row("membership","101",{...rows.find((r) => r.section === "membership").data,
    membership_oid:"101",member:"catalog_admin_reader_runtime",member_oid:"13",set_option:true}));
},"UNKNOWN_MEMBERSHIP");
blockedTest("missing membership edge",(rows) => {
  rows.splice(rows.findIndex((r) => r.section === "membership"),1);
},"MISSING_MEMBERSHIP");
blockedTest("PUBLIC database CREATE expansion",(rows) => {
  rows.find((r) => r.section === "public_database_privilege").data.create = true;
},"PUBLIC_PRIVILEGE_DRIFT");
blockedTest("PUBLIC database TEMP drift",(rows) => {
  rows.find((r) => r.section === "public_database_privilege").data.temp = true;
},"PUBLIC_PRIVILEGE_DRIFT");
blockedTest("Schema PUBLIC CREATE expansion",(rows) => {
  rows.find((r) => r.section === "public_schema_privilege").data.create = true;
},"PUBLIC_PRIVILEGE_DRIFT");
blockedTest("default ACL expansion",(rows) => {
  rows.push(row("default_acl","1",{creator:"high",scope:"ALL_SCHEMAS",schema:null,
    object_type:"f",acl_source:"EXPLICIT_DEFAULT_ACL",grantee:"PUBLIC",grantor:"high",
    privilege:"EXECUTE",grantable:false}));
},"DEFAULT_ACL_EXPANSION");
blockedTest("new high-privilege SET ROLE path",(rows) => {
  rows.find((r) => r.section === "membership").data.set_option = true;
},"PRIVILEGED_ROLE_REACHABILITY_DRIFT");
blockedTest("runtime role effective TEMP must remain false",(rows) => {
  rows.find((r) => r.section === "effective_database" &&
    r.item === "catalog_admin_reader_runtime").data.temp = true;
},"RUNTIME_TEMP_CONFLICT");
blockedTest("duplicate role record",(rows) => {
  rows.push(structuredClone(rows.find((r) => r.section === "role")));
},"DUPLICATE_PERMISSION_RECORD");
blockedTest("duplicate membership edge",(rows) => {
  const copy = structuredClone(rows.find((r) => r.section === "membership"));
  copy.item = "101"; copy.row_key = "membership:101"; copy.data.membership_oid = "101";
  rows.push(copy);
},"DUPLICATE_PERMISSION_RECORD");
blockedTest("unknown Schema",(rows) => {
  rows.push(row("schema_acl_state","unapproved",{schema:"unapproved",exists:true,
    acl_is_null:true,acl_source:"BUILTIN_DEFAULT"}));
},"UNKNOWN_SCHEMA");
blockedTest("database owner change is permission drift",(rows) => {
  rows.find((r) => r.section === "database").data.owner = "normal";
  rows.find((r) => r.section === "database").data.owner_oid = "11";
  rows.find((r) => r.section === "database_acl_state").data.owner_oid = "11";
},"PUBLIC_PRIVILEGE_DRIFT");
blockedTest("Schema owner change is permission drift",(rows) => {
  rows.find((r) => r.section === "schema").data.owner = "normal";
  rows.find((r) => r.section === "schema").data.owner_oid = "11";
  rows.find((r) => r.section === "schema_acl_state").data.owner_oid = "11";
},"SCHEMA_ACL_DRIFT");
blockedTest("unknown ACL grantee",(rows) => {
  rows.find((r) => r.section === "schema_acl").data.grantee = "not-approved";
},"UNKNOWN_ACL_PRINCIPAL");
blockedTest("ACL grantee OID cannot contradict its role name",(rows) => {
  rows.find((r) => r.section === "schema_acl").data.grantee_oid = "12";
},"ACL_PRINCIPAL_IDENTITY_INVALID");
blockedTest("duplicate ACL grant cannot be collapsed by map comparison",(rows) => {
  const copy = structuredClone(rows.find((r) => r.section === "database_acl"));
  copy.item = "2"; copy.row_key = "database_acl:2";
  rows.push(copy);
},"DUPLICATE_PERMISSION_RECORD");
blockedTest("snapshot PostgreSQL version outside signed baseline scope",(rows) => {
  rows.find((r) => r.section === "database").data.server_version = "17.10";
},"BASELINE_TARGET_MISMATCH");
blockedTest("missing default ACL state blocks even when explicit defaults are empty",(rows) => {
  rows.splice(rows.findIndex((r) => r.section === "default_acl_state"),1);
},"SNAPSHOT_SECTION_MISSING");
blockedTest("missing runtime effective row blocks",(rows) => {
  rows.splice(rows.findIndex((r) => r.section === "effective_database" &&
    r.item === "catalog_admin_reader_runtime"),1);
},"MISSING_EFFECTIVE_ROLE");
test("signed synthetic PUBLIC TEMP acceptance cannot override runtime TEMP=false",() => {
  const p = approvedPermissions();
  p.database.public.temp = true;
  const out = run(snapshot(p),signedBaseline(p));
  assert.equal(out.baselineValidation.status,"SYNTHETIC_VERIFIED");
  assert.equal(out.permissionComparison.status,"BLOCKED");
  assert.equal(out.security.status,"BLOCKED");
  assert.ok(out.security.findings.some((x) => x.code === "RUNTIME_TEMP_CONFLICT"));
});
