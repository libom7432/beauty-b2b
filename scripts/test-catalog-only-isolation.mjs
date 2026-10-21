import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { completeSnapshot } from "./catalog-supabase-snapshot-fixtures.mjs";
import { MIGRATIONS, prepareCatalogOnlyMigrations,
  verifyCatalogOnlyMigrations } from "./prepare-catalog-only-migrations.mjs";

const foundation = "20261013120000";
const identity = "20261018120000";
const reader = "20261020120000";
const script = fileURLToPath(new URL("./check-catalog-supabase-snapshot.mjs",import.meta.url));
const releaseScript = fileURLToPath(new URL("./prepare-catalog-only-migrations.mjs",import.meta.url));
const ref = "abcdefghijklmnopqrst";
const rfqRef = "qrstabcdefghijklmnop";

test("PostgreSQL 17 snapshot SQL captures membership options and inventory counts",async () => {
  const sql = await readFile(new URL("./catalog-supabase-permission-snapshot.sql",import.meta.url),"utf8");
  assert.match(sql,/'admin_option'\s*,\s*m\.admin_option/);
  assert.match(sql,/'inherit_option'\s*,\s*m\.inherit_option/);
  assert.match(sql,/'set_option'\s*,\s*m\.set_option/);
  for (const key of ["role_count","business_object_count","snapshot_row_count"])
    assert.ok(sql.includes(`'${key}'`));
  assert.match(sql,/^WITH\s/m);
  assert.equal((sql.match(/;/g) ?? []).length,1);
});

function platformPermissions(rows) {
  rows.push({section:"schema",item:"public",data:{exists:true,owner:"postgres"}});
  for (const role of ["authenticated","service_role","postgres","authenticator"])
    rows.push({section:"role",item:role,data:{login:role === "postgres" || role === "authenticator",
      inherit:false,superuser:false,bypass_rls:false,create_db:false,
      create_role:false,replication:false}});
  for (const row of rows.filter((entry) => entry.section === "role"))
    row.data = {inherit:false,superuser:false,bypass_rls:false,create_db:false,
      create_role:false,replication:false,...row.data};
  rows.push({section:"database_acl",item:"postgres:CREATE",
    data:{grantee:"postgres",privilege:"CREATE",grantable:false}});
  rows.push({section:"schema_acl",item:"public:postgres:CREATE",
    data:{schema:"public",grantee:"postgres",privilege:"CREATE",grantable:false}});
  for (const role of ["anon","authenticated"]) {
    if (!rows.some((r) => r.section === "effective_database" && r.item === role))
      rows.push({section:"effective_database",item:role,
        data:{connect:true,create:false,temp:false}});
    rows.push({section:"effective_schema",item:`${role}:public`,
      data:{usage:true,create:false}});
  }
  rows.push({section:"permission_inventory",item:"database-acl-and-membership",
    data:{complete:true,membership_count:rows.filter((row) => row.section === "membership").length,
      database_acl_count:rows.filter((row) => row.section === "database_acl").length,
      public_schema_acl_count:rows.filter((row) => row.section === "schema_acl" &&
        row.data?.schema === "public").length,
      role_count:rows.filter((row) => row.section === "role").length,
      business_object_count:rows.filter((row) => row.section === "business_object").length,
      snapshot_row_count:rows.length + 1}});
  return rows;
}

