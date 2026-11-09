// A6 Scheme B formal offline evidence validator. This module never connects to a database.
// A PASS certifies bundle-internal consistency only; source and raw export completeness remain unverified.
import { createHash } from "node:crypto";
import { lstat, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { readStableBundleFile } from "./catalog-a6-offline-prototype.mjs";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const isHash = (x) => typeof x === "string" && /^[0-9a-f]{64}$/.test(x);
const nonempty = (x) => typeof x === "string" && x.length > 0 && x.trim() === x;
const ref = (x) => typeof x === "string" && /^[a-z0-9]{20}$/.test(x);
const utc = (x) => typeof x === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(x) &&
  !Number.isNaN(Date.parse(x)) && new Date(x).toISOString() === x;
const count = (x) => Number.isSafeInteger(x) && x >= 0;
const object = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const sameFile = (a,b) => a.dev === b.dev && a.ino === b.ino && a.size === b.size &&
  a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
const issue = (code,detail) => ({code,detail});

// These are the A1 catalog-a6-scheme-b-v1 section names, including the inventory itself.
export const SECTIONS = Object.freeze([
  "database","business_inventory","permission_inventory","business_object",
  "migration_registry","schema","relation","policy","role","membership",
  "database_acl_state","database_acl","database_builtin_acl","public_database_privilege",
  "schema_acl_state","schema_acl","schema_builtin_acl","public_schema_privilege",
  "relation_acl","default_acl_state","default_acl","default_acl_builtin",
  "function","function_acl","function_effective","rfq_function_effective",
  "effective_database","effective_schema","effective_relation","snapshot_contract",
  "section_inventory",
]);
const sectionSet = new Set(SECTIONS);
// Only sections that A1 must produce even on an empty Catalog project are nonempty.
const required = new Set(["database","business_inventory","permission_inventory",
  "migration_registry","schema","role","database_acl_state","database_builtin_acl",
  "public_database_privilege","schema_acl_state","public_schema_privilege",
  "default_acl_state","default_acl_builtin","effective_database","effective_schema",
  "snapshot_contract","section_inventory"]);

// Approved v1 data shape. Values may be null where A1 deliberately represents absent objects.
const fields = Object.freeze({
  database:"name server_version database_oid current_user session_user captured_at_utc owner owner_oid encoding",
  business_inventory:"complete",
  permission_inventory:"complete membership_count database_acl_count public_schema_acl_count role_count business_object_count snapshot_row_count duplicate_row_key_count null_row_key_count",
  business_object:"kind actual_kind",
  migration_registry:"exists",
  schema:"exists schema_oid owner_oid owner",
  relation:"expected_kind exists actual_kind owner rls_enabled rls_forced options columns view_definition_md5 view_mentions_published view_mentions_storage_key",
  policy:"command permissive roles using_true using_mentions_published check_true using_md5 check_md5",
  role:"role_name role_oid connection_limit login inherit superuser bypass_rls create_db create_role replication",
  membership:"membership_oid member member_oid parent parent_oid grantor grantor_oid member_name_resolved parent_name_resolved grantor_name_resolved admin_option inherit_option set_option",
  database_acl_state:"database database_oid owner_oid acl_is_null acl_source explicit_acl_entry_count",
  database_acl:"database database_oid owner owner_oid acl_source grantee grantee_oid grantor grantor_oid privilege grantable",
  database_builtin_acl:"database database_oid acl_source grantee grantee_oid grantor grantor_oid privilege grantable",
  public_database_privilege:"database database_oid acl_source connect create temp",
  schema_acl_state:"schema schema_oid exists owner_oid acl_is_null acl_source explicit_acl_entry_count",
  schema_acl:"schema schema_oid owner owner_oid acl_source grantee grantee_oid grantor grantor_oid privilege grantable",
  schema_builtin_acl:"schema schema_oid acl_source grantee grantee_oid grantor grantor_oid privilege grantable",
  public_schema_privilege:"schema schema_oid exists acl_source usage create",
  relation_acl:"relation relation_oid acl_source grantee grantee_oid grantor grantor_oid privilege grantable",
  default_acl_state:"explicit_default_acl_record_count explicit_default_acl_entry_count zero_entries_mean_builtin_rules_still_apply",
  default_acl:"default_acl_oid creator creator_oid schema schema_oid scope object_type acl_source grantee grantee_oid grantor grantor_oid privilege grantable",
  default_acl_builtin:"creator creator_oid schema scope object_type acl_source grantee grantee_oid grantor grantor_oid privilege grantable",
  function:"canonical_signature owner security_definer search_path kind",
  function_acl:"signature function_oid acl_source grantee grantee_oid grantor grantor_oid privilege grantable",
  function_effective:"signature role execute schema_usage",
  rfq_function_effective:"role execute schema_usage",
  effective_database:"role role_oid role_exists connect create temp",
  effective_schema:"role schema role_oid schema_oid role_exists schema_exists usage create",
  effective_relation:"role relation select insert update delete truncate",
  snapshot_contract:"version project_ref_source raw_export_completeness execution_provenance",
  section_inventory:"section row_count is_empty",
});

class DuplicateJsonKeyError extends Error {}
// Same lexical key-walk rule used by D4: JSON.parse validates grammar first; this walk
// compares decoded keys within every object, before its parsed value is accepted.
export function parseUniqueJson(bytes) {
  const content = bytes.toString("utf8");
  if (!Buffer.from(content,"utf8").equals(bytes)) throw new Error("invalid UTF-8");
  const parsed = JSON.parse(content);
  let i = 0;
  const ws = () => { while (/[\t\n\r ]/.test(content[i] ?? "")) i++; };
  const str = () => {
    const start = i++;
    while (i < content.length) {
      const c = content[i++];
      if (c === "\\") i++;
      else if (c === '"') return JSON.parse(content.slice(start,i));
    }
    throw new Error("unterminated JSON string");
  };
  const value = () => {
    ws();
    if (content[i] === "{") {
      i++; ws();
      const keys = new Set();
      if (content[i] === "}") { i++; return; }
      while (true) {
        const key = str();
        if (keys.has(key)) throw new DuplicateJsonKeyError("duplicate JSON object key");
        keys.add(key); ws(); i++; value(); ws();
        if (content[i] === "}") { i++; return; }
        i++; ws();
      }
    } else if (content[i] === "[") {
      i++; ws();
      if (content[i] === "]") { i++; return; }
      while (true) {
        value(); ws();
        if (content[i] === "]") { i++; return; }
        i++;
      }
    } else if (content[i] === '"') str();
    else while (i < content.length && !/[,}\]\t\n\r ]/.test(content[i])) i++;
  };
  value(); ws();
  if (i !== content.length) throw new Error("incomplete JSON scan");
  return parsed;
}

