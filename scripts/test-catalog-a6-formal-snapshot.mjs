// Offline structural checks only. This file never executes the SQL or contacts a database.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const sqlPath = path.join(path.dirname(fileURLToPath(import.meta.url)),
  "catalog-supabase-permission-snapshot.sql");
const sql = await readFile(sqlPath,"utf8");
const rowsCte = sql.split(/\brows AS \(/)[1]?.split(/\n\),\nsection_catalog\(/)[0];
const catalogCte = sql.split(/\bsection_catalog\(section\) AS \(/)[1]
  ?.split(/\n\),\nsection_rows AS/)[0];
assert.ok(rowsCte && catalogCte,"snapshot and section catalog CTEs must be present");

const branch = (section) => {
  const start = rowsCte.search(new RegExp(`\\bSELECT\\s+'${section}'(?:\\s*::text)?`));
  assert.notEqual(start,-1,`missing ${section} branch`);
  const next = rowsCte.indexOf("\n  UNION ALL",start);
  return rowsCte.slice(start,next === -1 ? undefined : next);
};

// Mask SQL comments and string literals so a quoted privilege name or a comment
// does not masquerade as a command. This is a narrow static check, not a SQL parser.
function maskCommentsAndLiterals(source) {
  let output = "";
  for (let i = 0; i < source.length;) {
    if (source.startsWith("--",i)) {
      const end = source.indexOf("\n",i);
      const stop = end === -1 ? source.length : end;
      output += " ".repeat(stop-i); i = stop;
    } else if (source[i] === "'") {
      const start = i++;
      while (i < source.length) {
        if (source[i] === "'" && source[i+1] === "'") { i += 2; continue; }
        if (source[i++] === "'") break;
      }
      output += " ".repeat(i-start);
    } else if (source[i] === '"') {
      const start = i++;
      while (i < source.length) {
        if (source[i] === '"' && source[i+1] === '"') { i += 2; continue; }
        if (source[i++] === '"') break;
      }
      output += " ".repeat(i-start);
    } else output += source[i++];
  }
  return output;
}

test("one metadata-only statement and reviewed built-in call set", () => {
  const code = maskCommentsAndLiterals(sql);
  assert.match(code,/^\s*WITH\b/i);
  assert.match(code,/\bFROM all_rows ORDER BY section,item;\s*$/i);
  assert.equal((code.match(/;/g) ?? []).length,1,"exactly one SQL statement");
  assert.doesNotMatch(code,/\b(?:INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE|EXECUTE|CALL|COPY|DO)\b/i);
  assert.doesNotMatch(code,/\bSET\s+ROLE\b/i);
  assert.doesNotMatch(code,/\b(?:pg_read_file|pg_write_file|dblink_exec|set_config|pg_terminate_backend)\s*\(/i);
  const called = new Set([...code.matchAll(/pg_catalog\.([a-z_]+)\s*\(/gi)]
    .map((match) => match[1].toLowerCase()));
  const reviewed = new Set(["acldefault","aclexplode","count","current_database",
    "current_setting","format","has_database_privilege",
    "has_function_privilege","has_schema_privilege","has_table_privilege","jsonb_agg",
    "jsonb_build_object","oidvectortypes","pg_encoding_to_char","pg_get_expr",
    "pg_get_function_identity_arguments","pg_get_userbyid","pg_get_viewdef","strpos",
    "statement_timestamp","to_char","to_jsonb","to_regclass","unnest"]);
  assert.deepEqual([...called].sort(),[...reviewed].sort(),
    "changes to the built-in call set require independent static review");
  assert.doesNotMatch(code,/\bFROM\s+(?!pg_catalog\.|rows\b|all_rows\b|section_catalog\b|schemas\b|relations\b|private_functions\b|subjects\b|audit_subjects\b|expected_relations\b|section_rows\b)[a-z_]+\./i);
});

test("every emitted section has a dynamic count including explicit zero", () => {
  const emitted = new Set([...rowsCte.matchAll(/\bSELECT\s+'([a-z_]+)'(?:\s*::text)?(?:\s+section)?\s*,/g)]
    .map((match) => match[1]));
  const declared = new Set([...catalogCte.matchAll(/\('([a-z_]+)'\)/g)]
    .map((match) => match[1]));
  assert.deepEqual([...emitted].sort(),[...declared].sort());
  for (const oldSection of ["database","business_inventory","migration_registry",
    "schema","relation","policy","role","membership","database_acl","schema_acl",
    "relation_acl","default_acl","function","function_acl","function_effective",
    "rfq_function_effective","effective_database","effective_schema","effective_relation"])
    assert.ok(declared.has(oldSection),`old contract section ${oldSection} lost`);
  assert.match(sql,/LEFT JOIN rows r ON r\.section=c\.section/);
  assert.match(sql,/'row_count',pg_catalog\.count\(r\.section\),[\s\S]*?'is_empty',pg_catalog\.count\(r\.section\)=0/);
  assert.match(sql,/'row_key',section\|\|':'\|\|item/);
  assert.match(sql,/'snapshot_row_count',\(SELECT pg_catalog\.count\(\*\) FROM all_rows\)/);
  assert.match(sql,/'duplicate_row_key_count',[\s\S]*?GROUP BY section,item\s+HAVING pg_catalog\.count\(\*\)>1/);
  assert.match(sql,/'null_row_key_count',[\s\S]*?section IS NULL OR item IS NULL/);
  assert.match(branch("snapshot_contract"),/'raw_export_completeness','UNVERIFIED'/);
});

test("database and operator identity are recorded but Ref remains external", () => {
  const database = branch("database");
  for (const field of ["name","server_version","database_oid","current_user",
    "session_user","captured_at_utc","owner","owner_oid","encoding"])
    assert.match(database,new RegExp(`'${field}'`));
  assert.match(database,/pg_catalog\.statement_timestamp\(\) AT TIME ZONE 'UTC'/);
  assert.match(branch("snapshot_contract"),/'project_ref_source','EXTERNAL_DASHBOARD_EVIDENCE_REQUIRED'/);
  assert.doesNotMatch(database,/project_ref/i);
});

test("all roles and all membership edges retain IDs, grantor and three options", () => {
  const roles = branch("role");
  assert.match(roles,/FROM pg_catalog\.pg_roles r\s*$/);
  for (const field of ["role_oid","role_name","connection_limit","login","inherit",
    "superuser","bypass_rls","create_db","create_role","replication"])
    assert.match(roles,new RegExp(`'${field}'`));
  const membership = branch("membership");
  assert.match(membership,/SELECT 'membership',m\.oid::text/);
  assert.match(membership,/FROM pg_catalog\.pg_auth_members m/);
  for (const alias of ["member","parent","grantor"])
    assert.match(membership,new RegExp(`LEFT JOIN pg_catalog\\.pg_roles ${alias}`));
  for (const field of ["membership_oid","member_oid","parent_oid","grantor_oid",
    "admin_option","inherit_option","set_option","member_name_resolved",
    "parent_name_resolved","grantor_name_resolved"])
    assert.match(membership,new RegExp(`'${field}'`));
  assert.doesNotMatch(membership,/\bWHERE\b/i);
});

test("current ACL, built-in reference, PUBLIC and effective permissions remain distinct", () => {
  for (const section of ["database_acl","schema_acl","relation_acl","function_acl"])
    assert.match(branch(section),/'acl_source'/);
  for (const section of ["database_acl","schema_acl","default_acl","function_acl"])
    for (const field of ["grantee_oid","grantor_oid","privilege","grantable"])
      assert.match(branch(section),new RegExp(`'${field}'`));
  assert.match(branch("database_acl_state"),/'acl_is_null'/);
  assert.match(branch("schema_acl_state"),/'acl_is_null'/);
  assert.match(branch("database_acl"),/aclexplode\(COALESCE\(d\.datacl,/);
  assert.match(branch("schema_acl"),/aclexplode\(COALESCE\(s\.nspacl,/);
  assert.match(branch("database_builtin_acl"),/'BUILTIN_REFERENCE'/);
  assert.match(branch("schema_builtin_acl"),/'BUILTIN_REFERENCE'/);
  for (const field of ["connect","create","temp"])
    assert.match(branch("public_database_privilege"),new RegExp(`'${field}'`));
  for (const field of ["usage","create"])
    assert.match(branch("public_schema_privilege"),new RegExp(`'${field}'`));
  assert.match(branch("public_database_privilege"),/a\.grantee=0/);
  assert.match(branch("public_schema_privilege"),/a\.grantee=0/);
  assert.match(branch("effective_database"),/has_database_privilege/);
  assert.match(branch("effective_schema"),/has_schema_privilege/);
});

test("absent roles and schemas are explicit and NULL does not mean no privilege", () => {
  assert.match(sql,/audit_subjects AS \([\s\S]*?SELECT s\.role_name,NULL::oid/);
  assert.match(branch("schema"),/'exists',s\.oid IS NOT NULL/);
  assert.match(branch("effective_database"),/'role_exists',s\.role_oid IS NOT NULL/);
  assert.match(branch("effective_database"),/CASE WHEN s\.role_oid IS NULL THEN NULL/);
  assert.match(branch("effective_schema"),/'schema_exists',sc\.oid IS NOT NULL/);
  assert.match(branch("effective_schema"),/CASE WHEN s\.role_oid IS NULL OR sc\.oid IS NULL THEN NULL/);
  assert.match(branch("public_schema_privilege"),/CASE WHEN s\.oid IS NULL THEN NULL/);
});

test("table, sequence, function and schema built-in defaults do not masquerade as effective", () => {
  const explicit = branch("default_acl");
  assert.match(explicit,/FROM pg_catalog\.pg_default_acl d/);
  assert.match(explicit,/'acl_source','EXPLICIT_DEFAULT_ACL'/);
  const builtin = branch("default_acl_builtin");
  for (const [objectType,aclCode] of [["r","r"],["S","s"],["f","f"],["n","n"]])
    assert.ok(builtin.includes(`'${objectType}'::"char",'${aclCode}'::"char"`));
  assert.match(builtin,/acldefault\(kind\.acl_code,creator\.oid\)/);
  assert.match(branch("relation_acl"),/r\.relkind='S' THEN 's' ELSE 'r'/);
  assert.match(builtin,/'BUILTIN_REFERENCE_NOT_EFFECTIVE_DEFAULT'/);
  assert.match(branch("default_acl_state"),/'zero_entries_mean_builtin_rules_still_apply',true/);
  assert.match(branch("default_acl_state"),/'explicit_default_acl_record_count'/);
  assert.match(branch("function"),/'security_definer',f\.prosecdef/);
  assert.match(branch("relation"),/'rls_enabled',r\.relrowsecurity/);
  assert.match(branch("policy"),/'using_md5'/);
});

test("snapshot has no historical role or edge count constant and no trailing whitespace", () => {
  assert.doesNotMatch(sql,/\b(?:30|24)\s+(?:roles|memberships)\b/i);
  assert.ok(!sql.split("\n").some((line) => /[\t ]+$/.test(line)));
});

test("this offline test file has no trailing whitespace", async () => {
  const source = await readFile(fileURLToPath(import.meta.url),"utf8");
  assert.ok(!source.split("\n").some((line) => /[\t ]+$/.test(line)));
});
