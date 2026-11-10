// Local compatibility view only. B1 checks migration-history bytes and structure;
// this module cannot authenticate SQL Editor provenance or grant a formal security PASS.
import { createHash } from "node:crypto";
import path from "node:path";
import { realpath } from "node:fs/promises";
import { readStableBundleFile } from "./catalog-a6-offline-prototype.mjs";
import { parseUniqueJson, SECTIONS, validateCatalogA6Evidence,
  validateCatalogA6MigrationHistory } from "./catalog-a6-evidence-validator.mjs";
import { checkCatalogPermissionSnapshot } from "./check-catalog-supabase-snapshot.mjs";

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const issue = (code, detail) => ({code, detail});
const oid = (value) => typeof value === "string" && /^\d+$/.test(value);
const name = (value) => typeof value === "string" && value.length > 0 && value.trim() === value;
const hash = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const aclSections = new Set(["database_acl","database_builtin_acl","schema_acl",
  "schema_builtin_acl","relation_acl","default_acl","default_acl_builtin","function_acl"]);
const blocked = (code, detail, extra={}) => ({status:"BLOCKED",legacyCheckerStatus:"NOT_INTEGRATED",
  findings:[issue(code,detail)],...extra});

// This exported mapper is deliberately untrusted. Its result never represents verified evidence.
// The original row item/key are retained alongside the A1 data, so the view is reversible.
export function mapCatalogA6LegacyRows(rows) {
  const fail = (code,detail) => blocked(code,detail);
  if (!Array.isArray(rows)) return fail("SNAPSHOT_INVALID","rows must be an array");
  const sections = new Set(SECTIONS), seen = new Set(), roles = new Map(), roleOids = new Map();
  for (const row of rows) {
    if (!row || typeof row !== "object" || !name(row.section) || !name(row.item) ||
        row.row_key !== `${row.section}:${row.item}` || !row.data ||
        typeof row.data !== "object" || Array.isArray(row.data))
      return fail("SNAPSHOT_INVALID","row shape or key");
    if (!sections.has(row.section)) return fail("UNKNOWN_SECTION",row.section);
    if (seen.has(row.row_key)) return fail("DUPLICATE_IDENTIFIER",row.row_key);
    seen.add(row.row_key);
    if (aclSections.has(row.section) &&
        (!name(row.data.grantee) || !oid(row.data.grantee_oid) ||
         !name(row.data.grantor) || !oid(row.data.grantor_oid) ||
         !name(row.data.privilege) || typeof row.data.grantable !== "boolean" ||
         !name(row.data.acl_source)))
      return fail("ACL_FIELD_MISSING",row.row_key);
    if (row.section === "role") {
      const {role_name,role_oid} = row.data;
      if (row.item !== role_name || !oid(role_oid) || roles.has(role_name) || roleOids.has(role_oid))
        return fail("ROLE_IDENTITY_CONFLICT",row.row_key);
      roles.set(role_name,role_oid); roleOids.set(role_oid,role_name);
    }
  }
  const mapped = [], logical = new Set();
  for (const row of rows) {
    const copy = structuredClone(row);
    if (row.section === "membership") {
      const d = row.data;
      if (!oid(row.item) || d.membership_oid !== row.item ||
          !["member","parent","grantor"].every((key) =>
            name(d[key]) && oid(d[`${key}_oid`]) && d[`${key}_name_resolved`] === true &&
            roles.get(d[key]) === d[`${key}_oid`] && roleOids.get(d[`${key}_oid`]) === d[key]) ||
          !["admin_option","inherit_option","set_option"].every((key) =>
            typeof d[key] === "boolean")) return fail("MEMBERSHIP_IDENTITY_INVALID",row.row_key);
      const item = `${d.member}->${d.parent}`;
      if (logical.has(item) || seen.has(`membership:${item}`))
        return fail("MEMBERSHIP_MAPPING_CONFLICT",item);
      logical.add(item);
      copy.item = item;
      copy.row_key = `membership:${item}`;
      copy.source_item = row.item;
      copy.source_row_key = row.row_key;
    }
    mapped.push(copy);
  }
  return {status:"MAPPED_UNTRUSTED",legacyCheckerStatus:"NOT_INTEGRATED",rows:mapped,
    mappingVersion:"catalog-a6-legacy-view-v1",sourceRowCount:rows.length};
}

