// A6 Scheme B offline integration. It does not authenticate SQL Editor sessions or
// raw export completeness, and cannot produce a formal overall PASS.
import { createHash } from "node:crypto";
import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { readStableBundleFile } from "./catalog-a6-offline-prototype.mjs";
import { parseUniqueJson, validateCatalogA6Evidence } from "./catalog-a6-evidence-validator.mjs";
import { validateCatalogA6Security } from "./catalog-a6-security-validator.mjs";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const hex = (x) => typeof x === "string" && /^[a-f0-9]{64}$/.test(x);
const issue = (code,detail) => ({code,detail});
const outside = (root,file) => {
  const relative = path.relative(root,file);
  return relative === ".." || relative.startsWith(`..${path.sep}`);
};
const readSeparate = async (file) => readStableBundleFile(path.dirname(path.resolve(file)),
  path.basename(file));
const errorResult = (code,detail) => ({
  evidenceStatus:"INTERNAL_CONSISTENCY_BLOCKED",
  sourceAuthenticationStatus:"SOURCE_AUTHENTICATION_UNVERIFIED",
  rawExportCompletenessStatus:"RAW_EXPORT_COMPLETENESS_UNVERIFIED",
  baselineApprovalStatus:"BLOCKED",securityStatus:"BLOCKED",overallStatus:"BLOCKED",
  legacyCheckerStatus:"NOT_INTEGRATED",failureStage:"PIPELINE_SETUP",
  reasonCodes:[code],findings:[issue(code,detail)],
});

function decodeJsonl(bytes) {
  const text = bytes.toString("utf8");
  if (!Buffer.from(text,"utf8").equals(bytes)) throw new Error("invalid JSONL UTF-8");
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  if (!lines.length || lines.some((line) => !line || line.includes("\r")))
    throw new Error("empty or noncanonical JSONL");
  return lines.map((line) => parseUniqueJson(Buffer.from(line,"utf8")));
}