function jsonl(bytes) {
  const text = bytes.toString("utf8");
  if (!Buffer.from(text,"utf8").equals(bytes)) throw new Error("invalid UTF-8");
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  if (!lines.length || lines.some((line) => !line || line.includes("\r")))
    throw new Error("empty or noncanonical JSONL line");
  return lines.map((line) => parseUniqueJson(Buffer.from(line,"utf8")));
}

// A1 SQL returns exactly one snapshot_row column. Quoted CSV fields and doubled quotes
// are decoded; physical newlines inside a quoted field are allowed.
function csv(bytes) {
  const text = bytes.toString("utf8");
  if (!Buffer.from(text,"utf8").equals(bytes)) throw new Error("invalid UTF-8");
  const rows = []; let row = [], cell = "", quoted = false, endedQuote = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i+1] === '"') { cell += '"'; i++; }
      else if (c === '"') { quoted = false; endedQuote = true; }
      else cell += c;
    } else if (c === ',' || c === "\n" || c === "\r") {
      if (c === "\r" && text[i+1] !== "\n") throw new Error("invalid CSV newline");
      row.push(cell); cell = ""; endedQuote = false;
      if (c !== ',') {
        rows.push(row); row = [];
        if (c === "\r") i++;
      }
    } else if (c === '"' && cell === "" && !endedQuote) quoted = true;
    else if (c === '"' || endedQuote) throw new Error("invalid CSV quoting");
    else cell += c;
  }
  if (quoted) throw new Error("unterminated CSV quote");
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  if (!rows.length || rows[0].length !== 1 || rows[0][0] !== "snapshot_row" ||
      rows.slice(1).some((r) => r.length !== 1 || !r[0])) throw new Error("CSV schema invalid");
  return rows.slice(1).map((r) => parseUniqueJson(Buffer.from(r[0],"utf8")));
}

function exactKeys(value, expected) {
  return object(value) && Object.keys(value).length === expected.length &&
    expected.every((key) => Object.hasOwn(value,key));
}
const pathOK = (name, dir, ext) => typeof name === "string" &&
  new RegExp(`^${dir}/[a-z0-9]+(?:[._-][a-z0-9]+)*\\.${ext}$`).test(name);

async function inventory(root, dir, expected, add) {
  const found = new Map(); let before, names;
  try {
    before = await lstat(path.join(root,dir),{bigint:true});
    if (!before.isDirectory() || before.isSymbolicLink()) throw new Error("directory invalid");
    names = await readdir(path.join(root,dir));
  } catch { add("EVIDENCE_DIRECTORY_INVALID",dir); return found; }
  const folded = new Set();
  for (const name of names) {
    const relative = `${dir}/${name}`, lower = name.toLowerCase();
    if (folded.has(lower)) add("FILENAME_CASE_COLLISION",relative);
    folded.add(lower);
    if (!expected.has(relative)) add("UNDECLARED_FILE",relative);
    try {
      const stat = await lstat(path.join(root,relative),{bigint:true});
      if (stat.isSymbolicLink() || !stat.isFile()) add("FILE_TYPE_INVALID",relative);
      else if (expected.has(relative)) found.set(relative,await readStableBundleFile(root,relative));
    } catch { add("FILE_UNSTABLE",relative); }
  }
  for (const relative of expected) if (!found.has(relative)) add("DECLARED_FILE_MISSING",relative);
  try {
    const after = await lstat(path.join(root,dir),{bigint:true});
    const ending = await readdir(path.join(root,dir));
    if (!sameFile(before,after) || JSON.stringify([...names].sort()) !== JSON.stringify(ending.sort()))
      add("INVENTORY_CHANGED",dir);
  } catch { add("INVENTORY_CHANGED",dir); }
  return found;
}