function decodeJsonl(bytes) {
  const content = bytes.toString("utf8");
  if (!Buffer.from(content,"utf8").equals(bytes)) throw new Error("invalid UTF-8");
  const lines = content.split("\n");
  if (lines.at(-1) === "") lines.pop();
  if (!lines.length || lines.some((line) => !line || line.includes("\r")))
    throw new Error("noncanonical JSONL");
  return lines.map((line) => parseUniqueJson(Buffer.from(line,"utf8")));
}

// B1 is run here, rather than accepting a caller-supplied PASS flag or version list.
// A local match remains internal/synthetic evidence, never source authentication.
export async function validateCatalogA6LegacyAdapter({bundleDirectory,policyFile,
  expectedPolicySha256,historyBundleDirectory,historyPolicyFile,
  expectedHistoryPolicySha256,stage,adminIdentity,mode="formal",
  syntheticMigrationVersions,migrationVersions}={}) {
  if (!["empty","foundation","admin-read"].includes(stage) ||
      !["absent","present"].includes(adminIdentity) ||
      (stage === "empty" && adminIdentity !== "absent"))
    return blocked("STAGE_INVALID","explicit stage and admin identity required");
  if (mode !== "formal" && mode !== "synthetic") return blocked("MODE_INVALID",mode);
  if (syntheticMigrationVersions !== undefined || migrationVersions !== undefined)
    return blocked("CALLER_HISTORY_FORBIDDEN","version list must come from B1 history evidence");
  if (!name(bundleDirectory) || !name(policyFile) || !hash(expectedPolicySha256))
    return blocked("EVIDENCE_ANCHOR_MISSING","bundle and independent policy hash required");
  if (!name(historyBundleDirectory) || !name(historyPolicyFile) ||
      !hash(expectedHistoryPolicySha256))
    return blocked("HISTORY_ANCHOR_MISSING","separate history bundle and policy hash required");
  try {
    const root = await realpath(bundleDirectory);
    const manifestBefore = await readStableBundleFile(root,"manifest.json");
    const manifestHash = sha(manifestBefore);
    const evidence = await validateCatalogA6Evidence(bundleDirectory,policyFile,expectedPolicySha256);
    if (evidence.internalConsistency !== "INTERNAL_CONSISTENCY_PASS")
      return {status:"BLOCKED",legacyCheckerStatus:"NOT_INTEGRATED",
        findings:[issue("EVIDENCE_BLOCKED","B1 rejected the snapshot"),...evidence.findings]};
    const manifestAfter = await readStableBundleFile(root,"manifest.json");
    if (sha(manifestAfter) !== manifestHash) return blocked("EVIDENCE_CHANGED","manifest after B1");
    const manifest = parseUniqueJson(manifestAfter);
    const entry = manifest?.queries?.[0];
    if (manifest?.queries?.length !== 1 || entry?.id !== "snapshot" ||
        !name(entry.jsonlFile) || !hash(entry.jsonlSha256) ||
        !name(entry.approvedSqlFile) || !hash(entry.approvedSqlSha256) ||
        !name(entry.recordFile) || !hash(entry.recordSha256) ||
        !name(entry.rawExportFile) || !hash(entry.rawExportSha256) ||
        !Number.isSafeInteger(entry.rowCount))
      return blocked("EVIDENCE_MAPPING_INVALID","snapshot manifest entry");
    const pinned = [[entry.approvedSqlFile,entry.approvedSqlSha256],
      [entry.recordFile,entry.recordSha256],[entry.rawExportFile,entry.rawExportSha256],
      [entry.jsonlFile,entry.jsonlSha256]];
    const checkPinned = async () => {
      if (sha(await readStableBundleFile(root,"manifest.json")) !== manifestHash) return false;
      for (const [file,digest] of pinned)
        if (sha(await readStableBundleFile(root,file)) !== digest) return false;
      if (sha(await readStableBundleFile(path.dirname(path.resolve(policyFile)),
        path.basename(policyFile))) !== expectedPolicySha256) return false;
      return true;
    };
    if (!await checkPinned()) return blocked("EVIDENCE_CHANGED","bundle changed after B1");
    const bytes = await readStableBundleFile(root,entry.jsonlFile);
    if (sha(bytes) !== entry.jsonlSha256) return blocked("EVIDENCE_CHANGED","JSONL after B1");
    const rows = decodeJsonl(bytes);
    if (rows.length !== entry.rowCount) return blocked("EVIDENCE_CHANGED","row count after B1");
    const view = mapCatalogA6LegacyRows(rows);
    if (view.status !== "MAPPED_UNTRUSTED") return view;
    const history=await validateCatalogA6MigrationHistory({
      snapshotBundleDirectory:bundleDirectory,snapshotPolicyFile:policyFile,
      expectedSnapshotPolicySha256:expectedPolicySha256,
      historyBundleDirectory,historyPolicyFile,expectedHistoryPolicySha256,
      stage,adminIdentity});
    if (history.internalConsistency !== "INTERNAL_CONSISTENCY_PASS")
      return {status:"BLOCKED",legacyCheckerStatus:"NOT_INTEGRATED",
        findings:[issue("HISTORY_EVIDENCE_BLOCKED","B1 rejected migration history"),
          ...history.findings]};
    const binding=history.binding;
    if (!binding || binding.snapshotManifestSha256 !== manifestHash ||
        binding.snapshotJsonlSha256 !== entry.jsonlSha256 ||
        binding.historyPolicySha256 !== expectedHistoryPolicySha256 ||
        binding.stage !== stage || binding.adminIdentity !== adminIdentity ||
        !hash(binding.historyManifestSha256) || !hash(binding.historyRawSha256) ||
        !hash(binding.historyJsonlSha256) ||
        !Array.isArray(history.migrationVersions) ||
        history.migrationVersions.some((v) => typeof v !== "string" || !/^\d{14}$/.test(v)) ||
        new Set(history.migrationVersions).size !== history.migrationVersions.length)
      return blocked("HISTORY_BINDING_INVALID","B1 result differs from pinned snapshot or stage");
    const historyRoot=await realpath(historyBundleDirectory);
    const historyManifestBytes=await readStableBundleFile(historyRoot,"manifest.json");
    if (sha(historyManifestBytes) !== binding.historyManifestSha256)
      return blocked("HISTORY_CHANGED","history manifest changed after B1");
    const historyEntry=parseUniqueJson(historyManifestBytes)?.queries?.[0];
    if (!historyEntry || !name(historyEntry.approvedSqlFile) ||
        !name(historyEntry.recordFile) || !name(historyEntry.rawExportFile) ||
        !name(historyEntry.jsonlFile))
      return blocked("HISTORY_MAPPING_INVALID","history file map");
    const historyPinned=[[historyEntry.approvedSqlFile,historyEntry.approvedSqlSha256],
      [historyEntry.recordFile,historyEntry.recordSha256],
      [historyEntry.rawExportFile,binding.historyRawSha256],
      [historyEntry.jsonlFile,binding.historyJsonlSha256]];
    const checkHistoryPinned=async () => {
      if (sha(await readStableBundleFile(historyRoot,"manifest.json")) !==
          binding.historyManifestSha256) return false;
      for (const [file,digest] of historyPinned)
        if (!hash(digest) || sha(await readStableBundleFile(historyRoot,file)) !== digest)
          return false;
      return sha(await readStableBundleFile(path.dirname(path.resolve(historyPolicyFile)),
        path.basename(historyPolicyFile))) === expectedHistoryPolicySha256;
    };
    if (!await checkPinned() || !await checkHistoryPinned())
      return blocked("EVIDENCE_CHANGED","snapshot or history changed before legacy check");
    const legacy = checkCatalogPermissionSnapshot(view.rows,{profile:"catalog-only",stage,
      adminIdentity,migrationVersions:history.migrationVersions});
    if (!await checkPinned() || !await checkHistoryPinned())
      return blocked("EVIDENCE_CHANGED","snapshot or history changed during legacy check");
    if (legacy.decision !== "PASS") return {status:"BLOCKED",
      legacyCheckerStatus:"LEGACY_BLOCKED",findings:legacy.findings,
      snapshotSha256:entry.jsonlSha256,historyBinding:binding,
      mappingVersion:view.mappingVersion};
    return {status:mode === "synthetic" ? "SYNTHETIC_MATCH_ONLY" : "BLOCKED",
      legacyCheckerStatus:mode === "synthetic" ? "SYNTHETIC_PASS" : "INTERNAL_MATCH_ONLY",
      sourceAuthentication:"SOURCE_AUTHENTICATION_UNVERIFIED",
      rawExportCompleteness:"RAW_EXPORT_COMPLETENESS_UNVERIFIED",
      findings:[],snapshotSha256:entry.jsonlSha256,historyBinding:binding,
      mappingVersion:view.mappingVersion};
  } catch (error) { return blocked("ADAPTER_ERROR",error.message); }
}