// trustedTarget and approvalTrust are supplied independently of the bundle and policy.
// mode=synthetic can only return SYNTHETIC_MATCH_ONLY; mode=formal remains BLOCKED
// until an independent source-authentication stage exists outside this module.
export async function validateCatalogA6Pipeline({bundleDirectory,policyFile,
  expectedPolicySha256,baselineFile,expectedBaselineSha256,trustedTarget,
  approvalTrust,mode="formal",afterEvidenceValidationForTest}={}) {
  const findings = [], add = (code,detail) => findings.push(issue(code,detail));
  try {
    if (!bundleDirectory || !policyFile || !baselineFile || !hex(expectedPolicySha256) ||
        !hex(expectedBaselineSha256) || !trustedTarget ||
        !["formal","synthetic"].includes(mode))
      return errorResult("PIPELINE_INPUT_INVALID","separate files, hashes and target required");
    if (afterEvidenceValidationForTest !== undefined &&
        (mode !== "synthetic" || typeof afterEvidenceValidationForTest !== "function"))
      return errorResult("PIPELINE_INPUT_INVALID","test hook is synthetic-only");
    if (!["projectRef","databaseName","postgresVersion"].every((k) =>
      typeof trustedTarget[k] === "string" && trustedTarget[k].length > 0))
      return errorResult("TRUSTED_TARGET_MISSING","independent project/database/version required");
    const rootStat = await lstat(bundleDirectory,{bigint:true});
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink())
      return errorResult("BUNDLE_UNAVAILABLE","bundle root must be an ordinary directory");
    const root = await realpath(bundleDirectory);
    const resolvedRootStat = await lstat(root,{bigint:true});
    if (rootStat.dev !== resolvedRootStat.dev || rootStat.ino !== resolvedRootStat.ino)
      return errorResult("BUNDLE_CHANGED","bundle root changed during resolution");
    const [policyReal,baselineReal] = await Promise.all([realpath(policyFile),realpath(baselineFile)]);
    if (!outside(root,policyReal) || !outside(root,baselineReal) || policyReal === baselineReal)
      return errorResult("POLICY_OR_BASELINE_NOT_INDEPENDENT",
        "policy and baseline must be separate files outside evidence bundle");
    const policyBytes = await readSeparate(policyFile);
    if (sha256(policyBytes) !== expectedPolicySha256)
      return errorResult("POLICY_HASH_MISMATCH","independent policy anchor");
    const policy = parseUniqueJson(policyBytes);
    if (policy.projectRef !== trustedTarget.projectRef ||
        policy.databaseName !== trustedTarget.databaseName ||
        policy.postgresVersion !== trustedTarget.postgresVersion)
      return errorResult("PROJECT_OR_DATABASE_MISMATCH","policy / independently trusted target");
    // Pin the manifest version across the B1 call and C1 read. B1 checks the
    // complete file inventory and its own stable reads. Concurrent writers remain
    // forbidden by the controlled-bundle operating contract.
    const manifestBefore = await readStableBundleFile(root,"manifest.json");
    const manifestHash = sha256(manifestBefore);
    const evidence = await validateCatalogA6Evidence(root,policyFile,expectedPolicySha256);
    findings.push(...evidence.findings);
    let security = null;
    if (evidence.internalConsistency === "INTERNAL_CONSISTENCY_PASS") {
      // A synthetic-only hook can change local fixture files between the B1 read
      // and this re-read. It cannot substitute validation results or enable formal use.
      if (afterEvidenceValidationForTest) await afterEvidenceValidationForTest();
      const manifestAfter = await readStableBundleFile(root,"manifest.json");
      if (sha256(manifestAfter) !== manifestHash) add("EVIDENCE_CHANGED","manifest changed after B1");
      const manifest = findings.length ? null : parseUniqueJson(manifestAfter);
      const entry = manifest?.queries?.[0];
      if (!findings.length && (entry?.id !== "snapshot" ||
          typeof entry.jsonlFile !== "string" || !hex(entry.jsonlSha256)))
        add("EVIDENCE_MAPPING_INVALID","snapshot JSONL mapping");
      if (!findings.length) {
        const jsonlBytes = await readStableBundleFile(root,entry.jsonlFile);
        if (sha256(jsonlBytes) !== entry.jsonlSha256)
          add("EVIDENCE_CHANGED","JSONL changed after B1");
        if (!findings.length) {
          const rows = decodeJsonl(jsonlBytes);
          if (rows.length !== entry.rowCount)
            add("EVIDENCE_CHANGED","JSONL row count changed after B1");
          const expectedHashes = [manifestHash,entry.approvedSqlSha256,entry.recordSha256,
            entry.rawExportSha256,entry.jsonlSha256,expectedPolicySha256,expectedBaselineSha256];
          const readPinnedFiles = () => Promise.all([
            readStableBundleFile(root,"manifest.json"),
            readStableBundleFile(root,entry.approvedSqlFile),
            readStableBundleFile(root,entry.recordFile),
            readStableBundleFile(root,entry.rawExportFile),
            readStableBundleFile(root,entry.jsonlFile),
            readSeparate(policyFile),readSeparate(baselineFile),
          ]);
          const pinnedFiles = await readPinnedFiles();
          if (pinnedFiles.some((bytes,index) => sha256(bytes) !== expectedHashes[index]))
            add("EVIDENCE_CHANGED","bundle, policy or baseline changed before comparison");
          if (!findings.length) {
            security = validateCatalogA6Security(rows,pinnedFiles[6],expectedBaselineSha256,{
              ...approvalTrust,mode,expectedProjectRef:trustedTarget.projectRef,
              expectedDatabaseName:trustedTarget.databaseName,
              expectedPostgresVersion:trustedTarget.postgresVersion,
            });
            findings.push(...security.security.findings);
            const finalFiles = await readPinnedFiles();
            if (finalFiles.some((bytes,index) => sha256(bytes) !== expectedHashes[index]))
              add("EVIDENCE_CHANGED","bundle, policy or baseline changed during comparison");
          }
        }
      }
    }
    const evidenceStatus = findings.some((f) => evidence.findings.includes(f) ||
      f.code === "EVIDENCE_CHANGED" || f.code === "EVIDENCE_MAPPING_INVALID") ?
      "INTERNAL_CONSISTENCY_BLOCKED" : evidence.internalConsistency;
    const baselineApprovalStatus = security?.baselineValidation.status ?? "BLOCKED";
    const securityStatus = evidenceStatus === "INTERNAL_CONSISTENCY_PASS" ?
      security?.security.status ?? "BLOCKED" : "BLOCKED";
    // No runtime switch or caller-supplied claim can authenticate a SQL Editor
    // session or complete raw export. Formal overall admission is always blocked.
    const overallStatus = mode === "synthetic" &&
      evidenceStatus === "INTERNAL_CONSISTENCY_PASS" && securityStatus === "SYNTHETIC_PASS" ?
      "SYNTHETIC_MATCH_ONLY" : "BLOCKED";
    const failureStage = evidenceStatus === "INTERNAL_CONSISTENCY_BLOCKED" ?
      findings.some((f) => ["EVIDENCE_CHANGED","EVIDENCE_MAPPING_INVALID"].includes(f.code)) ?
        "EVIDENCE_REREAD" : "EVIDENCE_VALIDATION" :
      securityStatus === "BLOCKED" ? "SECURITY_BASELINE_VALIDATION" :
      overallStatus === "BLOCKED" ? "SOURCE_AND_RAW_EXPORT_AUTHENTICATION" : null;
    const reasonCodes = [...new Set([
      ...findings.map((f) => f.code),
      "SOURCE_AUTHENTICATION_UNVERIFIED","RAW_EXPORT_COMPLETENESS_UNVERIFIED",
      "LEGACY_CHECKER_NOT_INTEGRATED",
      ...(security ? [] : ["SECURITY_NOT_RUN"]),
    ])];
    return {evidenceStatus,
      sourceAuthenticationStatus:"SOURCE_AUTHENTICATION_UNVERIFIED",
      rawExportCompletenessStatus:"RAW_EXPORT_COMPLETENESS_UNVERIFIED",
      baselineApprovalStatus,securityStatus,overallStatus,
      legacyCheckerStatus:"NOT_INTEGRATED",failureStage,reasonCodes,findings};
  } catch (error) {
    return errorResult("PIPELINE_ERROR",error.message);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.stderr.write("This offline module is an API; a trusted orchestrator must supply separate anchors and approval trust.\n");
  process.exitCode = 2;
}