function validateRows(rows, policy, add) {
  const seen = new Set(), buckets = new Map(SECTIONS.map((s) => [s,[]]));
  for (const row of rows) {
    if (!object(row) || !exactKeys(row,["section","item","row_key","data"]) ||
        !nonempty(row.section) || !nonempty(row.item) || !nonempty(row.row_key) || !object(row.data)) {
      add("SNAPSHOT_ROW_INVALID","top-level structure or null row key"); continue;
    }
    if (!sectionSet.has(row.section)) { add("UNKNOWN_SECTION",row.section); continue; }
    if (row.row_key !== `${row.section}:${row.item}`) add("ROW_KEY_INVALID",row.row_key);
    if (seen.has(row.row_key)) add("DUPLICATE_ROW_KEY",row.row_key);
    seen.add(row.row_key);
    buckets.get(row.section).push(row);
    const keys = fields[row.section].split(" ");
    // business_object schema/function rows omit actual_kind; it is relation-only.
    const shapeOK = row.section === "business_object" ?
      (exactKeys(row.data,["kind"]) || exactKeys(row.data,["kind","actual_kind"])) :
      exactKeys(row.data,keys);
    if (!shapeOK) add("UNAPPROVED_FIELD_STRUCTURE",row.row_key);
  }
  for (const section of required) if (!buckets.get(section).length)
    add("REQUIRED_SECTION_EMPTY",section);
  const one = (section,item) => {
    const matching = buckets.get(section).filter((r) => r.item === item);
    if (matching.length !== 1) add("REQUIRED_ROW_MISSING_OR_DUPLICATE",`${section}:${item}`);
    return matching.length === 1 ? matching[0] : null;
  };
  const database = one("database",policy.databaseName);
  if (database && (database.data.name !== policy.databaseName ||
      database.data.server_version !== policy.postgresVersion ||
      database.data.current_user !== policy.identity.currentUser ||
      database.data.session_user !== policy.identity.sessionUser || !utc(database.data.captured_at_utc) ||
      !/^\d+$/.test(database.data.database_oid ?? ""))) add("DATABASE_IDENTITY_MISMATCH","snapshot database row");
  const contract = one("snapshot_contract","catalog-a6-scheme-b-v1");
  if (contract && (contract.data.version !== "catalog-a6-scheme-b-v1" ||
      contract.data.project_ref_source !== "EXTERNAL_DASHBOARD_EVIDENCE_REQUIRED" ||
      contract.data.raw_export_completeness !== "UNVERIFIED" ||
      contract.data.execution_provenance !== "UNVERIFIED"))
    add("SNAPSHOT_CONTRACT_INVALID","self-reported provenance must remain unverified");
  const permissions = one("permission_inventory","database-acl-and-membership");
  const business = one("business_inventory","catalog-rfq-admin-prefixes");
  const registry = one("migration_registry","supabase_migrations.schema_migrations");
  const publicSchema = one("schema","public");
  one("schema_acl_state","public");
  one("public_schema_privilege","public");
  one("default_acl_state",policy.databaseName);
  if (publicSchema?.data.exists !== true) add("PUBLIC_SCHEMA_MISSING","public schema marker");
  for (const schema of buckets.get("schema")) {
    one("schema_acl_state",schema.item);
    one("public_schema_privilege",schema.item);
  }
  for (const role of buckets.get("role")) one("effective_database",role.item);
  for (const effective of buckets.get("effective_database")) {
    if (effective.item !== effective.data.role || typeof effective.data.role_exists !== "boolean")
      add("EFFECTIVE_ROLE_INVALID",effective.row_key);
    for (const schema of buckets.get("schema"))
      one("effective_schema",`${effective.item}:${schema.item}`);
  }
  const dbState = buckets.get("database_acl_state");
  if (dbState.length !== 1 || dbState[0].data.database !== policy.databaseName)
    add("DATABASE_ACL_STATE_INVALID","one target database ACL state required");
  else {
    one("public_database_privilege",dbState[0].item);
    if (dbState[0].data.acl_is_null === true && dbState[0].data.explicit_acl_entry_count !== 0)
      add("DATABASE_ACL_STATE_INVALID","NULL ACL cannot have explicit entries");
    if (dbState[0].data.acl_is_null === false &&
        dbState[0].data.explicit_acl_entry_count !== buckets.get("database_acl").length)
      add("DATABASE_ACL_STATE_INVALID","explicit ACL entry count mismatch");
  }
  if (business?.data.complete !== true || permissions?.data.complete !== true ||
      typeof registry?.data.exists !== "boolean") add("INVENTORY_MARKER_INVALID","required markers");
  for (const row of buckets.get("role")) if (row.item !== row.data.role_name ||
      !/^\d+$/.test(row.data.role_oid ?? "") ||
      !Number.isInteger(row.data.connection_limit) ||
      ["login","inherit","superuser","bypass_rls","create_db","create_role","replication"]
        .some((k) => typeof row.data[k] !== "boolean")) add("ROLE_ROW_INVALID",row.row_key);
  for (const row of buckets.get("membership")) if (!/^\d+$/.test(row.item) ||
      row.item !== row.data.membership_oid ||
      ["member_oid","parent_oid","grantor_oid"].some((k) => !/^\d+$/.test(row.data[k] ?? "")) ||
      ["admin_option","inherit_option","set_option","member_name_resolved",
        "parent_name_resolved","grantor_name_resolved"].some((k) => typeof row.data[k] !== "boolean") ||
      ["member","parent","grantor"].some((k) => row.data[k] !== null && !nonempty(row.data[k])))
    add("MEMBERSHIP_FORMAT_INVALID",row.row_key);
  validateIdentityLinks(buckets, database, add);
  for (const row of buckets.get("section_inventory")) {
    const target = row.item;
    if (!sectionSet.has(target) || row.data.section !== target ||
        !count(row.data.row_count) || row.data.row_count !== buckets.get(target).length ||
        row.data.is_empty !== (row.data.row_count === 0)) add("SECTION_COUNT_MISMATCH",target);
  }
  if (buckets.get("section_inventory").length !== SECTIONS.length ||
      new Set(buckets.get("section_inventory").map((r) => r.item)).size !== SECTIONS.length)
    add("SECTION_INVENTORY_INCOMPLETE","all approved sections require one inventory row");
  if (permissions) {
    const expected = {
      membership_count:buckets.get("membership").length,
      database_acl_count:buckets.get("database_acl").length,
      public_schema_acl_count:buckets.get("schema_acl").filter((r) => r.data.schema === "public").length,
      role_count:buckets.get("role").length,
      business_object_count:buckets.get("business_object").length,
      snapshot_row_count:rows.length,
      duplicate_row_key_count:0,
      null_row_key_count:0,
    };
    if (Object.entries(expected).some(([k,v]) => permissions.data[k] !== v))
      add("PERMISSION_INVENTORY_MISMATCH","dynamic count or key count");
  }
  return buckets;
}

