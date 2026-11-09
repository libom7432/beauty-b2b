// A6 Scheme B offline prototype. It reads local files only; it has no database client.
// PASS in the evidence layer means internal bundle consistency, not cloud provenance.
import { createHash } from "node:crypto";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { checkCatalogPermissionSnapshot } from "./check-catalog-supabase-snapshot.mjs";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const hex256 = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const nonempty = (value) => typeof value === "string" && value.trim() === value && value.length > 0;
const projectRef = (value) => typeof value === "string" && /^[a-z0-9]{20}$/.test(value);
const queryIds = new Set(["snapshot", "migration-history"]);
const stages = new Set(["empty", "foundation", "admin-read"]);
const snapshotSections = new Set(["database","business_inventory","permission_inventory",
  "business_object","migration_registry","schema","relation","policy","role","membership",
  "database_acl","schema_acl","relation_acl","default_acl","function","function_acl",
  "function_effective","rfq_function_effective","effective_database","effective_schema",
  "effective_relation"]);
const requiredSnapshotSections = ["database","business_inventory","permission_inventory",
  "migration_registry","schema","role","database_acl","schema_acl",
  "effective_database","effective_schema"];
const foundationSections = ["business_object","relation","policy","relation_acl",
  "function","function_acl","function_effective","effective_relation"];
const utcInstant = (value) => typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
  !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value;

// Compare the complete server_version value, including any build suffix, byte for byte.
// A different suffix or patch version needs a separately hashed approval policy.
function databaseIdentity(value, source, add) {
  if (value === undefined || value === null) {
    add("DATABASE_IDENTITY_MISSING", source);
    return false;
  }
  if (!nonempty(value)) {
    add("DATABASE_IDENTITY_INVALID", source);
    return false;
  }
  return true;
}

const sameFile = (a,b) => a.dev === b.dev && a.ino === b.ino;
const sameVersion = (a,b) => sameFile(a,b) && a.size === b.size &&
  a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;

// Validate each path component, then validate and read the final file through one descriptor.
// The optional callback is a deterministic test seam for replacement after open.
export async function readStableBundleFile(root, relative, afterOpenForTest) {
  if (!nonempty(relative) || path.isAbsolute(relative) || relative.includes("\\") ||
      relative.split("/").some((part) => !part || part === "." || part === ".."))
    throw new Error("unsafe relative path");
  let current = root;
  const checked = [];
  const rootStat = await lstat(root,{bigint:true});
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error("unsafe bundle directory");
  checked.push([root,rootStat]);
  const parts = relative.split("/");
  for (const [index, part] of parts.entries()) {
    current = path.join(current, part);
    const stat = await lstat(current,{bigint:true});
    if (stat.isSymbolicLink() || (index < parts.length - 1 ? !stat.isDirectory() : !stat.isFile()))
      throw new Error("symlink or non-file component");
    checked.push([current,stat]);
  }
  const handle = await open(current,constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const opened = await handle.stat({bigint:true});
    if (!opened.isFile() || !sameFile(opened,checked.at(-1)[1]))
      throw new Error("opened file differs from checked path");
    if (afterOpenForTest) await afterOpenForTest();
    const bytes = await handle.readFile();
    const afterRead = await handle.stat({bigint:true});
    if (!sameVersion(opened,afterRead) || BigInt(bytes.length) !== afterRead.size)
      throw new Error("file changed during read");
    for (const [name,before] of checked) {
      const after = await lstat(name,{bigint:true});
      if (after.isSymbolicLink() || !sameVersion(before,after))
        throw new Error("path changed during read");
    }
    return bytes;
  } finally { await handle.close(); }
}

const canonicalEvidencePath = (value, directory, extension) => {
  if (typeof value !== "string") return false;
  const parts = value.split("/");
  if (parts.length !== 2 || parts[0] !== directory ||
      !parts[1].endsWith(`.${extension}`)) return false;
  return /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(
    parts[1].slice(0,-extension.length - 1));
};

