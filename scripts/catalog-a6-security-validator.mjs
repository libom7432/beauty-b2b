// A6 Scheme B local security baseline comparator. No database or network access.
// Formal PASS requires an external full-file hash anchor and a verified signature
// from an independently trusted Ed25519 public key. No real A5 baseline is embedded.
import { createHash, createPublicKey, verify } from "node:crypto";
import { parseUniqueJson } from "./catalog-a6-evidence-validator.mjs";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const hashOK = (x) => typeof x === "string" && /^[a-f0-9]{64}$/.test(x);
const str = (x) => typeof x === "string" && x.length > 0 && x.trim() === x;
const obj = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const bool = (x) => typeof x === "boolean";
const issue = (code,detail) => ({code,detail});
const utc = (x) => str(x) && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(x) &&
  !Number.isNaN(Date.parse(x)) && new Date(x).toISOString() === x;
const unique = (values) => new Set(values).size === values.length;

// Canonical form covers every scope/permission field; array order is retained.
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (obj(value)) return `{${Object.keys(value).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  if (value === null || typeof value === "string" || typeof value === "number" ||
      typeof value === "boolean") return JSON.stringify(value);
  throw new Error("unsupported baseline value");
}
export const baselineContent = (b) => ({baselineId:b.baselineId,version:b.version,
  projectRef:b.projectRef,databaseName:b.databaseName,postgresVersion:b.postgresVersion,
  permissions:b.permissions});
export const approvalMessage = (b) => Buffer.from(canonicalJson({
  contentSha256:b.contentSha256,status:b.approval.status,
  approver:b.approval.approver,signedRecordRef:b.approval.signedRecordRef,
  signedAtUtc:b.approval.signedAtUtc,signerKeyId:b.approval.signerKeyId,
}),"utf8");

// Accepted baseline arrays have explicit, exact names; no role-prefix rule exists.
const permissionKeys = ["roles","memberships","database","schemas","publicSchemas","databaseAcl",
  "databaseBuiltinAcl","schemaAcl","schemaBuiltinAcl","defaultAcl","defaultAclBuiltin",
  "effectiveDatabase","effectiveSchema","privilegedSetRolePaths"];
const roleFlags = ["superuser","createDb","createRole","login","replication",
  "bypassRls","inherit"];
const highFlags = ["superuser","bypassRls","createRole","createDb","replication"];
const matchKeys = (v,keys) => obj(v) && Object.keys(v).length === keys.length &&
  keys.every((key) => Object.hasOwn(v,key));
const roleShape = (r) => matchKeys(r,["name","connectionLimit",...roleFlags]) && str(r.name) &&
  Number.isSafeInteger(r.connectionLimit) && roleFlags.every((k) => bool(r[k]));
const membershipShape = (m) => matchKeys(m,["member","parent","grantor","adminOption",
  "inheritOption","setOption"]) && ["member","parent","grantor"].every((k) => str(m[k])) &&
  ["adminOption","inheritOption","setOption"].every((k) => bool(m[k]));
const aclShape = (a,kind) => {
  const prefix = kind === "database" ? [] : kind === "schema" ? ["schema"] :
    ["creator","scope","schema","objectType"];
  if (!matchKeys(a,[...prefix,"aclSource","grantee","grantor","privilege","grantable"]))
    return false;
  return ["grantee","grantor","privilege","aclSource"].every((k) => str(a[k])) &&
    bool(a.grantable) && (kind !== "schema" || str(a.schema)) &&
    (kind !== "default" || (str(a.creator) &&
      ((a.scope === "ALL_SCHEMAS" && a.schema === null) ||
       (a.scope === "SCHEMA" && str(a.schema))) &&
      ["r","S","f","n"].includes(a.objectType)));
};
const dbEffectiveShape = (x) => matchKeys(x,["role","roleExists","connect","create","temp"]) &&
  str(x.role) && bool(x.roleExists) && ["connect","create","temp"].every((k) =>
    x.roleExists ? bool(x[k]) : x[k] === null);
const schemaEffectiveShape = (x) => matchKeys(x,["role","schema","roleExists",
  "schemaExists","usage","create"]) && str(x.role) && str(x.schema) &&
  bool(x.roleExists) && bool(x.schemaExists) && ["usage","create"].every((k) =>
    x.roleExists && x.schemaExists ? bool(x[k]) : x[k] === null);

function projectRows(rows, add) {
  if (!Array.isArray(rows)) { add("SNAPSHOT_INVALID","rows must be an array"); return null; }
  const wanted = new Set(["database","schema","role","membership","database_acl_state",
    "database_acl","database_builtin_acl","public_database_privilege","schema_acl_state",
    "schema_acl","schema_builtin_acl","public_schema_privilege","default_acl",
    "default_acl_builtin","default_acl_state","effective_database","effective_schema"]);
  const parts = new Map([...wanted].map((s) => [s,[]]));
  const rowKeys = new Set();
  for (const r of rows) {
    if (!obj(r) || !str(r.section) || !str(r.item) || !str(r.row_key) || !obj(r.data)) {
      add("SNAPSHOT_INVALID","malformed row"); continue;
    }
    if (r.row_key !== `${r.section}:${r.item}` || rowKeys.has(r.row_key))
      add("SNAPSHOT_DUPLICATE_OR_BAD_KEY",r.row_key);
    rowKeys.add(r.row_key);
    if (wanted.has(r.section)) parts.get(r.section).push(r);
  }
  const data = (s) => parts.get(s).map((r) => r.data);
  const exactlyOne = (s) => {
    if (parts.get(s).length !== 1) add("SNAPSHOT_SECTION_MISSING",s);
    return parts.get(s)[0]?.data;
  };
  const db = exactlyOne("database");
  const publicDb = exactlyOne("public_database_privilege");
  const dbState = exactlyOne("database_acl_state");
  const defaultState = exactlyOne("default_acl_state");
  if (!parts.get("role").length || !parts.get("schema_acl_state").length ||
      !parts.get("schema").length ||
      !parts.get("public_schema_privilege").length || !parts.get("effective_database").length ||
      !parts.get("effective_schema").length) add("SNAPSHOT_SECTION_MISSING","critical permissions");
  const roles = data("role").map((r) => ({name:r.role_name,connectionLimit:r.connection_limit,
    superuser:r.superuser,createDb:r.create_db,createRole:r.create_role,login:r.login,
    replication:r.replication,bypassRls:r.bypass_rls,inherit:r.inherit}));
  for (const r of parts.get("role")) if (!/^\d+$/.test(r.data.role_oid ?? "") ||
      r.item !== r.data.role_name) add("ROLE_OID_OR_NAME_INVALID",r.item);
  const memberships = data("membership").map((m) => ({member:m.member,parent:m.parent,
    grantor:m.grantor,adminOption:m.admin_option,inheritOption:m.inherit_option,
    setOption:m.set_option}));
  const roleOids = new Map(parts.get("role").map((r) => [r.data.role_name,r.data.role_oid]));
  if (!unique([...roleOids.values()])) add("ROLE_OID_OR_NAME_INVALID","duplicate role OID");
  if (db && roleOids.get(db.owner) !== db.owner_oid)
    add("DATABASE_IDENTITY_INVALID","owner name / OID / role mismatch");
  for (const r of parts.get("membership")) if (!/^\d+$/.test(r.item) ||
      r.item !== r.data.membership_oid ||
      ["member_oid","parent_oid","grantor_oid"].some((k) => !/^\d+$/.test(r.data[k] ?? "")) ||
      ["member_name_resolved","parent_name_resolved","grantor_name_resolved"]
        .some((k) => r.data[k] !== true) ||
      [["member","member_oid"],["parent","parent_oid"],["grantor","grantor_oid"]]
        .some(([name,oid]) => roleOids.get(r.data[name]) !== r.data[oid]))
    add("MEMBERSHIP_IDENTITY_INVALID",r.item);
  const mapAcl = (section,kind) => data(section).map((a) => ({
    ...(kind === "schema" ? {schema:a.schema} : {}),
    ...(kind === "default" ? {creator:a.creator,scope:a.scope,schema:a.schema,
      objectType:a.object_type} : {}),
    aclSource:a.acl_source,grantee:a.grantee,grantor:a.grantor,
    privilege:a.privilege,grantable:a.grantable,
  }));
  for (const section of ["database_acl","database_builtin_acl","schema_acl",
    "schema_builtin_acl","default_acl","default_acl_builtin"]) for (const r of parts.get(section)) {
    const a = r.data;
    if ((a.grantee === "PUBLIC" ? a.grantee_oid !== "0" :
        roleOids.get(a.grantee) !== a.grantee_oid) ||
        roleOids.get(a.grantor) !== a.grantor_oid ||
        (section.startsWith("default_acl") && roleOids.get(a.creator) !== a.creator_oid))
      add("ACL_PRINCIPAL_IDENTITY_INVALID",r.row_key);
  }
  const schemaIdentity = new Map(parts.get("schema").map((r) => [r.item,r.data]));
  if (schemaIdentity.size !== parts.get("schema").length)
    add("DUPLICATE_PERMISSION_RECORD","schema identity");
  const schemas = data("schema_acl_state").map((s) => {
    const identity = schemaIdentity.get(s.schema);
    if (!identity || identity.exists !== s.exists ||
        identity.owner_oid !== s.owner_oid ||
        (s.exists && (!str(identity.owner) || !/^\d+$/.test(identity.owner_oid ?? "") ||
          roleOids.get(identity.owner) !== identity.owner_oid)))
      add("SCHEMA_IDENTITY_INVALID",s.schema);
    return {name:s.schema,exists:s.exists,owner:identity?.owner ?? null,
      aclIsNull:s.acl_is_null,aclSource:s.acl_source};
  });
  for (const name of schemaIdentity.keys()) if (!schemas.some((s) => s.name === name))
    add("SCHEMA_IDENTITY_INVALID",name);
  const publicSchemas = data("public_schema_privilege").map((s) => ({name:s.schema,
    exists:s.exists,usage:s.usage,create:s.create,aclSource:s.acl_source}));
  const effectiveDatabase = data("effective_database").map((x) => ({role:x.role,
    roleExists:x.role_exists,connect:x.connect,create:x.create,temp:x.temp}));
  const effectiveSchema = data("effective_schema").map((x) => ({role:x.role,schema:x.schema,
    roleExists:x.role_exists,schemaExists:x.schema_exists,usage:x.usage,create:x.create}));
  if (!Number.isSafeInteger(defaultState?.explicit_default_acl_entry_count) ||
      defaultState.explicit_default_acl_entry_count !== parts.get("default_acl").length ||
      defaultState.zero_entries_mean_builtin_rules_still_apply !== true)
    add("DEFAULT_ACL_STATE_INVALID","explicit default ACL count / built-in marker");
  if (db?.owner_oid !== dbState?.owner_oid || !str(db?.owner))
    add("DATABASE_IDENTITY_INVALID","owner or owner OID mismatch");
  const database = {name:db?.name,serverVersion:db?.server_version,owner:db?.owner,
    public:{connect:publicDb?.connect,
    create:publicDb?.create,temp:publicDb?.temp},aclIsNull:dbState?.acl_is_null,
    aclSource:dbState?.acl_source};
  const projected = {roles,memberships,database,schemas,publicSchemas,
    databaseAcl:mapAcl("database_acl","database"),
    databaseBuiltinAcl:mapAcl("database_builtin_acl","database"),
    schemaAcl:mapAcl("schema_acl","schema"),
    schemaBuiltinAcl:mapAcl("schema_builtin_acl","schema"),
    defaultAcl:mapAcl("default_acl","default"),
    defaultAclBuiltin:mapAcl("default_acl_builtin","default"),
    effectiveDatabase,effectiveSchema};
  return projected;
}

function checkStructure(actual, expected, add) {
  if (!matchKeys(expected,permissionKeys) ||
      permissionKeys.filter((k) => k !== "database" && k !== "schemas")
        .some((k) => !Array.isArray(expected[k])) || !obj(expected.database) ||
      !Array.isArray(expected.schemas)) {
    add("BASELINE_STRUCTURE_INVALID","permission arrays and database object required");
    return false;
  }
  for (const side of [actual,expected]) {
    if (side === expected && (side.privilegedSetRolePaths.some((x) =>
      !matchKeys(x,["member","privilegedRole"]) || !str(x.member) || !str(x.privilegedRole)) ||
      !unique(side.privilegedSetRolePaths.map((x) => canonicalJson(x)))))
      add("BASELINE_REACHABILITY_INVALID","approved SET ROLE path list");
    if (side.roles.some((r) => !roleShape(r)) ||
        side.memberships.some((m) => !membershipShape(m)) ||
        side.effectiveDatabase.some((x) => !dbEffectiveShape(x)) ||
        side.effectiveSchema.some((x) => !schemaEffectiveShape(x)) ||
        [...side.databaseAcl,...side.databaseBuiltinAcl].some((a) => !aclShape(a,"database")) ||
        [...side.schemaAcl,...side.schemaBuiltinAcl].some((a) => !aclShape(a,"schema")) ||
        [...side.defaultAcl,...side.defaultAclBuiltin].some((a) => !aclShape(a,"default")))
      add("PERMISSION_ROW_INVALID","invalid role, membership, ACL or effective permission fields");
    if (!matchKeys(side.database,["name","serverVersion","owner","public","aclIsNull","aclSource"]) ||
        !matchKeys(side.database.public,["connect","create","temp"]) ||
        !["connect","create","temp"].every((k) => bool(side.database.public[k])) ||
        !bool(side.database.aclIsNull) || !str(side.database.aclSource) ||
        !str(side.database.name) || !str(side.database.serverVersion) ||
        !str(side.database.owner) || side.schemas.some((s) =>
          !matchKeys(s,["name","exists","owner","aclIsNull","aclSource"]) || !str(s.name) ||
          (s.exists ? !str(s.owner) : s.owner !== null) ||
          !bool(s.exists) || !(s.aclIsNull === null || bool(s.aclIsNull)) || !str(s.aclSource)) ||
        side.publicSchemas.some((s) => !matchKeys(s,["name","exists","usage","create","aclSource"]) ||
          !str(s.name) || !bool(s.exists) || !str(s.aclSource) ||
          (s.exists ? !bool(s.usage) || !bool(s.create) : s.usage !== null || s.create !== null)))
      add("PERMISSION_ROW_INVALID","database or Schema permission fields");
    for (const [name,items,key] of [
      ["roles",side.roles,(x) => x.name],
      ["memberships",side.memberships,(x) => `${x.member}\0${x.parent}\0${x.grantor}`],
      ["schemas",side.schemas,(x) => x.name],
      ["publicSchemas",side.publicSchemas,(x) => x.name],
      ["effectiveDatabase",side.effectiveDatabase,(x) => x.role],
      ["effectiveSchema",side.effectiveSchema,(x) => `${x.role}\0${x.schema}`],
    ]) if (!unique(items.map(key))) add("DUPLICATE_PERMISSION_RECORD",name);
    for (const section of ["databaseAcl","databaseBuiltinAcl","schemaAcl","schemaBuiltinAcl",
      "defaultAcl","defaultAclBuiltin"]) if (!unique(side[section].map(aclKey)))
      add("DUPLICATE_PERMISSION_RECORD",section);
    const effectiveRoles = new Set(side.effectiveDatabase.map((x) => x.role));
    for (const role of side.roles) if (!effectiveRoles.has(role.name))
      add("MISSING_EFFECTIVE_ROLE",role.name);
    const effectiveSchemas = new Set(side.effectiveSchema.map((x) => `${x.role}\0${x.schema}`));
    for (const role of side.effectiveDatabase) for (const schema of side.schemas)
      if (!effectiveSchemas.has(`${role.role}\0${schema.name}`))
        add("MISSING_EFFECTIVE_SCHEMA",`${role.role}:${schema.name}`);
  }
  if (actual.database.name !== expected.database.name ||
      actual.database.serverVersion !== expected.database.serverVersion)
    add("DATABASE_MISMATCH","snapshot / approved baseline");
  return true;
}

function compareList(label,actual,expected,key,drift,add) {
  const actualMap = new Map(actual.map((x) => [key(x),x]));
  const expectedMap = new Map(expected.map((x) => [key(x),x]));
  for (const [k,x] of actualMap) {
    if (!expectedMap.has(k)) add(drift.unknown,`${label}:${k}`);
    else if (canonicalJson(x) !== canonicalJson(expectedMap.get(k)))
      add(drift.changed,`${label}:${k}`);
  }
  for (const k of expectedMap.keys()) if (!actualMap.has(k))
    add(drift.missing,`${label}:${k}`);
}
const aclKey = (x) => canonicalJson([x.schema ?? null,x.creator ?? null,x.scope ?? null,
  x.objectType ?? null,x.grantee,x.grantor,x.privilege]);

function setRolePaths(roles,memberships) {
  const high = new Set(roles.filter((r) => highFlags.some((k) => r[k])).map((r) => r.name));
  const edges = new Map(roles.map((r) => [r.name,[]]));
  for (const m of memberships) if (m.setOption && edges.has(m.member))
    edges.get(m.member).push(m.parent);
  const paths = [];
  for (const r of roles) {
    const seen = new Set([r.name]), queue = [...edges.get(r.name)];
    while (queue.length) {
      const target = queue.shift();
      if (seen.has(target)) continue;
      seen.add(target);
      if (high.has(target)) paths.push({member:r.name,privilegedRole:target});
      queue.push(...(edges.get(target) ?? []));
    }
  }
  return paths.sort((a,b) => canonicalJson(a).localeCompare(canonicalJson(b)));
}

function comparePermissions(actual, expected, add) {
  if (!checkStructure(actual,expected,add)) return;
  compareList("role",actual.roles,expected.roles,(x) => x.name,
    {unknown:"UNKNOWN_ROLE",missing:"MISSING_ROLE",changed:"ROLE_PRIVILEGE_DRIFT"},add);
  const mkey = (x) => `${x.member}\0${x.parent}\0${x.grantor}`;
  compareList("membership",actual.memberships,expected.memberships,mkey,
    {unknown:"UNKNOWN_MEMBERSHIP",missing:"MISSING_MEMBERSHIP",changed:"MEMBERSHIP_OPTION_DRIFT"},add);
  for (const m of actual.memberships) if (expected.memberships.some((x) =>
    x.member === m.member && x.parent === m.parent && x.grantor !== m.grantor))
    add("MEMBERSHIP_GRANTOR_DRIFT",`${m.member}->${m.parent}`);
  if (canonicalJson(actual.database) !== canonicalJson(expected.database))
    add("PUBLIC_PRIVILEGE_DRIFT","database PUBLIC or ACL source");
  compareList("schema",actual.schemas,expected.schemas,(x) => x.name,
    {unknown:"UNKNOWN_SCHEMA",missing:"MISSING_SCHEMA",changed:"SCHEMA_ACL_DRIFT"},add);
  compareList("Schema PUBLIC",actual.publicSchemas,expected.publicSchemas,(x) => x.name,
    {unknown:"UNKNOWN_SCHEMA",missing:"MISSING_SCHEMA",changed:"PUBLIC_PRIVILEGE_DRIFT"},add);
  const known = new Set(actual.roles.map((r) => r.name));
  for (const section of ["databaseAcl","databaseBuiltinAcl","schemaAcl","schemaBuiltinAcl",
    "defaultAcl","defaultAclBuiltin"]) {
    for (const row of actual[section]) if ((row.grantee !== "PUBLIC" && !known.has(row.grantee)) ||
        !known.has(row.grantor) || (row.creator && !known.has(row.creator)))
      add("UNKNOWN_ACL_PRINCIPAL",`${section}:${aclKey(row)}`);
    const schemaNames = new Set(actual.schemas.map((s) => s.name));
    for (const row of actual[section]) if (row.schema !== undefined && row.schema !== null &&
        !schemaNames.has(row.schema)) add("UNKNOWN_SCHEMA",`${section}:${row.schema}`);
    compareList(section,actual[section],expected[section],aclKey,
      {unknown:section.startsWith("default") ? "DEFAULT_ACL_EXPANSION" : "UNKNOWN_ACL_GRANT",
        missing:section.startsWith("default") ? "DEFAULT_ACL_DRIFT" : "MISSING_ACL_GRANT",
        changed:section.startsWith("default") ? "DEFAULT_ACL_EXPANSION" : "ACL_PRIVILEGE_DRIFT"},add);
  }
  compareList("effective database",actual.effectiveDatabase,expected.effectiveDatabase,(x) => x.role,
    {unknown:"UNKNOWN_EFFECTIVE_ROLE",missing:"MISSING_EFFECTIVE_ROLE",changed:"EFFECTIVE_PRIVILEGE_DRIFT"},add);
  compareList("effective Schema",actual.effectiveSchema,expected.effectiveSchema,
    (x) => `${x.role}\0${x.schema}`,
    {unknown:"UNKNOWN_EFFECTIVE_SCHEMA",missing:"MISSING_EFFECTIVE_SCHEMA",changed:"EFFECTIVE_PRIVILEGE_DRIFT"},add);
  const runtime = actual.effectiveDatabase.find((x) => x.role === "catalog_admin_reader_runtime");
  if (runtime?.roleExists && (runtime.temp !== false || actual.database.public.temp))
    add("RUNTIME_TEMP_CONFLICT","catalog_admin_reader_runtime effective TEMP must be false");
  const actualPaths = setRolePaths(actual.roles,actual.memberships);
  const expectedPaths = setRolePaths(expected.roles,expected.memberships);
  if (canonicalJson(actualPaths) !== canonicalJson(expectedPaths) ||
      canonicalJson(actualPaths) !== canonicalJson(expected.privilegedSetRolePaths))
    add("PRIVILEGED_ROLE_REACHABILITY_DRIFT","SET ROLE path to high privilege");
}

// baselineBytes must be supplied independently of snapshotRows; expectedBaselineSha256
// and trustedApprovalPublicKeyPem must come from a trusted approval channel.
export function validateCatalogA6Security(snapshotRows,baselineBytes,expectedBaselineSha256,trust={}) {
  const baselineFindings = [], comparisonFindings = [];
  const badd = (code,detail) => baselineFindings.push(issue(code,detail));
  const cadd = (code,detail) => comparisonFindings.push(issue(code,detail));
  let baseline;
  try {
    if (!Buffer.isBuffer(baselineBytes)) throw new Error("baseline bytes required");
    if (!isFinite(baselineBytes.length) || !hashOK(expectedBaselineSha256) ||
        sha256(baselineBytes) !== expectedBaselineSha256)
      badd("BASELINE_HASH_MISMATCH","independent full-file SHA-256 anchor");
    const text = baselineBytes.toString("utf8");
    if (!Buffer.from(text,"utf8").equals(baselineBytes)) throw new Error("invalid UTF-8");
    baseline = parseUniqueJson(Buffer.from(text,"utf8"));
    if (!matchKeys(baseline,["kind","baselineId","version","projectRef","databaseName",
      "postgresVersion","approval","contentSha256","permissions"]) ||
        baseline.kind !== "CATALOG_A6_SECURITY_BASELINE_V1" ||
        !["SYNTHETIC_APPROVED","APPROVED","PENDING"].includes(baseline.approval?.status) ||
        !str(baseline.baselineId) || !str(baseline.version) ||
        !/^[a-z0-9]{20}$/.test(baseline.projectRef ?? "") ||
        !str(baseline.databaseName) || !str(baseline.postgresVersion) ||
        !matchKeys(baseline.approval,["status","approver","signedRecordRef",
          "signedAtUtc","signerKeyId","signatureBase64"]))
      badd("BASELINE_INVALID","identity, approval or permission record missing");
    else {
      const calculated = sha256(Buffer.from(canonicalJson(baselineContent(baseline))));
      if (!hashOK(baseline.contentSha256) || calculated !== baseline.contentSha256)
        badd("BASELINE_HASH_MISMATCH","content SHA-256");
      if (baseline.projectRef !== trust.expectedProjectRef ||
          baseline.databaseName !== trust.expectedDatabaseName ||
          baseline.postgresVersion !== trust.expectedPostgresVersion)
        badd("BASELINE_TARGET_MISMATCH","independently expected project/database/version");
      if (baseline.approval.status === "PENDING" ||
          (trust.mode === "formal" && baseline.approval.status !== "APPROVED") ||
          (trust.mode === "synthetic" && baseline.approval.status !== "SYNTHETIC_APPROVED") ||
          !["formal","synthetic"].includes(trust.mode))
        badd("BASELINE_UNAPPROVED","approval status is not valid for invocation mode");
      if (!str(baseline.approval.approver) || !str(baseline.approval.signedRecordRef) ||
          !utc(baseline.approval.signedAtUtc) || !str(baseline.approval.signerKeyId) ||
          !str(baseline.approval.signatureBase64) ||
          typeof trust.trustedApprovalPublicKeyPem !== "string" ||
          !trust.trustedApprovalPublicKeyPem.trim() ||
          baseline.approval.signerKeyId !== trust.trustedSignerKeyId ||
          baseline.approval.signedRecordRef !== trust.trustedApprovalRecordRef)
        badd("BASELINE_UNAPPROVED","trusted signer and signed record required");
      else try {
        const signature = Buffer.from(baseline.approval.signatureBase64,"base64");
        if (!signature.length || !verify(null,approvalMessage(baseline),
          createPublicKey(trust.trustedApprovalPublicKeyPem),signature))
          badd("BASELINE_UNAPPROVED","approval signature invalid");
      } catch { badd("BASELINE_UNAPPROVED","approval signature invalid"); }
    }
  } catch (error) { badd("BASELINE_INVALID",error.message); }
  if (baseline?.permissions) try {
    const actual = projectRows(snapshotRows,cadd);
    if (actual) {
      if (actual.database.name !== baseline.databaseName ||
          actual.database.serverVersion !== baseline.postgresVersion)
        cadd("BASELINE_TARGET_MISMATCH","snapshot database/version outside approved scope");
      comparePermissions(actual,baseline.permissions,cadd);
    }
  } catch (error) { cadd("PERMISSION_COMPARISON_INVALID",error.message); }
  else cadd("BASELINE_UNAVAILABLE","cannot compare without baseline permissions");
  const baselineStatus = baselineFindings.length ? "BLOCKED" :
    trust.mode === "synthetic" ? "SYNTHETIC_VERIFIED" : "APPROVED_VERIFIED";
  const comparisonStatus = comparisonFindings.length ? "BLOCKED" : "PASS";
  return {
    baselineValidation:{status:baselineStatus,findings:baselineFindings},
    permissionComparison:{status:comparisonStatus,findings:comparisonFindings},
    security:{status:baselineStatus === "BLOCKED" || comparisonStatus === "BLOCKED" ? "BLOCKED" :
      trust.mode === "synthetic" ? "SYNTHETIC_PASS" : "PASS",
      findings:[...baselineFindings,...comparisonFindings]},
    scope:"LOCAL_SNAPSHOT_COMPARISON_ONLY",
  };
}