// OIDs identify objects only within this snapshot. Every reference that has an
// identity row must agree with that row; the signed cross-environment baseline
// continues to use logical names rather than OIDs.
function validateIdentityLinks(buckets, database, add) {
  const validOid = (value) => typeof value === "string" && /^\d+$/.test(value);
  const roles = new Map(), roleOids = new Map();
  for (const row of buckets.get("role")) {
    const {role_name:name,role_oid:oid} = row.data;
    if (!nonempty(name) || !validOid(oid) || roles.has(name) || roleOids.has(oid))
      add("ROLE_IDENTITY_CONFLICT",row.row_key);
    else { roles.set(name,oid); roleOids.set(oid,name); }
  }
  const roleRef = (name,oid,where,publicAllowed=false) => {
    if (publicAllowed && name === "PUBLIC" && oid === "0") return;
    if (!nonempty(name) || !validOid(oid) || roles.get(name) !== oid || roleOids.get(oid) !== name)
      add("ROLE_IDENTITY_MISMATCH",where);
  };
  const dbName = database?.data.name, dbOid = database?.data.database_oid;
  if (database) roleRef(database.data.owner,database.data.owner_oid,database.row_key);
  const dbRef = (data,where) => {
    if (data.database !== dbName || data.database_oid !== dbOid)
      add("DATABASE_OID_MISMATCH",where);
  };
  const schemas = new Map(), schemaOids = new Map();
  for (const row of buckets.get("schema")) {
    const data = row.data;
    if (data.exists === true) {
      if (!validOid(data.schema_oid) || schemas.has(row.item) || schemaOids.has(data.schema_oid))
        add("SCHEMA_IDENTITY_CONFLICT",row.row_key);
      else { schemas.set(row.item,data.schema_oid); schemaOids.set(data.schema_oid,row.item); }
      roleRef(data.owner,data.owner_oid,row.row_key);
    } else if (data.exists !== false || data.schema_oid !== null ||
        data.owner !== null || data.owner_oid !== null)
      add("SCHEMA_IDENTITY_INVALID",row.row_key);
  }
  const schemaRef = (name,oid,where,allowAbsent=false) => {
    const expected = schemas.get(name);
    if (expected === undefined && allowAbsent && oid === null &&
        buckets.get("schema").some((row) => row.item === name && row.data.exists === false)) return;
    if (!nonempty(name) || !validOid(oid) || expected !== oid || schemaOids.get(oid) !== name)
      add("SCHEMA_OID_MISMATCH",where);
  };
  for (const row of buckets.get("membership")) {
    const data = row.data;
    for (const [name,oid,resolved] of [["member","member_oid","member_name_resolved"],
      ["parent","parent_oid","parent_name_resolved"],
      ["grantor","grantor_oid","grantor_name_resolved"]]) {
      if (data[resolved] !== true) add("MEMBERSHIP_IDENTITY_UNRESOLVED",row.row_key);
      roleRef(data[name],data[oid],row.row_key);
    }
  }
  for (const row of buckets.get("effective_database")) {
    const data = row.data, expected = roles.get(data.role);
    if (data.role_exists !== (expected !== undefined) ||
        (expected === undefined ? data.role_oid !== null : data.role_oid !== expected))
      add("EFFECTIVE_ROLE_OID_MISMATCH",row.row_key);
  }
  for (const row of buckets.get("effective_schema")) {
    const data = row.data, expectedRole = roles.get(data.role);
    if (data.role_exists !== (expectedRole !== undefined) ||
        (expectedRole === undefined ? data.role_oid !== null : data.role_oid !== expectedRole))
      add("EFFECTIVE_ROLE_OID_MISMATCH",row.row_key);
    if (data.schema_exists !== schemas.has(data.schema))
      add("EFFECTIVE_SCHEMA_IDENTITY_MISMATCH",row.row_key);
    schemaRef(data.schema,data.schema_oid,row.row_key,true);
  }
  const dbState = buckets.get("database_acl_state")[0];
  if (dbState) {
    dbRef(dbState.data,dbState.row_key);
    if (dbState.item !== dbOid || dbState.data.owner_oid !== database?.data.owner_oid)
      add("DATABASE_OID_MISMATCH",dbState.row_key);
    if (dbState.data.acl_source !==
        (dbState.data.acl_is_null === true ? "BUILTIN_DEFAULT" : "EXPLICIT"))
      add("DATABASE_ACL_SOURCE_INVALID",dbState.row_key);
  }
  for (const section of ["public_database_privilege","database_acl","database_builtin_acl"])
    for (const row of buckets.get(section)) {
      const data = row.data;
      dbRef(data,row.row_key);
      if (section === "public_database_privilege" &&
          (row.item !== dbOid || data.acl_source !== dbState?.data.acl_source))
        add("DATABASE_OID_MISMATCH",row.row_key);
      if (section === "database_acl" &&
          (data.owner !== database?.data.owner || data.owner_oid !== database?.data.owner_oid ||
            data.acl_source !== dbState?.data.acl_source))
        add("DATABASE_OID_MISMATCH",row.row_key);
      if (section === "database_builtin_acl" && data.acl_source !== "BUILTIN_REFERENCE")
        add("DATABASE_ACL_SOURCE_INVALID",row.row_key);
      if (section !== "public_database_privilege") {
        roleRef(data.grantee,data.grantee_oid,row.row_key,true);
        roleRef(data.grantor,data.grantor_oid,row.row_key);
      }
    }
  const schemaStates = new Map(buckets.get("schema_acl_state").map((row) => [row.item,row]));
  for (const row of buckets.get("schema_acl_state")) {
    const data = row.data, exists = schemas.has(row.item);
    if (!buckets.get("schema").some((s) => s.item === row.item) ||
        data.schema !== row.item || data.exists !== exists ||
        (exists ? data.schema_oid !== schemas.get(row.item) ||
          data.owner_oid !== buckets.get("schema").find((s) => s.item === row.item)?.data.owner_oid :
          data.schema_oid !== null || data.owner_oid !== null))
      add("SCHEMA_OID_MISMATCH",row.row_key);
    const actualCount = buckets.get("schema_acl").filter((acl) => acl.data.schema === row.item).length;
    if (!exists) {
      if (data.acl_is_null !== null || data.acl_source !== "ABSENT" ||
          data.explicit_acl_entry_count !== null || actualCount !== 0)
        add("SCHEMA_ACL_COUNT_MISMATCH",row.row_key);
    } else if (typeof data.acl_is_null !== "boolean" ||
        data.acl_source !== (data.acl_is_null ? "BUILTIN_DEFAULT" : "EXPLICIT") ||
        !count(data.explicit_acl_entry_count) ||
        data.explicit_acl_entry_count !== (data.acl_is_null ? 0 : actualCount))
      add("SCHEMA_ACL_COUNT_MISMATCH",row.row_key);
    if (exists && data.acl_is_null === true) {
      const entries = (section) => buckets.get(section)
        .filter((acl) => acl.data.schema === row.item)
        .map((acl) => JSON.stringify([acl.data.grantee_oid,acl.data.grantor_oid,
          acl.data.privilege,acl.data.grantable])).sort();
      if (JSON.stringify(entries("schema_acl")) !==
          JSON.stringify(entries("schema_builtin_acl")))
        add("SCHEMA_ACL_BUILTIN_MISMATCH",row.row_key);
    }
  }
  for (const section of ["public_schema_privilege","schema_acl","schema_builtin_acl"])
    for (const row of buckets.get(section)) {
      const data = row.data, state = schemaStates.get(data.schema);
      schemaRef(data.schema,data.schema_oid,row.row_key,section === "public_schema_privilege");
      if (section === "public_schema_privilege" &&
          (row.item !== data.schema || data.exists !== state?.data.exists ||
            data.acl_source !== state?.data.acl_source))
        add("SCHEMA_IDENTITY_MISMATCH",row.row_key);
      if (section === "schema_acl" &&
          (data.owner !== buckets.get("schema").find((s) => s.item === data.schema)?.data.owner ||
            data.owner_oid !== state?.data.owner_oid || data.acl_source !== state?.data.acl_source))
        add("SCHEMA_IDENTITY_MISMATCH",row.row_key);
      if (section === "schema_builtin_acl" && data.acl_source !== "BUILTIN_REFERENCE")
        add("SCHEMA_ACL_SOURCE_INVALID",row.row_key);
      if (section !== "public_schema_privilege") {
        roleRef(data.grantee,data.grantee_oid,row.row_key,true);
        roleRef(data.grantor,data.grantor_oid,row.row_key);
      }
    }
  for (const section of ["default_acl","default_acl_builtin"])
    for (const row of buckets.get(section)) {
      const data = row.data;
      if (section === "default_acl" && (!validOid(data.default_acl_oid) ||
          !row.item.startsWith(`${data.default_acl_oid}:`)))
        add("DEFAULT_ACL_IDENTITY_MISMATCH",row.row_key);
      roleRef(data.creator,data.creator_oid,row.row_key);
      roleRef(data.grantee,data.grantee_oid,row.row_key,true);
      roleRef(data.grantor,data.grantor_oid,row.row_key);
      if (data.scope === "ALL_SCHEMAS") {
        if (data.schema !== null || (section === "default_acl" && data.schema_oid !== "0"))
          add("DEFAULT_ACL_SCHEMA_IDENTITY_MISMATCH",row.row_key);
      } else if (data.scope === "SCHEMA" && section === "default_acl")
        schemaRef(data.schema,data.schema_oid,row.row_key);
      else add("DEFAULT_ACL_SCHEMA_IDENTITY_MISMATCH",row.row_key);
    }
  for (const row of buckets.get("function_acl")) {
    roleRef(row.data.grantee,row.data.grantee_oid,row.row_key,true);
    roleRef(row.data.grantor,row.data.grantor_oid,row.row_key);
    if (!validOid(row.data.function_oid) ||
        !buckets.get("function").some((fn) => fn.item === row.data.signature))
      add("FUNCTION_IDENTITY_MISMATCH",row.row_key);
  }
  for (const row of buckets.get("relation_acl")) {
    roleRef(row.data.grantee,row.data.grantee_oid,row.row_key,true);
    roleRef(row.data.grantor,row.data.grantor_oid,row.row_key);
    if (!validOid(row.data.relation_oid) ||
        !buckets.get("relation").some((rel) => rel.item === row.data.relation &&
          rel.data.exists === true))
      add("RELATION_IDENTITY_MISMATCH",row.row_key);
  }
  for (const row of buckets.get("effective_relation")) {
    if (!roles.has(row.data.role) ||
        !buckets.get("relation").some((rel) => rel.item === row.data.relation &&
          rel.data.exists === true))
      add("EFFECTIVE_RELATION_IDENTITY_MISMATCH",row.row_key);
  }
  for (const row of buckets.get("function_effective")) {
    if (!roles.has(row.data.role) ||
        !buckets.get("function").some((fn) => fn.item === row.data.signature))
      add("FUNCTION_IDENTITY_MISMATCH",row.row_key);
  }
  for (const row of buckets.get("rfq_function_effective"))
    if (!roles.has(row.data.role)) add("FUNCTION_IDENTITY_MISMATCH",row.row_key);
}