// The bundle must be in a controlled directory without concurrent writers.
// Enumerate before and after reading, and use the same validated file bytes below.
async function inventoryEvidenceDirectory(root, directory, expected, add) {
  const results = new Map();
  const folder = path.join(root,directory);
  let before, names;
  try {
    before = await lstat(folder,{bigint:true});
    if (before.isSymbolicLink() || !before.isDirectory())
      throw new Error("not an ordinary directory");
    names = await readdir(folder);
  } catch {
    add("EVIDENCE_DIRECTORY_INVALID", directory);
    return results;
  }
  const lowerNames = new Set();
  for (const name of names) {
    const lower = name.toLowerCase();
    if (lowerNames.has(lower)) add("EVIDENCE_FILENAME_CASE_COLLISION",`${directory}/${name}`);
    lowerNames.add(lower);
    const relative = `${directory}/${name}`;
    if (!expected.has(relative)) add("UNDECLARED_EVIDENCE_FILE",relative);
    try {
      const stat = await lstat(path.join(folder,name),{bigint:true});
      if (stat.isSymbolicLink() || !stat.isFile())
        add("EVIDENCE_FILE_TYPE_INVALID",relative);
      else if (expected.has(relative))
        results.set(relative,await readStableBundleFile(root,relative));
    } catch { add("EVIDENCE_FILE_UNSTABLE",relative); }
  }
  for (const relative of expected) if (!results.has(relative))
    add("DECLARED_EVIDENCE_FILE_MISSING",relative);
  try {
    const after = await lstat(folder,{bigint:true});
    const endingNames = await readdir(folder);
    if (after.isSymbolicLink() || !sameVersion(before,after) ||
        JSON.stringify(names.sort()) !== JSON.stringify(endingNames.sort()))
      add("EVIDENCE_INVENTORY_CHANGED",directory);
  } catch { add("EVIDENCE_INVENTORY_CHANGED",directory); }
  return results;
}

class DuplicateJsonKeyError extends Error {
  constructor() { super("duplicate JSON object key"); }
}

// JSON.parse validates syntax; this second pass tracks decoded keys before any
// object can be accepted. Its grammar walk ignores strings and enters nested objects.
function parseUniqueJson(bytes) {
  const content = bytes.toString("utf8");
  if (Buffer.from(content,"utf8").compare(bytes) !== 0) throw new Error("invalid UTF-8");
  const parsed = JSON.parse(content);
  let offset = 0;
  const whitespace = () => {
    while (/[\t\n\r ]/.test(content[offset] ?? "")) offset++;
  };
  const string = () => {
    const start = offset++;
    while (offset < content.length) {
      const character = content[offset++];
      if (character === "\\") offset++;
      else if (character === '"') return JSON.parse(content.slice(start,offset));
    }
    throw new Error("unterminated JSON string");
  };
  const value = () => {
    whitespace();
    if (content[offset] === "{") {
      offset++; whitespace();
      const keys = new Set();
      if (content[offset] === "}") { offset++; return; }
      while (true) {
        const key = string();
        if (keys.has(key)) throw new DuplicateJsonKeyError();
        keys.add(key);
        whitespace(); offset++; // colon; the first JSON.parse validated punctuation.
        value(); whitespace();
        if (content[offset] === "}") { offset++; return; }
        offset++; whitespace(); // comma
      }
    }
    if (content[offset] === "[") {
      offset++; whitespace();
      if (content[offset] === "]") { offset++; return; }
      while (true) {
        value(); whitespace();
        if (content[offset] === "]") { offset++; return; }
        offset++; // comma
      }
    }
    if (content[offset] === '"') { string(); return; }
    while (offset < content.length && !/[,}\]\t\n\r ]/.test(content[offset])) offset++;
  };
  value(); whitespace();
  if (offset !== content.length) throw new Error("incomplete JSON scan");
  return parsed;
}

function parseJsonLines(bytes) {
  const content = bytes.toString("utf8");
  if (Buffer.from(content,"utf8").compare(bytes) !== 0) throw new Error("invalid UTF-8");
  const lines = content.split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop(); // One terminal line ending is allowed.
  if (!lines.length || lines.some((line) => line.length === 0))
    throw new Error("empty snapshot line or export");
  return lines.map((line) => parseUniqueJson(Buffer.from(line,"utf8")));
}

function parseVersions(bytes) {
  const content = bytes.toString("utf8");
  if (Buffer.from(content,"utf8").compare(bytes) !== 0) throw new Error("invalid UTF-8");
  return content.split(/\r?\n/).filter((line) => line.length > 0);
}