function snapshot(stage, adminIdentity = "absent") {
  const schemas = ["catalog_private","catalog_public","rfq_private","admin_private"];
  if (stage === "empty") return platformPermissions([
    {section:"database",item:"synthetic",data:{owner:"postgres"}},
    {section:"migration_registry",item:"supabase_migrations.schema_migrations",data:{exists:false}},
    {section:"business_inventory",item:"catalog-rfq-admin-prefixes",data:{complete:true}},
    ...schemas.map((item) => ({section:"schema",item,data:{exists:false}})),
    {section:"role",item:"anon",data:{login:false}},
  ]);
  const rows = completeSnapshot(stage === "admin-read" ? "post" : "pre");
  rows.find((r) => r.section === "database").data.owner = "postgres";
  for (const row of rows) if (row.section === "schema" && schemas.includes(row.item))
    Object.assign(row.data,{exists:row.item !== "rfq_private" &&
      (row.item !== "admin_private" || adminIdentity === "present"),owner:"catalog_owner"});
  rows.push({section:"business_inventory",item:"catalog-rfq-admin-prefixes",data:{complete:true}});
  for (const name of ["catalog_private","catalog_public",...(adminIdentity === "present" ? ["admin_private"] : [])])
    rows.push({section:"business_object",item:`schema:${name}`,data:{kind:"schema"}});
  for (const name of ["catalog_private","catalog_public",...(adminIdentity === "present" ? ["admin_private"] : [])])
    rows.push({section:"schema_acl",item:`${name}:catalog_owner:USAGE`,
      data:{schema:name,grantee:"catalog_owner",privilege:"USAGE"}});
  for (const name of ["catalog_private","catalog_public"])
    rows.push({section:"effective_schema",item:`anon:${name}`,
      data:{role:"anon",schema:name,usage:name === "catalog_public",create:false}});
  for (const row of rows.filter((r) => r.section === "relation" && r.data.exists))
    rows.push({section:"business_object",item:`relation:${row.item}`,data:{kind:"relation"}});
  for (const row of rows.filter((r) => r.section === "relation" && r.data.exists))
    rows.push({section:"relation_acl",item:`${row.item}:${row.data.owner}:SELECT`,
      data:{relation:row.item,grantee:row.data.owner,privilege:"SELECT"}});
  for (const row of rows.filter((r) => r.section === "function"))
    rows.push({section:"business_object",item:`function:${row.data.canonical_signature}`,data:{kind:"function"}});
  if (adminIdentity === "present") {
    rows.push({section:"relation",item:"admin_private.admin_users",data:{exists:true,
      actual_kind:"r",owner:"catalog_owner",rls_enabled:true,rls_forced:true,
      columns:["id","auth_user_id","status","role","created_at","updated_at","disabled_at"]}});
    rows.push({section:"business_object",item:"relation:admin_private.admin_users",data:{kind:"relation"}});
    rows.push({section:"relation_acl",item:"admin_private.admin_users:catalog_owner:SELECT",
      data:{relation:"admin_private.admin_users",grantee:"catalog_owner",privilege:"SELECT"}});
    for (const role of ["admin_directory_reader","admin_directory_provisioner"])
      rows.push({section:"role",item:role,data:{login:false,inherit:false,superuser:false,
        bypass_rls:false,create_db:false,create_role:false,replication:false}});
    for (const role of ["admin_directory_reader","admin_directory_provisioner"])
      rows.push({section:"effective_database",item:role,
        data:{connect:true,create:false,temp:false}});
    rows.push({section:"policy",item:"admin_private.admin_users.admin_directory_reader_select",
      data:{roles:["admin_directory_reader"],command:"r",using_true:true}});
    rows.push({section:"policy",item:"admin_private.admin_users.admin_directory_provisioner_all",
      data:{roles:["admin_directory_provisioner"],command:"*",using_true:true,check_true:true}});
  }
  return platformPermissions(rows);
}