const result = (findings) => ({
  scope:"LOCAL_OFFLINE_EVIDENCE_ONLY",
  internalConsistency:findings.length ? "INTERNAL_CONSISTENCY_BLOCKED" : "INTERNAL_CONSISTENCY_PASS",
  sourceAuthentication:"SOURCE_AUTHENTICATION_UNVERIFIED",
  rawExportCompleteness:"RAW_EXPORT_COMPLETENESS_UNVERIFIED",
  securityBaseline:"NOT_EVALUATED",
  findings,
});

// The caller must supply the policy hash from an approval channel outside the bundle.
// Even a matching hash does not authenticate the approver or SQL Editor session.
export async function validateCatalogA6Evidence(bundleDirectory, policyFile, expectedPolicySha256) {
  const findings = [], add = (code,detail) => findings.push(issue(code,detail));
  try {
    const rootStat = await lstat(bundleDirectory,{bigint:true});
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error("bundle root invalid");
    const root = await realpath(bundleDirectory);
    if (!sameFile(rootStat,await lstat(root,{bigint:true}))) throw new Error("bundle root changed");
    const rootNames = await readdir(root);
    const allowedRoot = new Set(["manifest.json","approved","records","raw","exports"]);
    for (const name of rootNames) if (!allowedRoot.has(name)) add("UNDECLARED_FILE",name);
    if (!isHash(expectedPolicySha256)) add("POLICY_ANCHOR_MISSING","independent SHA-256 required");
    const policyReal = await realpath(policyFile);
    const relativePolicy = path.relative(root,policyReal);
    if (!relativePolicy.startsWith(`..${path.sep}`) && relativePolicy !== "..")
      add("POLICY_NOT_INDEPENDENT","policy must be outside bundle");
    const policyBytes = await readStableBundleFile(path.dirname(path.resolve(policyFile)),path.basename(policyFile));
    if (hash(policyBytes) !== expectedPolicySha256) add("POLICY_HASH_MISMATCH","policy anchor");
    let policy, manifest;
    try { policy = parseUniqueJson(policyBytes); }
    catch (e) { add(e instanceof DuplicateJsonKeyError ? "DUPLICATE_JSON_KEY" : "POLICY_JSON_INVALID","policy"); }
    try { manifest = parseUniqueJson(await readStableBundleFile(root,"manifest.json")); }
    catch (e) { add(e instanceof DuplicateJsonKeyError ? "DUPLICATE_JSON_KEY" : "MANIFEST_JSON_INVALID","manifest"); }
    if (!exactKeys(policy,["kind","projectRef","databaseName","postgresVersion","identity","queries"]) ||
        policy.kind !== "CATALOG_A6_EVIDENCE_POLICY_V1" || !ref(policy.projectRef) ||
        !nonempty(policy.databaseName) || !nonempty(policy.postgresVersion) ||
        !exactKeys(policy.identity,["operator","currentUser","sessionUser"]) ||
        Object.values(policy.identity).some((v) => !nonempty(v)) ||
        !Array.isArray(policy.queries) || policy.queries.length !== 1 ||
        !exactKeys(policy.queries[0],["id","version","sqlSha256"]) ||
        policy.queries[0].id !== "snapshot" ||
        policy.queries[0].version !== "catalog-a6-scheme-b-v1" || !isHash(policy.queries[0].sqlSha256))
      add("POLICY_INVALID","approved target, identity and one snapshot SQL required");
    if (!exactKeys(manifest,["kind","projectRef","databaseName","postgresVersion","queries"]) ||
        manifest.kind !== "CATALOG_A6_EVIDENCE_BUNDLE_V1" || !ref(manifest.projectRef) ||
        !nonempty(manifest.databaseName) || !nonempty(manifest.postgresVersion) ||
        !Array.isArray(manifest.queries) || manifest.queries.length !== 1)
      add("MANIFEST_INVALID","exactly one snapshot execution required");
    if (findings.length) return result(findings);
    if (manifest.projectRef !== policy.projectRef) add("PROJECT_REF_MISMATCH","manifest / policy");
    if (manifest.databaseName !== policy.databaseName) add("DATABASE_MISMATCH","manifest / policy");
    if (manifest.postgresVersion !== policy.postgresVersion) add("POSTGRES_VERSION_MISMATCH","manifest / policy");
    const entry = manifest.queries[0];
    const entryKeys = ["id","version","approvedSqlFile","approvedSqlSha256","recordFile",
      "recordSha256","rawExportFile","rawExportSha256","rawExportSourceId",
      "jsonlFile","jsonlSha256","rowCount","columns","truncated"];
    if (!exactKeys(entry,entryKeys) || entry.id !== "snapshot" ||
        entry.version !== policy.queries[0].version || !isHash(entry.approvedSqlSha256) ||
        !isHash(entry.recordSha256) || !isHash(entry.rawExportSha256) || !isHash(entry.jsonlSha256) ||
        !pathOK(entry.approvedSqlFile,"approved","sql") ||
        !pathOK(entry.recordFile,"records","json") || !pathOK(entry.rawExportFile,"raw","csv") ||
        !pathOK(entry.jsonlFile,"exports","jsonl") || !nonempty(entry.rawExportSourceId) ||
        !count(entry.rowCount) || !Array.isArray(entry.columns) ||
        entry.columns.length !== 1 || entry.columns[0] !== "snapshot_row" ||
        typeof entry.truncated !== "boolean") add("QUERY_ENTRY_INVALID","snapshot file mapping or fields");
    if (findings.length) return result(findings);
    if (entry.truncated) add("EXPORT_TRUNCATED","manifest declares truncation");
    if (entry.approvedSqlSha256 !== policy.queries[0].sqlSha256)
      add("SQL_HASH_POLICY_MISMATCH","approved SQL differs from policy");
    const maps = await Promise.all([
      inventory(root,"approved",new Set([entry.approvedSqlFile]),add),
      inventory(root,"records",new Set([entry.recordFile]),add),
      inventory(root,"raw",new Set([entry.rawExportFile]),add),
      inventory(root,"exports",new Set([entry.jsonlFile]),add),
    ]);
    const sql = maps[0].get(entry.approvedSqlFile), recordBytes = maps[1].get(entry.recordFile);
    const raw = maps[2].get(entry.rawExportFile), converted = maps[3].get(entry.jsonlFile);
    if (!sql || !recordBytes || !raw || !converted) return result(findings);
    if (hash(sql) !== entry.approvedSqlSha256) add("SQL_HASH_MISMATCH","approved SQL bytes");
    if (hash(recordBytes) !== entry.recordSha256) add("RECORD_HASH_MISMATCH","execution record bytes");
    if (hash(raw) !== entry.rawExportSha256) add("RAW_HASH_MISMATCH","raw export bytes");
    if (hash(converted) !== entry.jsonlSha256) add("JSONL_HASH_MISMATCH","converted bytes");
    let record, rawRows, jsonlRows;
    try { record = parseUniqueJson(recordBytes); }
    catch (e) { add(e instanceof DuplicateJsonKeyError ? "DUPLICATE_JSON_KEY" : "RECORD_JSON_INVALID","execution record"); }
    try { rawRows = csv(raw); }
    catch (e) { add(e instanceof DuplicateJsonKeyError ? "DUPLICATE_JSON_KEY" : "RAW_CSV_INVALID","raw CSV"); }
    try { jsonlRows = jsonl(converted); }
    catch (e) { add(e instanceof DuplicateJsonKeyError ? "DUPLICATE_JSON_KEY" : "JSONL_INVALID","converted JSONL"); }
    if (record) {
      const recordKeys = ["queryId","executionId","projectRef","databaseName","postgresVersion",
        "operator","currentUser","sessionUser","executedAtUtc","success","sqlVersion",
        "executedSql","executedSqlSha256","rawExportFile","rawExportSha256",
        "rawExportSourceId","jsonlFile","jsonlSha256","rowCount","columns","truncated"];
      if (!exactKeys(record,recordKeys) || !nonempty(record.executionId) || !utc(record.executedAtUtc) ||
          record.success !== true || !count(record.rowCount) || !Array.isArray(record.columns) ||
          record.columns.length !== 1 || record.columns[0] !== "snapshot_row" ||
          record.truncated !== false || !isHash(record.executedSqlSha256))
        add("EXECUTION_RECORD_INVALID","required execution fields");
      if (record.queryId !== entry.id || record.sqlVersion !== entry.version ||
          record.projectRef !== policy.projectRef) add("EXECUTION_MAPPING_MISMATCH","query/version/project");
      if (record.databaseName !== policy.databaseName) add("DATABASE_MISMATCH","record / policy");
      if (record.postgresVersion !== policy.postgresVersion) add("POSTGRES_VERSION_MISMATCH","record / policy");
      if (record.operator !== policy.identity.operator ||
          record.currentUser !== policy.identity.currentUser ||
          record.sessionUser !== policy.identity.sessionUser) add("EXECUTION_IDENTITY_MISMATCH","record / policy");
      if (record.rawExportFile !== entry.rawExportFile ||
          record.rawExportSha256 !== entry.rawExportSha256 ||
          record.rawExportSourceId !== entry.rawExportSourceId ||
          record.jsonlFile !== entry.jsonlFile || record.jsonlSha256 !== entry.jsonlSha256 ||
          record.rowCount !== entry.rowCount || JSON.stringify(record.columns) !== JSON.stringify(entry.columns))
        add("EXECUTION_FILE_MAPPING_MISMATCH","record / manifest");
      if (typeof record.executedSql !== "string" ||
          hash(Buffer.from(record.executedSql ?? "","utf8")) !== record.executedSqlSha256 ||
          record.executedSqlSha256 !== entry.approvedSqlSha256 ||
          !sql.equals(Buffer.from(record.executedSql ?? "","utf8")))
        add("EXECUTED_SQL_MISMATCH","full executed SQL bytes / approved SQL");
    }
    if (rawRows && jsonlRows) {
      if (rawRows.length !== entry.rowCount || jsonlRows.length !== entry.rowCount ||
          record?.rowCount !== rawRows.length) add("EXPORT_ROW_COUNT_MISMATCH","manifest / record / files");
      if (!isDeepStrictEqual(rawRows,jsonlRows)) add("CONVERSION_MISMATCH","CSV / JSONL rows");
      validateRows(jsonlRows,policy,add);
    }
    return result(findings);
  } catch (error) {
    add(error instanceof DuplicateJsonKeyError ? "DUPLICATE_JSON_KEY" : "VALIDATION_ERROR",
      error instanceof DuplicateJsonKeyError ? "duplicate object key" : String(error.message));
    return result(findings);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv.length !== 5) {
    process.stderr.write("Usage: node scripts/catalog-a6-evidence-validator.mjs <bundle-dir> <separate-policy.json> <independent-policy-sha256>\n");
    process.exitCode = 2;
  } else {
    const output = await validateCatalogA6Evidence(process.argv[2],process.argv[3],process.argv[4]);
    process.stdout.write(`${JSON.stringify(output,null,2)}\n`);
    process.exitCode = output.internalConsistency === "INTERNAL_CONSISTENCY_PASS" ? 0 : 1;
  }
}