function snapshotStructureFindings(rows, stage) {
  const findings = [];
  if (rows.some((row) => !row || typeof row.section !== "string" ||
      typeof row.item !== "string" || !row.data || typeof row.data !== "object" ||
      Array.isArray(row.data))) {
    findings.push(blocked("SNAPSHOT_ROW_INVALID", "malformed section/item/data"));
    return findings;
  }
  const keys = rows.map((row) => `${row.section}\u0000${row.item}`);
  if (new Set(keys).size !== keys.length)
    findings.push(blocked("SNAPSHOT_DUPLICATE_ROW", "duplicate section/item"));
  const count = (section) => rows.filter((row) => row.section === section).length;
  for (const row of rows) if (!snapshotSections.has(row.section))
    findings.push(blocked("SNAPSHOT_UNKNOWN_SECTION", row.section));
  for (const section of [...requiredSnapshotSections,
    ...(stage === "foundation" || stage === "admin-read" ? foundationSections : [])]) {
    if (count(section) === 0)
      findings.push(blocked("SNAPSHOT_REQUIRED_SECTION_EMPTY", section));
  }
  for (const [section,item] of [["business_inventory","catalog-rfq-admin-prefixes"],
    ["migration_registry","supabase_migrations.schema_migrations"]]) {
    if (count(section) !== 1 || !rows.some((row) => row.section === section && row.item === item))
      findings.push(blocked("SNAPSHOT_REQUIRED_SECTION_MISSING", section));
  }
  if (!rows.some((row) => row.section === "schema_acl" && row.data.schema === "public"))
    findings.push(blocked("SNAPSHOT_REQUIRED_SECTION_MISSING", "public schema ACL"));
  const inventory = rows.filter((row) => row.section === "permission_inventory" &&
    row.item === "database-acl-and-membership");
  if (inventory.length !== 1 || inventory[0].data.complete !== true) {
    findings.push(blocked("SNAPSHOT_INVENTORY_MISSING", "one complete permission inventory required"));
    return findings;
  }
  const expected = {
    snapshot_row_count:rows.length, role_count:count("role"),
    membership_count:count("membership"), database_acl_count:count("database_acl"),
    public_schema_acl_count:rows.filter((row) => row.section === "schema_acl" &&
      row.data.schema === "public").length,
    business_object_count:count("business_object"),
  };
  if (Object.entries(expected).some(([key,value]) =>
    !Number.isSafeInteger(inventory[0].data[key]) || inventory[0].data[key] !== value))
    findings.push(blocked("SNAPSHOT_INVENTORY_MISMATCH", "row or section count mismatch"));
  return findings;
}

const blocked = (code, detail) => ({ code, detail });