async function check(rows, stage, versions, adminIdentity = "absent", argsOverride) {
  const dir = await mkdtemp(join(tmpdir(),"catalog-only-gate-"));
  try {
    const snapshotPath = join(dir,"snapshot.jsonl");
    const historyPath = join(dir,"versions.txt");
    await writeFile(snapshotPath,rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
    if (versions !== null) await writeFile(historyPath,versions.join("\n") + "\n");
    const args = (typeof argsOverride === "function" ? argsOverride(snapshotPath,historyPath) : argsOverride) ??
      ["catalog-only",snapshotPath,stage,
      ...(versions === null ? [] : [historyPath]),adminIdentity];
    const result = spawnSync(process.execPath,[script,...args],{encoding:"utf8"});
    assert.equal(result.error,undefined);
    return {exit:result.status,output:result.stdout ? JSON.parse(result.stdout) : null,stderr:result.stderr};
  } finally { await rm(dir,{recursive:true,force:true}); }
}

test("catalog-only CLI accepts exact empty, foundation and admin-read baselines",async () => {
  for (const [stage,versions] of [["empty",[]],["foundation",[foundation]],
    ["admin-read",[foundation,reader]]]) {
    const result = await check(snapshot(stage),stage,versions);
    assert.equal(result.exit,0,`${stage}: ${JSON.stringify(result.output)}`);
    assert.equal(result.output.decision,"PASS");
  }
  const login = await check(snapshot("admin-read","present"),"admin-read",
    [foundation,identity,reader],"present");
  assert.equal(login.exit,0,JSON.stringify(login.output));
});

test("catalog-only CLI rejects missing, extra and malformed migration histories",async () => {
  const cases = [
    ["foundation",[],"MISSING_MIGRATION"],
    ["foundation",[foundation,reader],"UNEXPECTED_MIGRATION"],
    ["admin-read",[foundation],"MISSING_MIGRATION"],
    ["admin-read",[foundation,reader,"20261010112952"],"RFQ_MIGRATION_PRESENT"],
    ["foundation",[foundation,foundation],"MIGRATION_HISTORY_INVALID"],
    ["foundation",[foundation,"bad"],"MIGRATION_HISTORY_INVALID"],
    ["foundation",null,"MIGRATION_HISTORY_INVALID"],
    ["empty",null,"MIGRATION_HISTORY_INVALID"],
    ["empty",[foundation],"UNEXPECTED_MIGRATION"],
  ];
  for (const [stage,versions,code] of cases) {
    const result = await check(snapshot(stage),stage,versions);
    assert.notEqual(result.exit,0);
    assert.equal(result.output.decision,"BLOCKED");
    assert.ok(result.output.findings.some((f) => f.code === code),JSON.stringify(result.output));
  }
  const missingFile = await check(snapshot("foundation"),"foundation",[foundation],"absent",
    (snapshotPath,historyPath) => ["catalog-only",snapshotPath,"foundation",
      `${historyPath}.missing`,"absent"]);
  assert.equal(missingFile.exit,1);
  assert.ok(missingFile.output.findings.some((f) => f.code === "MIGRATION_HISTORY_INVALID"));
});

test("catalog-only CLI rejects business objects, RFQ schema, role, RLS and missing metadata",async () => {
  const tests = [
    ["empty",[],(rows) => rows.push({section:"business_object",item:"relation:catalog_private.products",
      data:{kind:"relation"}}),"UNKNOWN_BUSINESS_OBJECT"],
    ["empty",[],(rows) => rows.push({section:"business_object",item:"relation:public.products",
      data:{kind:"relation"}}),"UNKNOWN_BUSINESS_OBJECT"],
    ["empty",[],(rows) => rows.push({section:"business_object",item:"schema:other_project",
      data:{kind:"schema"}}),"UNKNOWN_BUSINESS_SCHEMA"],
    ["foundation",[foundation],(rows) => rows.find((r) => r.section === "schema" &&
      r.item === "rfq_private").data.exists = true,"UNEXPECTED_SCHEMA"],
    ["foundation",[foundation],(rows) => rows.push({section:"business_object",
      item:"relation:rfq_private.rfq_requests",data:{kind:"relation"}}),"UNKNOWN_BUSINESS_OBJECT"],
    ["foundation",[foundation],(rows) => rows.push({section:"role",item:"catalog_unknown",
      data:{login:true}}),"UNKNOWN_BUSINESS_ROLE"],
    ["empty",[],(rows) => rows.push({section:"role",item:"unreviewed_reader",
      data:{login:true}}),"UNKNOWN_BUSINESS_ROLE"],
    ["foundation",[foundation],(rows) => rows.push({section:"function",item:"catalog_private.unknown()",
      data:{canonical_signature:"catalog_private.unknown()",owner:"catalog_owner"}}),"UNKNOWN_PRIVATE_FUNCTION"],
    ["foundation",[foundation],(rows) => rows.push({section:"policy",
      item:"catalog_private.products.extra",data:{roles:["anon"]}}),"UNKNOWN_POLICY"],
    ["foundation",[foundation],(rows) => rows.push({section:"relation_acl",
      item:"catalog_private.products:unexpected:SELECT",
      data:{relation:"catalog_private.products",grantee:"unexpected",privilege:"SELECT"}}),"UNKNOWN_RELATION_ACL"],
    ["foundation",[foundation],(rows) => rows.splice(rows.findIndex((r) =>
      r.section === "effective_relation" && r.item === "anon:catalog_private.products"),1),"SNAPSHOT_INCOMPLETE"],
    ["foundation",[foundation],(rows) => rows.find((r) => r.section === "relation" &&
      r.item === "catalog_public.products").data.columns = [],"PUBLIC_VIEW_COLUMNS"],
    ["foundation",[foundation],(rows) => rows.find((r) => r.section === "relation" &&
      r.item === "catalog_private.products").data.rls_enabled = false,"RLS_DISABLED"],
    ["foundation",[foundation],(rows) => rows.splice(rows.findIndex((r) =>
      r.section === "business_inventory"),1),"SNAPSHOT_INCOMPLETE"],
    ["admin-read",[foundation,reader],(rows) => rows.find((r) => r.section === "role" &&
      r.item === "catalog_admin_reader_runtime").data.login = false,"READER_ROLE_FLAGS"],
    ["admin-read",[foundation,reader],(rows) => rows.splice(rows.findIndex((r) =>
      r.section === "policy" && r.item.endsWith("catalog_admin_reader_products")),1),"MISSING_POLICY"],
  ];
  for (const [stage,versions,mutate,code] of tests) {
    const rows = snapshot(stage); mutate(rows);
    const result = await check(rows,stage,versions);
    assert.equal(result.exit,1,JSON.stringify(result));
    assert.equal(result.output.decision,"BLOCKED");
    assert.ok(result.output.findings.some((f) => f.code === code),JSON.stringify(result.output));
  }
});

test("empty CLI rejects elevated grants, inheritance and incomplete permission metadata",async () => {
  const elevatedGrant = (rows) => {
    rows.push({section:"database_acl",item:"PUBLIC:CREATE",
      data:{grantee:"PUBLIC",privilege:"CREATE",grantable:false}});
    rows.find((r) => r.section === "permission_inventory").data.database_acl_count++;
    rows.find((r) => r.section === "permission_inventory").data.snapshot_row_count++;
  };
  const inheritedRole = (rows, parent = "service_role") => {
    rows.push({section:"membership",item:`anon->${parent}`,
      data:{member:"anon",parent,admin_option:false,inherit_option:false,set_option:true}});
    rows.find((r) => r.section === "permission_inventory").data.membership_count++;
    rows.find((r) => r.section === "permission_inventory").data.snapshot_row_count++;
  };
  const cases = [
    [(rows) => elevatedGrant(rows),"PUBLIC_DATABASE_CREATE_OR_TEMP"],
    [(rows) => {
      rows.push({section:"database_acl",item:"PUBLIC:TEMPORARY",
        data:{grantee:"PUBLIC",privilege:"TEMPORARY",grantable:false}});
      rows.find((r) => r.section === "permission_inventory").data.database_acl_count++;
      rows.find((r) => r.section === "permission_inventory").data.snapshot_row_count++;
    },"PUBLIC_DATABASE_CREATE_OR_TEMP"],
    [(rows) => inheritedRole(rows),"UNREVIEWED_ROLE_MEMBERSHIP"],
    [(rows) => { elevatedGrant(rows); inheritedRole(rows); },"UNREVIEWED_ROLE_MEMBERSHIP"],
    [(rows) => inheritedRole(rows,"postgres"),"UNREVIEWED_ROLE_MEMBERSHIP"],
    [(rows) => {
      rows.push({section:"membership",item:"dashboard_user->postgres",
        data:{member:"dashboard_user",parent:"postgres"}});
      rows.find((r) => r.section === "permission_inventory").data.membership_count++;
    },"UNREVIEWED_ROLE_MEMBERSHIP"],
    [(rows) => rows.splice(rows.findIndex((r) => r.section === "permission_inventory"),1),
      "SNAPSHOT_INCOMPLETE"],
    [(rows) => rows.splice(rows.findIndex((r) => r.section === "effective_database" &&
      r.item === "anon"),1),"SNAPSHOT_INCOMPLETE"],
    [(rows) => rows.splice(rows.findIndex((r) => r.section === "database_acl"),1),
      "SNAPSHOT_INCOMPLETE"],
    [(rows) => rows.splice(rows.findIndex((r) => r.section === "schema_acl" &&
      r.data?.schema === "public"),1),"SNAPSHOT_INCOMPLETE"],
  ];
  for (const [mutate,code] of cases) {
    const rows = snapshot("empty"); mutate(rows);
    const result = await check(rows,"empty",[]);
    assert.equal(result.exit,1,JSON.stringify(result));
    assert.equal(result.output.decision,"BLOCKED");
    assert.ok(result.output.findings.some((f) => f.code === code),JSON.stringify(result.output));
  }
});

test("PostgreSQL 17 platform membership candidates remain blocked with exact options",async () => {
  const candidate = ["anon","authenticated","service_role"].map((parent) => ({
    section:"membership",item:`authenticator->${parent}`,
    data:{member:"authenticator",parent,admin_option:false,inherit_option:false,set_option:true},
  }));
  const withMembers = () => {
    const rows = snapshot("empty");
    rows.push(...structuredClone(candidate));
    const inventory = rows.find((row) => row.section === "permission_inventory").data;
    inventory.membership_count += candidate.length;
    inventory.snapshot_row_count += candidate.length;
    return rows;
  };
  for (const [label,mutate,code] of [
    ["all three candidates",() => {},"UNREVIEWED_ROLE_MEMBERSHIP"],
    ["admin option",(rows) => { rows.at(-1).data.admin_option = true; },"UNREVIEWED_ROLE_MEMBERSHIP"],
    ["inherit option",(rows) => { rows.at(-1).data.inherit_option = true; },"UNREVIEWED_ROLE_MEMBERSHIP"],
    ["set option",(rows) => { rows.at(-1).data.set_option = false; },"UNREVIEWED_ROLE_MEMBERSHIP"],
    ["missing option",(rows) => { delete rows.at(-1).data.set_option; },"SNAPSHOT_INCOMPLETE"],
    ["null option",(rows) => { rows.at(-1).data.inherit_option = null; },"SNAPSHOT_INCOMPLETE"],
    ["non-boolean option",(rows) => { rows.at(-1).data.admin_option = "false"; },"SNAPSHOT_INCOMPLETE"],
    ["duplicate edge",(rows) => {
      rows.push(structuredClone(rows.at(-1)));
      const inventory = rows.find((row) => row.section === "permission_inventory").data;
      inventory.membership_count++;
      inventory.snapshot_row_count++;
    },"SNAPSHOT_INCOMPLETE"],
    ["extra privileged edge",(rows) => {
      rows.push({section:"membership",item:"anon->postgres",
        data:{member:"anon",parent:"postgres",admin_option:false,
          inherit_option:false,set_option:true}});
      const inventory = rows.find((row) => row.section === "permission_inventory").data;
      inventory.membership_count++;
      inventory.snapshot_row_count++;
    },"UNREVIEWED_ROLE_MEMBERSHIP"],
  ]) {
    const rows = withMembers(); mutate(rows);
    const result = await check(rows,"empty",[]);
    assert.equal(result.exit,1,`${label}: ${JSON.stringify(result)}`);
    assert.equal(result.output.decision,"BLOCKED");
    assert.ok(result.output.findings.some((finding) => finding.code === code),label);
  }
});

test("Catalog-only CLI rejects unsafe role attributes without trusting role names",async () => {
  const unsafeFlags = ["superuser","create_db","create_role","replication","bypass_rls"];
  for (const role of ["anon","authenticated"]) {
    for (const flag of unsafeFlags) {
      const rows = snapshot("empty");
      rows.find((row) => row.section === "role" && row.item === role).data[flag] = true;
      const result = await check(rows,"empty",[]);
      assert.equal(result.exit,1,`${role}.${flag}: ${JSON.stringify(result)}`);
      assert.equal(result.output.decision,"BLOCKED");
      assert.ok(result.output.findings.some((finding) => finding.code === "UNSAFE_ROLE_FLAGS"));
    }
    for (const flag of ["login","inherit"]) {
      const rows = snapshot("empty");
      rows.find((row) => row.section === "role" && row.item === role).data[flag] = true;
      const result = await check(rows,"empty",[]);
      assert.equal(result.exit,1,`${role}.${flag}: ${JSON.stringify(result)}`);
      assert.equal(result.output.decision,"BLOCKED");
    }
  }
  for (const flag of ["superuser","create_db","create_role","replication","login","inherit"]) {
    const rows = snapshot("empty");
    rows.find((row) => row.section === "role" && row.item === "service_role").data[flag] = true;
    const result = await check(rows,"empty",[]);
    assert.equal(result.exit,1,`service_role.${flag}: ${JSON.stringify(result)}`);
    assert.equal(result.output.decision,"BLOCKED");
  }
  const serviceBypass = snapshot("empty");
  serviceBypass.find((row) => row.section === "role" && row.item === "service_role")
    .data.bypass_rls = true;
  const allowed = await check(serviceBypass,"empty",[]);
  assert.equal(allowed.exit,0,JSON.stringify(allowed));
  assert.equal(allowed.output.decision,"PASS");
  for (const role of ["anon","authenticated","service_role","authenticator"]) {
    for (const value of [undefined,null,"false"]) {
      const rows = snapshot("empty");
      const data = rows.find((row) => row.section === "role" && row.item === role).data;
      if (value === undefined) delete data.superuser;
      else data.superuser = value;
      const result = await check(rows,"empty",[]);
      assert.equal(result.exit,1,`${role}:${String(value)}: ${JSON.stringify(result)}`);
      assert.equal(result.output.decision,"BLOCKED");
      assert.ok(result.output.findings.some((finding) => finding.code === "SNAPSHOT_INCOMPLETE"));
    }
  }
  for (const [role,flag,value] of [["authenticator","login",false],
    ["authenticator","inherit",true]]) {
    const rows = snapshot("empty");
    rows.find((row) => row.section === "role" && row.item === role).data[flag] = value;
    const result = await check(rows,"empty",[]);
    assert.equal(result.exit,1,JSON.stringify(result));
    assert.equal(result.output.decision,"BLOCKED");
  }
  const unknown = snapshot("empty");
  unknown.push({section:"role",item:"dashboard_user",data:{login:false,inherit:false,
    superuser:true,bypass_rls:false,create_db:false,create_role:false,replication:false}});
  const inventory = unknown.find((row) => row.section === "permission_inventory").data;
  inventory.role_count++;
  inventory.snapshot_row_count++;
  const result = await check(unknown,"empty",[]);
  assert.equal(result.exit,1,JSON.stringify(result));
  assert.equal(result.output.decision,"BLOCKED");
  assert.ok(result.output.findings.some((finding) => finding.code === "UNREVIEWED_PLATFORM_ROLE"));
  assert.ok(result.output.findings.some((finding) => finding.code === "UNSAFE_ROLE_FLAGS"));
});

test("Catalog-only inventory counts detect truncated roles and business objects",async () => {
  for (const [stage,versions,mutate] of [
    ["empty",[],(rows) => rows.splice(rows.findIndex((row) =>
      row.section === "role" && row.item === "authenticated"),1)],
    ["foundation",[foundation],(rows) => rows.splice(rows.findIndex((row) =>
      row.section === "business_object" && row.item === "relation:catalog_private.products"),1)],
    ["empty",[],(rows) => { delete rows.find((row) =>
      row.section === "permission_inventory").data.role_count; }],
    ["empty",[],(rows) => { delete rows.find((row) =>
      row.section === "database_acl").data.grantable; }],
    ["empty",[],(rows) => { delete rows.find((row) =>
      row.section === "migration_registry").data.exists; }],
  ]) {
    const rows = snapshot(stage); mutate(rows);
    const result = await check(rows,stage,versions);
    assert.equal(result.exit,1,JSON.stringify(result));
    assert.equal(result.output.decision,"BLOCKED");
    assert.ok(result.output.findings.some((finding) => finding.code === "SNAPSHOT_INCOMPLETE"));
  }
});

test("Catalog-only CLI enforces exact business objects for each stage",async () => {
  const addObject = (rows,item,kind) => {
    rows.push({section:"business_object",item,data:{kind}});
    const inventory = rows.find((row) => row.section === "permission_inventory").data;
    inventory.business_object_count++;
    inventory.snapshot_row_count++;
  };
  for (const [label,item,kind] of [
    ["catalog private schema","schema:catalog_private","schema"],
    ["catalog public schema","schema:catalog_public","schema"],
    ["admin schema","schema:admin_private","schema"],
    ["RFQ private schema","schema:rfq_private","schema"],
    ["RFQ public schema","schema:rfq_public","schema"],
    ["catalog table","relation:catalog_private.products","relation"],
    ["catalog view","relation:catalog_public.products","relation"],
    ["catalog function","function:catalog_private.product_row_guard()","function"],
    ["unknown schema","schema:unreviewed_private","schema"],
  ]) {
    const rows = snapshot("empty");
    addObject(rows,item,kind);
    const result = await check(rows,"empty",[]);
    assert.equal(result.exit,1,`${label}: ${JSON.stringify(result)}`);
    assert.equal(result.output.decision,"BLOCKED");
    assert.ok(result.output.findings.some((finding) =>
      ["UNEXPECTED_BUSINESS_OBJECT","UNKNOWN_BUSINESS_OBJECT",
        "UNKNOWN_BUSINESS_SCHEMA"].includes(finding.code)),label);
  }
  for (const [label,stage,versions,mutate,code] of [
    ["schema exists in empty","empty",[],(rows) => {
      rows.find((row) => row.section === "schema" && row.item === "catalog_private")
        .data.exists = true;
    },"UNEXPECTED_SCHEMA"],
    ["missing foundation schema object","foundation",[foundation],(rows) => {
      rows.splice(rows.findIndex((row) => row.section === "business_object" &&
        row.item === "schema:catalog_private"),1);
      const inventory = rows.find((row) => row.section === "permission_inventory").data;
      inventory.business_object_count--;
      inventory.snapshot_row_count--;
    },"MISSING_BUSINESS_OBJECT"],
    ["inconsistent foundation schema","foundation",[foundation],(rows) => {
      rows.find((row) => row.section === "schema" && row.item === "catalog_private")
        .data.exists = false;
    },"SNAPSHOT_INCONSISTENT"],
    ["unexpected Admin object","admin-read",[foundation,reader],(rows) => {
      addObject(rows,"schema:admin_private","schema");
    },"UNEXPECTED_BUSINESS_OBJECT"],
  ]) {
    const rows = snapshot(stage); mutate(rows);
    const result = await check(rows,stage,versions);
    assert.equal(result.exit,1,`${label}: ${JSON.stringify(result)}`);
    assert.equal(result.output.decision,"BLOCKED");
    assert.ok(result.output.findings.some((finding) => finding.code === code),label);
  }
  const valid = await check(snapshot("empty"),"empty",[]);
  assert.equal(valid.exit,0,JSON.stringify(valid));
  assert.equal(valid.output.decision,"PASS");
  const migrated = await check(snapshot("empty"),"empty",[foundation]);
  assert.equal(migrated.exit,1);
  assert.equal(migrated.output.decision,"BLOCKED");
  const noHistory = await check(snapshot("empty"),"empty",null);
  assert.notEqual(noHistory.exit,0);
  assert.notEqual(noHistory.output?.decision,"PASS");
});

test("explicit profile is mandatory and legacy mixed CLI still enforces RFQ",async () => {
  const rows = snapshot("foundation");
  const ambiguous = await check(rows,"foundation",[foundation],"absent",["catalog-only"]);
  assert.equal(ambiguous.exit,2);
  const legacyBlocked = await check(rows,"pre",[foundation],"absent",
    (snapshotPath,historyPath) => [snapshotPath,"pre",historyPath]);
  assert.equal(legacyBlocked.exit,1);
  assert.ok(legacyBlocked.output.findings.some((f) => f.code === "MISSING_MIGRATION"));
  const legacyPass = await check(completeSnapshot("pre"),"pre",
    ["20261010112952","20261011120000",foundation,identity],"absent",
    (snapshotPath,historyPath) => [snapshotPath,"pre",historyPath]);
  assert.equal(legacyPass.exit,0,JSON.stringify(legacyPass));
  assert.equal(legacyPass.output.decision,"PASS");
});

test("local release workspace has exact approved files and hashes",async () => {
  const temp = await mkdtemp(join(await realpath(tmpdir()),"catalog-release-test-"));
  try {
    for (const stage of Object.keys(MIGRATIONS)) {
      const target = join(temp,stage);
      const manifest = await prepareCatalogOnlyMigrations({stage,catalogRef:ref,rfqRef,outputDirectory:target});
      assert.deepEqual((await readdir(join(target,"supabase/migrations"))).sort(),
        [...MIGRATIONS[stage]].sort());
      assert.deepEqual(manifest.migrations.map((m) => m.name),MIGRATIONS[stage]);
      assert.equal(manifest.cloudExecutionApproved,false);
      assert.equal(manifest.manualProjectIdentityVerificationRequired,true);
      assert.equal((await readFile(join(target,"catalog-release-manifest.json"),"utf8")).includes(rfqRef),true);
      assert.deepEqual((await verifyCatalogOnlyMigrations({outputDirectory:target,catalogRef:ref,rfqRef})).versions,
        MIGRATIONS[stage].map((name) => name.slice(0,14)));
      await assert.rejects(prepareCatalogOnlyMigrations({stage,catalogRef:ref,rfqRef,outputDirectory:target}));
    }
    const tampered = join(temp,"foundation","supabase/migrations",MIGRATIONS.foundation[0]);
    await writeFile(tampered,"-- changed\n");
    await assert.rejects(verifyCatalogOnlyMigrations({outputDirectory:join(temp,"foundation"),catalogRef:ref,rfqRef}));
    const extra = join(temp,"admin-read","supabase/migrations","20261010112952_create_rfq_schema.sql");
    await writeFile(extra,"-- unexpected RFQ migration\n");
    await assert.rejects(verifyCatalogOnlyMigrations({outputDirectory:join(temp,"admin-read"),catalogRef:ref,rfqRef}));
    await assert.rejects(verifyCatalogOnlyMigrations({outputDirectory:join(temp,"admin-login"),catalogRef:rfqRef,rfqRef:ref}));
    await assert.rejects(prepareCatalogOnlyMigrations({stage:"foundation",catalogRef:ref,
      rfqRef:ref,outputDirectory:join(temp,"same-ref")}));
  } finally { await rm(temp,{recursive:true,force:true}); }
});

test("release CLI rejects path aliases, symlinks, existing targets and failed creation",async () => {
  const temp = await mkdtemp(join(await realpath(tmpdir()),"catalog-release-paths-"));
  const invoke = (target) => spawnSync(process.execPath,
    [releaseScript,"foundation",ref,rfqRef,target],{encoding:"utf8"});
  const verify = (target) => spawnSync(process.execPath,
    [releaseScript,"verify",target,ref,rfqRef],{encoding:"utf8"});
  const absent = async (path) => assert.rejects(access(path));
  try {
    const direct = join(temp,"direct");
    assert.equal(invoke(direct).status,0);
    assert.equal(verify(direct).status,0);
    assert.ok((await readdir(join(direct,"supabase/migrations"))).includes(MIGRATIONS.foundation[0]));

    const alias = join(temp,"alias");
    await symlink(temp,alias);
    const throughAncestor = join(alias,"escaped");
    assert.notEqual(invoke(throughAncestor).status,0);
    await absent(join(temp,"escaped"));
    assert.notEqual(verify(join(alias,"direct")).status,0);

    const leaf = join(temp,"leaf-link");
    await symlink(join(temp,"elsewhere"),leaf);
    assert.notEqual(invoke(leaf).status,0);
    await absent(join(temp,"elsewhere"));

    const linkedWorkspace = join(temp,"linked-workspace");
    await symlink(direct,linkedWorkspace);
    assert.notEqual(verify(linkedWorkspace).status,0);

    const nested = join(temp,"nested");
    assert.equal(invoke(nested).status,0);
    await rm(join(nested,"supabase/migrations"),{recursive:true});
    await symlink(join(direct,"supabase/migrations"),join(nested,"supabase/migrations"));
    assert.notEqual(verify(nested).status,0);

    const insideRepository = join(dirname(releaseScript),"catalog-release-should-not-exist");
    assert.notEqual(invoke(insideRepository).status,0);
    await absent(insideRepository);

    assert.notEqual(invoke(direct).status,0);
    assert.deepEqual((await readdir(join(direct,"supabase/migrations"))),[MIGRATIONS.foundation[0]]);

    assert.notEqual(invoke(`${temp}/missing/../traversal`).status,0);
    await absent(join(temp,"traversal"));
    assert.notEqual(invoke(`${temp}//alias-path`).status,0);
    await absent(join(temp,"alias-path"));

    const fileParent = join(temp,"file-parent");
    await writeFile(fileParent,"ordinary file");
    assert.notEqual(invoke(join(fileParent,"release")).status,0);
    await absent(join(fileParent,"release","catalog-release-manifest.json"));

    const existing = join(temp,"already-there");
    await mkdir(existing);
    assert.notEqual(invoke(existing).status,0);
    assert.deepEqual(await readdir(existing),[]);
  } finally { await rm(temp,{recursive:true,force:true}); }
});
