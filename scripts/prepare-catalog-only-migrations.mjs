import { createHash } from "node:crypto";
import { cp, lstat, mkdir, readFile, realpath, readdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, parse, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repository = fileURLToPath(new URL("../", import.meta.url));
const sourceDirectory = join(repository, "supabase/migrations");
export const MIGRATIONS = Object.freeze({
  foundation: ["20261013120000_create_catalog_foundation.sql"],
  "admin-read": ["20261013120000_create_catalog_foundation.sql",
    "20261020120000_add_catalog_admin_read_runtime.sql"],
  "admin-login": ["20261013120000_create_catalog_foundation.sql",
    "20261018120000_create_admin_identity_foundation.sql",
    "20261020120000_add_catalog_admin_read_runtime.sql"],
});
const REF = /^[a-z0-9]{20}$/;
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function safeDestination(outputDirectory) {
  if (!isAbsolute(outputDirectory ?? "") || resolve(outputDirectory) !== outputDirectory)
    throw new Error("Release workspace requires a canonical absolute path");
  const root = await realpath(repository);
  let current = parse(outputDirectory).root;
  const segments = outputDirectory.slice(current.length).split(sep);
  if (segments.some((part) => !part || part === "." || part === ".."))
    throw new Error("Release workspace path contains an alias");
  for (const part of segments.slice(0,-1)) {
    current = join(current,part);
    const info = await lstat(current);
    if (info.isSymbolicLink() || !info.isDirectory())
      throw new Error("Release workspace ancestor must be a real directory");
  }
  const parent = dirname(outputDirectory);
  if (await realpath(parent) !== parent || parent === root || parent.startsWith(`${root}${sep}`))
    throw new Error("Release workspace must be outside the Git repository");
  const parentInfo = await lstat(parent);
  if (parentInfo.uid !== process.getuid?.() || (parentInfo.mode & 0o022) !== 0)
    throw new Error("Release workspace parent must be owned by this user and not writable by others");
  return outputDirectory;
}

/** Local packaging only. Never links a project, invokes the Supabase CLI or writes migration history. */
export async function prepareCatalogOnlyMigrations({stage, catalogRef, rfqRef, outputDirectory}) {
  if (!Object.hasOwn(MIGRATIONS,stage) || !REF.test(catalogRef ?? "") ||
      !REF.test(rfqRef ?? "") || catalogRef === rfqRef)
    throw new Error("Invalid release stage or refs");
  const destination = await safeDestination(outputDirectory);
  const chosen = MIGRATIONS[stage];
  const available = await readdir(sourceDirectory);
  for (const file of chosen) if (!available.includes(file)) throw new Error(`Missing approved migration: ${file}`);
  // Exclusive leaf creation makes an existing directory or symlink fail atomically.
  await mkdir(destination,{mode:0o700});
  if (await realpath(destination) !== destination)
    throw new Error("Release workspace path changed during creation");
  await mkdir(join(destination,"supabase"),{mode:0o700});
  await mkdir(join(destination,"supabase/migrations"),{mode:0o700});
  const files = [];
  for (const name of chosen) {
    const source = join(sourceDirectory,name);
    const bytes = await readFile(source);
    const staged = join(destination,"supabase/migrations",name);
    await cp(source,staged,{errorOnExist:true,force:false});
    if (sha256(await readFile(staged)) !== sha256(bytes)) throw new Error(`Staged migration changed: ${name}`);
    files.push({name,version:name.slice(0,14),sha256:sha256(bytes)});
  }
  const contents = await readdir(join(destination,"supabase/migrations"));
  if (contents.length !== chosen.length || contents.some((name) => !chosen.includes(name)))
    throw new Error("Release workspace contains an unexpected migration");
  const manifest = {kind:"catalog-only-local-release",stage,catalogRef,rfqRef,
    migrations:files,manualProjectIdentityVerificationRequired:true,
    cloudExecutionApproved:false};
  await writeFile(join(destination,"catalog-release-manifest.json"),`${JSON.stringify(manifest,null,2)}\n`,
    {flag:"wx",mode:0o600});
  return manifest;
}

/** Recheck a prepared directory immediately before any separately approved deployment. */
export async function verifyCatalogOnlyMigrations({outputDirectory,catalogRef,rfqRef}) {
  const destination = await safeDestination(outputDirectory);
  const directory = await lstat(destination);
  if (!directory.isDirectory() || directory.isSymbolicLink() ||
      await realpath(destination) !== destination)
    throw new Error("Invalid release workspace directory");
  for (const name of ["supabase","supabase/migrations"]) {
    const info = await lstat(join(destination,name));
    if (!info.isDirectory() || info.isSymbolicLink())
      throw new Error("Invalid release workspace structure");
  }
  if (!(await lstat(join(destination,"catalog-release-manifest.json"))).isFile())
    throw new Error("Invalid release manifest");
  const manifest = JSON.parse(await readFile(join(destination,"catalog-release-manifest.json"),"utf8"));
  if (manifest.kind !== "catalog-only-local-release" ||
      !Object.hasOwn(MIGRATIONS,manifest.stage) ||
      manifest.catalogRef !== catalogRef || manifest.rfqRef !== rfqRef ||
      catalogRef === rfqRef || manifest.cloudExecutionApproved !== false ||
      manifest.manualProjectIdentityVerificationRequired !== true)
    throw new Error("Release manifest identity mismatch");
  const expected = MIGRATIONS[manifest.stage];
  const actual = await readdir(join(destination,"supabase/migrations"));
  if (actual.length !== expected.length || actual.some((name) => !expected.includes(name)) ||
      !Array.isArray(manifest.migrations) || manifest.migrations.length !== expected.length)
    throw new Error("Unexpected release migration set");
  for (const [index,name] of expected.entries()) {
    const staged = join(destination,"supabase/migrations",name);
    if (!(await lstat(staged)).isFile()) throw new Error(`Invalid staged migration: ${name}`);
    const digest = sha256(await readFile(staged));
    if (manifest.migrations[index]?.name !== name ||
        manifest.migrations[index]?.version !== name.slice(0,14) ||
        manifest.migrations[index]?.sha256 !== digest ||
        sha256(await readFile(join(sourceDirectory,name))) !== digest)
      throw new Error(`Release migration hash mismatch: ${name}`);
  }
  return {stage:manifest.stage,versions:expected.map((name) => name.slice(0,14))};
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const verify = process.argv[2] === "verify";
  if (verify) {
    const [outputDirectory,catalogRef,rfqRef] = process.argv.slice(3);
    if (process.argv.length !== 6) {
      process.stderr.write("Usage: node prepare-catalog-only-migrations.mjs verify <absolute-output-dir> <catalog-ref> <rfq-ref>\n");
      process.exitCode = 2;
    } else {
      try { process.stdout.write(`${JSON.stringify(await verifyCatalogOnlyMigrations({outputDirectory,catalogRef,rfqRef}))}\n`); }
      catch (error) { process.stderr.write(`${error instanceof Error ? error.message : "Verification failed"}\n`); process.exitCode = 1; }
    }
  } else {
  const [stage,catalogRef,rfqRef,outputDirectory] = process.argv.slice(2);
  if (process.argv.length !== 6) {
    process.stderr.write("Usage: node prepare-catalog-only-migrations.mjs <foundation|admin-read|admin-login> <catalog-ref> <rfq-ref> <absolute-output-dir>\n");
    process.exitCode = 2;
  } else {
    try {
      const manifest = await prepareCatalogOnlyMigrations({stage,catalogRef,rfqRef,outputDirectory});
      process.stdout.write(`${JSON.stringify({stage:manifest.stage,versions:manifest.migrations.map((m) => m.version),
        outputDirectory,manualProjectIdentityVerificationRequired:true})}\n`);
    } catch (error) {
      process.stderr.write(`${error instanceof Error ? error.message : "Release preparation failed"}\n`);
      process.exitCode = 1;
    }
  }
  }
}