// The hash anchor must come from an approval record outside the bundle and policy file.
// Matching bytes do not authenticate the approver, operator, or SQL Editor session.
export async function validateOfflineBundle(bundleDirectory, policyFile, expectedPolicySha256) {
  const evidenceFindings = [];
  const add = (code, detail) => evidenceFindings.push(blocked(code, detail));
  let root;
  try {
    const suppliedRoot = await lstat(bundleDirectory,{bigint:true});
    if (!suppliedRoot.isDirectory() || suppliedRoot.isSymbolicLink())
      throw new Error("bundle root must be an ordinary directory");
    root = await realpath(bundleDirectory);
    const resolvedRoot = await lstat(root,{bigint:true});
    if (!resolvedRoot.isDirectory() || !sameFile(suppliedRoot,resolvedRoot))
      throw new Error("bundle root changed during resolution");
  } catch {
    add("BUNDLE_UNAVAILABLE", "bundle directory cannot be read");
  }

  let policy;
  if (!hex256(expectedPolicySha256))
    add("POLICY_ANCHOR_MISSING", "independently approved policy SHA-256 is required");
  try {
    const policyReal = await realpath(policyFile);
    const inBundle = root && path.relative(root, policyReal);
    if (root && (inBundle === "" || (!inBundle.startsWith(`..${path.sep}`) && inBundle !== ".." &&
        !path.isAbsolute(inBundle)))) throw new Error("policy must be outside the evidence bundle");
    const policyBytes = await readStableBundleFile(path.dirname(path.resolve(policyFile)),
      path.basename(policyFile));
    if (sha256(policyBytes) !== expectedPolicySha256)
      add("POLICY_HASH_MISMATCH", "policy bytes differ from the independent approval anchor");
    policy = parseUniqueJson(policyBytes);
  } catch (error) {
    add(error instanceof DuplicateJsonKeyError ? "DUPLICATE_JSON_KEY" : "POLICY_UNAVAILABLE",
      "separate policy file cannot be read or parsed");
  }

  let manifest;
  if (root) try {
    manifest = parseUniqueJson(await readStableBundleFile(root,"manifest.json"));
  } catch (error) {
    add(error instanceof DuplicateJsonKeyError ? "DUPLICATE_JSON_KEY" : "MANIFEST_UNAVAILABLE",
      "manifest.json cannot be read or parsed");
  }

  if (!policy || policy.kind !== "CATALOG_A6_OFFLINE_POLICY_V1" ||
      !projectRef(policy.projectRef) || !stages.has(policy.stage) ||
      !["absent","present"].includes(policy.adminIdentity) ||
      (policy.stage === "empty" && policy.adminIdentity !== "absent") ||
      !policy.approvedIdentity || !nonempty(policy.approvedIdentity.operator) ||
      !nonempty(policy.approvedIdentity.currentUser) ||
      !nonempty(policy.approvedIdentity.sessionUser) ||
      policy.baselineApproval !== "NOT_APPROVED" ||
      !policy.sqlSha256 || !hex256(policy.sqlSha256.snapshot) ||
      !hex256(policy.sqlSha256["migration-history"]))
    add("INVALID_POLICY", "offline policy fields or hashes are invalid");
  const policyDatabaseValid = databaseIdentity(policy?.database_name,"policy.database_name",add);
  const policyVersionValid = databaseIdentity(policy?.postgres_version,"policy.postgres_version",add);
  if (!manifest || manifest.kind !== "CATALOG_A6_OFFLINE_BUNDLE_V1" ||
      !projectRef(manifest.projectRef) || !stages.has(manifest.stage) ||
      !["absent","present"].includes(manifest.adminIdentity) ||
      !Array.isArray(manifest.queries))
    add("INVALID_MANIFEST", "bundle manifest fields are invalid");

  if (policy && manifest) {
    if (policy.projectRef !== manifest.projectRef) add("PROJECT_REF_MISMATCH", "policy and manifest");
    if (policy.stage !== manifest.stage || policy.adminIdentity !== manifest.adminIdentity)
      add("STAGE_MISMATCH", "policy and manifest");
  }

  let snapshotRows;
  let migrationVersions = [];
  const seenIds = new Set();
  const seenRecordPaths = new Set();
  const seenExportPaths = new Set();
  const seenExecutionIds = new Set();
  if (root && manifest && Array.isArray(manifest.queries)) {
    const expectedRecords = new Set();
    const expectedExports = new Set();
    const recordNames = new Map();
    const exportNames = new Map();
    for (const entry of manifest.queries) {
      if (!queryIds.has(entry?.id)) continue;
      for (const [directory,field,extension,expected,names] of [
        ["records","executionRecordFile","json",expectedRecords,recordNames],
        ["exports","exportFile",entry.id === "snapshot" ? "jsonl" : "txt",
          expectedExports,exportNames],
      ]) {
        const relative = entry[field];
        if (typeof relative === "string") {
          const lower = relative.toLowerCase();
          if (names.has(lower) && names.get(lower) !== relative)
            add("EVIDENCE_FILENAME_CASE_COLLISION",relative);
          names.set(lower,relative);
        }
        if (!canonicalEvidencePath(relative,directory,extension)) {
          add("EVIDENCE_FILENAME_INVALID",`${entry.id}:${field}`);
          continue;
        }
        expected.add(relative);
      }
    }
    const recordFiles = await inventoryEvidenceDirectory(root,"records",expectedRecords,add);
    const exportFiles = await inventoryEvidenceDirectory(root,"exports",expectedExports,add);
    for (const entry of manifest.queries) {
      const id = entry?.id;
      if (!queryIds.has(id)) { add("UNKNOWN_QUERY", String(id)); continue; }
      if (seenIds.has(id)) { add("DUPLICATE_QUERY", id); continue; }
      seenIds.add(id);
      if (!hex256(entry.approvedSqlSha256) || !hex256(entry.executionRecordSha256) ||
          !hex256(entry.exportSha256)) { add("INVALID_HASH", id); continue; }
      if (policy?.sqlSha256?.[id] !== entry.approvedSqlSha256)
        add("SQL_HASH_POLICY_MISMATCH", id);
      if (seenRecordPaths.has(entry.executionRecordFile) ||
          seenExportPaths.has(entry.exportFile)) add("DUPLICATE_FILE_MAPPING", id);
      seenRecordPaths.add(entry.executionRecordFile);
      seenExportPaths.add(entry.exportFile);

      let approvedBytes, recordBytes, exportBytes, record;
      try { approvedBytes = await readStableBundleFile(root,entry.approvedSqlFile); }
      catch { add("APPROVED_SQL_MISSING", id); }
      try { recordBytes = recordFiles.get(entry.executionRecordFile);
        if (!recordBytes) throw new Error("unavailable record");
        record = parseUniqueJson(recordBytes); }
      catch (error) { add(error instanceof DuplicateJsonKeyError
        ? "DUPLICATE_JSON_KEY" : "EXECUTION_RECORD_MISSING", id); }
      exportBytes = exportFiles.get(entry.exportFile);
      if (!exportBytes) add("EXPORT_MISSING", id);
      if (approvedBytes && sha256(approvedBytes) !== entry.approvedSqlSha256)
        add("APPROVED_SQL_HASH_MISMATCH", id);
      if (recordBytes && sha256(recordBytes) !== entry.executionRecordSha256)
        add("EXECUTION_RECORD_HASH_MISMATCH", id);
      if (exportBytes && sha256(exportBytes) !== entry.exportSha256)
        add("EXPORT_HASH_MISMATCH", id);

      if (record) {
        if (record.queryId !== id || record.projectRef !== manifest.projectRef ||
            record.projectRef !== policy?.projectRef) add("EXECUTION_MAPPING_MISMATCH", id);
        if (!nonempty(record.executionId) || seenExecutionIds.has(record.executionId))
          add("DUPLICATE_OR_MISSING_EXECUTION_ID", id);
        else seenExecutionIds.add(record.executionId);
        if (!nonempty(record.operator) || !nonempty(record.currentUser) ||
            !nonempty(record.sessionUser)) add("EXECUTION_IDENTITY_MISSING", id);
        if (policy?.approvedIdentity &&
            (record.operator !== policy.approvedIdentity.operator ||
             record.currentUser !== policy.approvedIdentity.currentUser ||
             record.sessionUser !== policy.approvedIdentity.sessionUser))
          add("EXECUTION_IDENTITY_MISMATCH", id);
        const recordDatabaseValid = databaseIdentity(record.databaseName,
          `${id}:record.databaseName`,add);
        const recordVersionValid = databaseIdentity(record.postgresVersion,
          `${id}:record.postgresVersion`,add);
        if (recordDatabaseValid && policyDatabaseValid &&
            record.databaseName !== policy.database_name) add("DATABASE_MISMATCH",`${id}:record`);
        if (recordVersionValid && policyVersionValid &&
            record.postgresVersion !== policy.postgres_version)
          add("POSTGRES_VERSION_MISMATCH",`${id}:record`);
        if (!utcInstant(record.executedAtUtc)) add("UTC_TIME_MISSING_OR_INVALID", id);
        if (record.success !== true) add("QUERY_NOT_SUCCESSFUL", id);
        if (record.exportFile !== entry.exportFile ||
            record.exportSha256 !== entry.exportSha256) add("EXECUTION_EXPORT_MISMATCH", id);
        if (!hex256(record.executedSqlSha256) ||
            typeof record.executedSql !== "string" ||
            sha256(Buffer.from(record.executedSql ?? "","utf8")) !== record.executedSqlSha256)
          add("EXECUTED_SQL_HASH_MISMATCH", id);
        if (approvedBytes && (typeof record.executedSql !== "string" ||
            !approvedBytes.equals(Buffer.from(record.executedSql,"utf8"))))
          add("EXECUTED_SQL_DIFFERS", id);
      }
      if (exportBytes) try {
        const parsed = id === "snapshot" ? parseJsonLines(exportBytes) : parseVersions(exportBytes);
        if (!Number.isSafeInteger(record?.rowCount) || record.rowCount !== parsed.length)
          add("EXPORT_ROW_COUNT_MISMATCH", id);
        if (id === "snapshot") {
          snapshotRows = parsed;
          evidenceFindings.push(...snapshotStructureFindings(parsed,policy?.stage));
        }
        else migrationVersions = parsed;
      } catch (error) { add(error instanceof DuplicateJsonKeyError
        ? "DUPLICATE_JSON_KEY" : "EXPORT_FORMAT_INVALID", id); }
    }
  }
  if (!seenIds.has("snapshot")) add("MISSING_QUERY", "snapshot");

  const registries = snapshotRows?.filter((row) => row?.section === "migration_registry" &&
    row.item === "supabase_migrations.schema_migrations") ?? [];
  const registryExists = registries.length === 1 ? registries[0].data?.exists : undefined;
  if (registryExists !== true && registryExists !== false)
    add("REGISTRY_STATUS_UNVERIFIED", "exactly one boolean registry marker required");
  else if (registryExists && !seenIds.has("migration-history"))
    add("MISSING_QUERY", "migration-history");
  else if (!registryExists && seenIds.has("migration-history"))
    add("UNEXPECTED_QUERY", "migration-history with absent registry");
  if (registryExists === false && (manifest?.stage !== "empty" ||
      manifest?.adminIdentity !== "absent")) add("REGISTRY_STAGE_CONFLICT", "non-empty stage");

  const databaseRows = snapshotRows?.filter((row) => row?.section === "database") ?? [];
  if (databaseRows.length !== 1) add(databaseRows.length === 0
    ? "DATABASE_IDENTITY_MISSING" : "DATABASE_IDENTITY_INVALID",
  "exactly one snapshot database row required");
  else {
    const databaseRow = databaseRows[0];
    const snapshotDatabaseValid = databaseIdentity(databaseRow.data?.name,
      "snapshot.database.name",add);
    const snapshotVersionValid = databaseIdentity(databaseRow.data?.server_version,
      "snapshot.database.server_version",add);
    if (snapshotDatabaseValid && databaseRow.item !== databaseRow.data.name)
      add("DATABASE_MISMATCH","snapshot database row key and name");
    if (snapshotDatabaseValid && policyDatabaseValid &&
        databaseRow.data.name !== policy.database_name)
      add("DATABASE_MISMATCH","snapshot and policy");
    if (snapshotVersionValid && policyVersionValid &&
        databaseRow.data.server_version !== policy.postgres_version)
      add("POSTGRES_VERSION_MISMATCH","snapshot and policy");
  }

  const evidenceDecision = evidenceFindings.length ? "BLOCKED" : "PASS";
  const securityFindings = [blocked("BASELINE_NOT_APPROVED",
    "offline policy has no signed permission baseline")];
  if (evidenceDecision !== "PASS") securityFindings.push(blocked("EVIDENCE_INVALID",
    "security baseline cannot rely on this bundle"));
  let checkerDecision = "NOT_RUN";
  if (snapshotRows && policy && stages.has(policy.stage)) {
    try {
      const checked = checkCatalogPermissionSnapshot(snapshotRows, {
        profile:"catalog-only", stage:policy.stage,
        adminIdentity:policy.adminIdentity, migrationVersions,
      });
      checkerDecision = checked.decision;
      securityFindings.push(...checked.findings.map((finding) =>
        blocked(finding.code, finding.detail)));
    } catch {
      securityFindings.push(blocked("CHECKER_ERROR", "Catalog-only checker rejected input"));
    }
  } else securityFindings.push(blocked("CHECKER_NOT_RUN", "snapshot or stage unavailable"));
  return {
    scope:"OFFLINE_PROTOTYPE_ONLY",
    policyAuthenticity:"UNVERIFIED_OFFLINE_INPUT",
    executionAuthenticity:"UNVERIFIED_OFFLINE_RECORD",
    evidence:{ decision:evidenceDecision, rawExportCompleteness:"UNVERIFIED",
      findings:evidenceFindings },
    security:{ decision:"BLOCKED", checkerDecision, findings:securityFindings },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv.length !== 5) {
    process.stderr.write("Usage: node scripts/catalog-a6-offline-prototype.mjs <bundle-directory> <separate-policy.json> <independently-approved-policy-sha256>\n");
    process.exitCode = 2;
  } else {
    const result = await validateOfflineBundle(process.argv[2],process.argv[3],process.argv[4]);
    process.stdout.write(`${JSON.stringify(result,null,2)}\n`);
    // The prototype deliberately has no route to a production security PASS.
    process.exitCode = 1;
  }
}
