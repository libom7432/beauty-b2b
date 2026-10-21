import { readFile } from "node:fs/promises";

const privateTables = ["products", "product_variants", "categories", "product_categories",
  "product_images", "product_translations"];
const foundationFunctions = ["normalized_variant_attributes(jsonb)", "product_row_guard()",
  "variant_row_guard()", "category_guard()", "touch_updated_at()",
  "check_product_publication(uuid)", "enforce_product_publication()"];
const receiptFunctions = ["lookup_catalog_import_receipt(text,text)",
  "purge_due_catalog_receipt_results(integer)"];
const publicColumns = {
  products: ["id","product_code","slug","product_type","attributes","customization_options",
    "oem","odm","lead_time_min_days","lead_time_max_days","seo_indexable","featured",
    "new_arrival","published_at"],
  product_variants: ["id","product_id","sku","attributes","moq_quantity","moq_unit",
    "order_multiple","package_quantity","package_unit","reference_price","reference_currency","sort_order"],
  categories: ["id","parent_id","slug","name_en","name_zh","description_en",
    "description_zh","sort_order"],
  product_categories: ["product_id","category_id","is_primary","sort_order"],
  product_images: ["id","product_id","variant_id","public_url","role","sort_order",
    "width","height","format","alt_en","alt_zh"],
  product_translations: ["product_id","locale","name","short_description","description",
    "seo_title","seo_description"],
};
const expectedPolicies = (table, stage) => [
  `catalog_admin_all_${table === "product_variants" ? "variants" :
    table === "product_images" ? "images" :
    table === "product_translations" ? "translations" : table}`,
  `catalog_import_all_${table === "product_variants" ? "variants" :
    table === "product_images" ? "images" :
    table === "product_translations" ? "translations" : table}`,
  `catalog_reader_${table === "product_variants" ? "variants" :
    table === "product_images" ? "images" :
    table === "product_translations" ? "translations" : table}`,
  ...(stage === "post" ? [`catalog_admin_reader_${table === "product_variants" ? "variants" :
    table === "product_images" ? "images" :
    table === "product_translations" ? "translations" : table}`] : []),
];
const requiredVersions = ["20261010112952", "20261011120000", "20261013120000", "20261018120000"];
const readerMigrationVersion = "20261020120000";
const foundationVersion = "20261013120000";
const adminIdentityVersion = "20261018120000";
const rfqVersions = ["20261010112952", "20261011120000"];
const businessSchemas = ["catalog_private","catalog_public","rfq_private","admin_private"];
const businessRole = /^(catalog_|rfq_|admin_)/;
const platformRoles = new Set(["anon","authenticated","service_role","postgres",
  "authenticator","dashboard_user","pgbouncer","supabase_admin",
  "supabase_auth_admin","supabase_storage_admin","supabase_realtime_admin",
  "supabase_replication_admin","supabase_read_only_user","supabase_functions_admin"]);
const platformRole = (name) => platformRoles.has(name) || name.startsWith("pg_");

function checkCatalogOnlySnapshot(rows, { stage, migrationVersions, adminIdentity }) {
  const findings = [];
  const block = (code, detail) => findings.push({ severity:"BLOCK", code, detail });
  const by = (section, item) => rows.find((r) => r.section === section && r.item === item)?.data;
  const section = (name) => rows.filter((r) => r.section === name);
  if (!["empty","foundation","admin-read"].includes(stage) ||
      !["absent","present"].includes(adminIdentity) ||
      (stage === "empty" && adminIdentity !== "absent"))
    throw new Error("Catalog-only requires an explicit stage and adminIdentity=absent|present");
  if (section("database").length !== 1 || section("migration_registry").length !== 1 ||
      !by("role","anon") ||
      !by("schema","catalog_private") || !by("schema","catalog_public") ||
      !by("schema","rfq_private") || !by("schema","admin_private") ||
      by("schema","public")?.exists !== true ||
      !Array.isArray(rows) || by("business_inventory","catalog-rfq-admin-prefixes")?.complete !== true)
    block("SNAPSHOT_INCOMPLETE","database, schema, migration or business inventory metadata");
  const permissionInventory = by("permission_inventory","database-acl-and-membership");
  if (section("permission_inventory").length !== 1 || permissionInventory?.complete !== true ||
      !Number.isSafeInteger(permissionInventory.membership_count) ||
      !Number.isSafeInteger(permissionInventory.database_acl_count) ||
      !Number.isSafeInteger(permissionInventory.public_schema_acl_count) ||
      permissionInventory.membership_count < 0 || permissionInventory.database_acl_count < 1 ||
      permissionInventory.public_schema_acl_count < 1 ||
      section("membership").length !== permissionInventory.membership_count ||
      section("database_acl").length !== permissionInventory.database_acl_count ||
      section("schema_acl").filter((row) => row.data?.schema === "public").length !==
        permissionInventory.public_schema_acl_count)
    block("SNAPSHOT_INCOMPLETE","database ACL or role membership inventory");
  if (!Array.isArray(migrationVersions) ||
      migrationVersions.some((version) => typeof version !== "string" || !/^\d{14}$/.test(version)) ||
      new Set(migrationVersions).size !== migrationVersions.length)
    block("MIGRATION_HISTORY_INVALID","unique 14-digit version list required");
  else {
    const allowed = stage === "empty" ? [] : [foundationVersion,
      ...(adminIdentity === "present" ? [adminIdentityVersion] : []),
      ...(stage === "admin-read" ? [readerMigrationVersion] : [])];
    for (const version of allowed) if (!migrationVersions.includes(version)) block("MISSING_MIGRATION",version);
    for (const version of migrationVersions) if (!allowed.includes(version))
      block(rfqVersions.includes(version) ? "RFQ_MIGRATION_PRESENT" : "UNEXPECTED_MIGRATION",version);
  }
  const registry = by("migration_registry","supabase_migrations.schema_migrations");
  if (stage !== "empty" && registry?.exists !== true) block("MISSING_MIGRATION_REGISTRY","schema_migrations");
  if (stage === "empty" && registry?.exists !== true && registry?.exists !== false)
    block("SNAPSHOT_INCOMPLETE","migration registry existence");
  for (const schema of businessSchemas) {
    const data = by("schema",schema);
    const expected = schema === "rfq_private" ? false :
      schema === "admin_private" ? adminIdentity === "present" : stage !== "empty";
    if (data?.exists !== expected) block(expected ? "MISSING_SCHEMA" : "UNEXPECTED_SCHEMA",schema);
  }
  const expectedObjects = new Set();
  if (stage !== "empty") {
    for (const table of privateTables) {
      expectedObjects.add(`relation:catalog_private.${table}`);
      expectedObjects.add(`relation:catalog_public.${table}`);
    }
    for (const signature of foundationFunctions) expectedObjects.add(`function:catalog_private.${signature}`);
  }
  if (adminIdentity === "present") expectedObjects.add("relation:admin_private.admin_users");
  // The inventory is produced by the read-only snapshot SQL from pg_namespace/pg_class/pg_proc.
  for (const object of section("business_object")) {
    if (object.data?.kind === "schema") {
      const schemaName = object.item.slice("schema:".length);
      if (!businessSchemas.includes(schemaName)) block("UNKNOWN_BUSINESS_SCHEMA",schemaName);
      continue;
    }
    if (!expectedObjects.has(object.item)) block("UNKNOWN_BUSINESS_OBJECT",object.item);
  }
  for (const object of expectedObjects) {
    if (!section("business_object").some((row) => row.item === object))
      block("MISSING_BUSINESS_OBJECT",object);
  }
  const allowedRoles = new Set(stage === "empty" ? [] : ["catalog_admin","catalog_import",
    "catalog_public_reader",...(stage === "admin-read" ? ["catalog_admin_reader_runtime"] : [])]);
  if (adminIdentity === "present") {
    allowedRoles.add("admin_directory_reader"); allowedRoles.add("admin_directory_provisioner");
  }
  for (const row of section("role")) if (!allowedRoles.has(row.item) &&
      (businessRole.test(row.item) || !platformRole(row.item)))
    block("UNKNOWN_BUSINESS_ROLE",row.item);
  for (const role of allowedRoles) if (!by("role",role)) block("MISSING_ROLE",role);
  // No Supabase platform membership has been verified for this separate project.
  // Block every edge until a target-specific baseline is reviewed and encoded.
  for (const row of section("membership"))
    block("UNREVIEWED_ROLE_MEMBERSHIP",row.item);
  for (const row of section("database_acl")) {
    const {grantee,privilege} = row.data ?? {};
    if (grantee === "PUBLIC" && ["CREATE","TEMPORARY","TEMP"].includes(privilege))
      block("PUBLIC_DATABASE_CREATE_OR_TEMP",row.item);
    if (["anon","authenticated",...allowedRoles].includes(grantee) &&
        ["CREATE","TEMPORARY","TEMP"].includes(privilege))
      block("UNEXPECTED_DATABASE_GRANT",row.item);
    if (grantee !== "PUBLIC" && grantee !== by("database",section("database")[0]?.item)?.owner &&
        !platformRole(grantee) && !allowedRoles.has(grantee))
      block("UNKNOWN_DATABASE_GRANTEE",row.item);
  }
  for (const roleName of ["anon","authenticated",...allowedRoles]) {
    const access = by("effective_database",roleName);
    if (!access) block("SNAPSHOT_INCOMPLETE",`effective database: ${roleName}`);
    else if (access.create !== false || access.temp !== false)
      block("UNEXPECTED_DATABASE_PRIVILEGES",roleName);
  }
  for (const roleName of ["anon","authenticated"]) {
    const access = by("effective_schema",`${roleName}:public`);
    if (!access) block("SNAPSHOT_INCOMPLETE",`effective public schema: ${roleName}`);
    else if (access.create !== false) block("UNEXPECTED_PUBLIC_SCHEMA_CREATE",roleName);
  }
  for (const acl of section("schema_acl")) if (acl.data?.schema === "public" &&
    ["PUBLIC","anon","authenticated"].includes(acl.data?.grantee) &&
    acl.data?.privilege === "CREATE") block("UNEXPECTED_PUBLIC_SCHEMA_CREATE",acl.item);
  if (stage === "empty") {
    for (const row of section("policy")) if (businessSchemas.some((s) => row.item.startsWith(`${s}.`)))
      block("UNEXPECTED_POLICY",row.item);
    return {decision:findings.length ? "BLOCKED" : "PASS",findings};
  }
  const permittedSchemaGrantees = {
    catalog_private:new Set(["catalog_admin","catalog_import","catalog_public_reader",
      ...(stage === "admin-read" ? ["catalog_admin_reader_runtime"] : [])]),
    catalog_public:new Set(["anon","catalog_admin","catalog_import"]),
    admin_private:new Set(["admin_directory_reader","admin_directory_provisioner"]),
  };
  for (const schemaName of ["catalog_private","catalog_public",
    ...(adminIdentity === "present" ? ["admin_private"] : [])]) {
    const acls = section("schema_acl").filter((r) => r.data?.schema === schemaName);
    if (!acls.length) block("SNAPSHOT_INCOMPLETE",`schema ACL: ${schemaName}`);
    const owner = by("schema",schemaName)?.owner;
    for (const acl of acls) if (acl.data.grantee !== owner &&
      (!permittedSchemaGrantees[schemaName].has(acl.data.grantee) ||
        acl.data.privilege !== "USAGE"))
      block("UNKNOWN_SCHEMA_ACL",acl.item);
  }
  for (const relationName of [...privateTables.map((name) => `catalog_private.${name}`),
    ...privateTables.map((name) => `catalog_public.${name}`),
    ...(adminIdentity === "present" ? ["admin_private.admin_users"] : [])]) {
    const acls = section("relation_acl").filter((r) => r.data?.relation === relationName);
    if (!acls.length) block("SNAPSHOT_INCOMPLETE",`relation ACL: ${relationName}`);
    const owner = by("relation",relationName)?.owner;
    const permitted = relationName.startsWith("catalog_private.")
      ? new Set(["catalog_admin","catalog_import","catalog_public_reader",
        ...(stage === "admin-read" ? ["catalog_admin_reader_runtime"] : [])])
      : relationName.startsWith("catalog_public.") ? new Set(["anon"])
        : new Set(["admin_directory_reader","admin_directory_provisioner"]);
    for (const acl of acls) {
      if (acl.data.grantee === owner) continue;
      const granted = acl.data.privilege;
      const role = acl.data.grantee;
      const operations = relationName.startsWith("catalog_public.") ? ["SELECT"]
        : role === "catalog_admin" ? ["SELECT","INSERT","UPDATE","DELETE"]
        : role === "catalog_import" ? ["SELECT","INSERT","UPDATE"]
        : role === "admin_directory_provisioner" ? ["SELECT","INSERT","UPDATE"]
        : ["SELECT"];
      if (!permitted.has(role) || !operations.includes(granted))
        block("UNKNOWN_RELATION_ACL",acl.item);
    }
  }
  for (const table of privateTables) {
    for (const name of [`catalog_private.${table}`,`catalog_public.${table}`])
      if (!by("effective_relation",`anon:${name}`))
        block("SNAPSHOT_INCOMPLETE",`anon effective relation: ${name}`);
  }
  for (const schemaName of ["catalog_private","catalog_public"]) {
    const access = by("effective_schema",`anon:${schemaName}`);
    if (!access) block("SNAPSHOT_INCOMPLETE",`anon effective schema: ${schemaName}`);
    else if (access.usage !== (schemaName === "catalog_public") || access.create !== false)
      block("ANON_SCHEMA_PRIVILEGES",schemaName);
  }
  // Retain all Catalog structure/ACL checks from the mixed-project checker; only its
  // RFQ/Admin schema and migration-version expectations are profile-specific.
  const shared = checkSnapshotCore(rows, {
    stage: stage === "admin-read" ? "post" : "pre",
    migrationVersions,
    profile: "catalog-shared",
  });
  findings.push(...shared.findings);
  if (adminIdentity === "present") {
    const table = by("relation","admin_private.admin_users");
    if (!table?.exists || table.actual_kind !== "r" || !table.rls_enabled || !table.rls_forced ||
        JSON.stringify(table.columns) !== JSON.stringify(["id","auth_user_id","status","role",
          "created_at","updated_at","disabled_at"]))
      block("ADMIN_IDENTITY_STRUCTURE","admin_private.admin_users");
    const expectedAdminPolicies = {
      admin_directory_reader_select:"admin_directory_reader",
      admin_directory_provisioner_all:"admin_directory_provisioner",
    };
    for (const [name,role] of Object.entries(expectedAdminPolicies)) {
      const policy = by("policy",`admin_private.admin_users.${name}`);
      if (!policy || !policy.roles?.includes(role) || policy.using_true !== true ||
          policy.command !== (name.endsWith("_all") ? "*" : "r") ||
          (name.endsWith("_all") && policy.check_true !== true))
        block("ADMIN_POLICY_MISMATCH",name);
    }
    for (const policy of section("policy").filter((r) => r.item.startsWith("admin_private.admin_users.")))
      if (!Object.hasOwn(expectedAdminPolicies,policy.item.split(".").at(-1)))
        block("UNKNOWN_ADMIN_POLICY",policy.item);
    for (const roleName of ["admin_directory_reader","admin_directory_provisioner"]) {
      const role = by("role",roleName);
      if (role && (role.login || role.inherit || role.superuser || role.bypass_rls))
        block("ADMIN_ROLE_FLAGS",roleName);
    }
  } else if (by("relation","admin_private.admin_users")?.exists)
    block("UNEXPECTED_ADMIN_IDENTITY","admin_private.admin_users");
  return {decision:findings.length ? "BLOCKED" : "PASS",findings};
}

/** Pure comparison: consumes only metadata rows, never a database connection. */
function checkSnapshotCore(rows, { stage, migrationVersions, profile }) {
  if (!["pre", "post"].includes(stage)) throw new Error("stage must be pre or post");
  const findings = [];
  const block = (code, detail) => findings.push({ severity: "BLOCK", code, detail });
  const by = (section, item) => rows.find((r) => r.section === section && r.item === item)?.data;
  const inSection = (section) => rows.filter((r) => r.section === section);
  if (inSection("database").length !== 1 || inSection("migration_registry").length !== 1)
    block("SNAPSHOT_INCOMPLETE","database or migration registry metadata");
  for (const roleName of ["catalog_admin","catalog_import","catalog_public_reader","anon"]) {
    if (!by("role",roleName) || !by("effective_database",roleName))
      block("SNAPSHOT_INCOMPLETE",`role metadata: ${roleName}`);
  }
  for (const roleName of ["catalog_admin","catalog_import","catalog_public_reader"]) {
    const role = by("role",roleName);
    if (role && (role.login || role.inherit || role.superuser || role.bypass_rls))
      block("FOUNDATION_ROLE_FLAGS",roleName);
  }
  for (const schema of (profile === "catalog-shared" ? ["catalog_private","catalog_public"] : businessSchemas)) {
    if (by("schema",schema)?.exists !== true) block("MISSING_SCHEMA",schema);
  }
  const foundationOwner = by("relation","catalog_private.products")?.owner;
  for (const table of privateTables) {
    const privateName = `catalog_private.${table}`;
    const relation = by("relation",privateName);
    if (!relation?.exists || relation.actual_kind !== "r") block("MISSING_PRIVATE_TABLE",privateName);
    else {
      if (!relation.rls_enabled) block("RLS_DISABLED",privateName);
      if (relation.owner === "catalog_admin_reader_runtime") block("READER_OWNS_OBJECT",privateName);
      if (foundationOwner && relation.owner !== foundationOwner) block("PRIVATE_TABLE_OWNER_MISMATCH",privateName);
    }
    if (by("effective_relation",`anon:${privateName}`)?.select)
      block("ANON_PRIVATE_SELECT",privateName);
    const publicName = `catalog_public.${table}`;
    const view = by("relation",publicName);
    if (!view?.exists || view.actual_kind !== "v") block("MISSING_PUBLIC_VIEW",publicName);
    else {
      if (view.owner !== "catalog_public_reader") block("PUBLIC_VIEW_OWNER",publicName);
      if (!view.options?.includes("security_barrier=true")) block("PUBLIC_VIEW_BARRIER",publicName);
      if (JSON.stringify(view.columns) !== JSON.stringify(publicColumns[table]))
        block("PUBLIC_VIEW_COLUMNS",publicName);
      if (view.columns?.includes("storage_key")) block("PRIVATE_COLUMN_IN_VIEW",publicName);
      if (!view.view_mentions_published || view.view_mentions_storage_key)
        block("PUBLIC_VIEW_FILTER",publicName);
    }
    if (view?.exists && !by("effective_relation",`anon:${publicName}`)?.select)
      block("ANON_PUBLIC_VIEW_SELECT_MISSING",publicName);
    const prefix = `${privateName}.`;
    const actual = inSection("policy").filter((r) => r.item.startsWith(prefix));
    const expected = expectedPolicies(table,stage);
    for (const name of expected) {
      const policy = by("policy",`${prefix}${name}`);
      if (!policy) block("MISSING_POLICY",`${prefix}${name}`);
      else if (name.startsWith("catalog_admin_reader_") &&
        (policy.command !== "r" || !policy.roles?.includes("catalog_admin_reader_runtime") ||
          policy.using_true !== true)) block("READER_POLICY_MISMATCH",`${prefix}${name}`);
      else if (name.startsWith("catalog_reader_") &&
        (policy.command !== "r" || !policy.roles?.includes("catalog_public_reader") ||
          policy.using_true === true || !policy.using_mentions_published))
        block("PUBLIC_POLICY_MISMATCH",`${prefix}${name}`);
      else if ((name.startsWith("catalog_admin_all_") || name.startsWith("catalog_import_all_")) &&
        (policy.using_true !== true || policy.check_true !== true ||
          !policy.roles?.includes(name.startsWith("catalog_admin_all_") ? "catalog_admin" : "catalog_import")))
        block("WRITER_POLICY_MISMATCH",`${prefix}${name}`);
    }
    for (const row of actual) {
      const name = row.item.slice(prefix.length);
      // Local-only fixture policies are intentionally treated as differences.
      if (!expected.includes(name)) block("UNKNOWN_POLICY",row.item);
    }
  }
  const knownFunctions = new Set([...foundationFunctions,...receiptFunctions]
    .map((signature) => `catalog_private.${signature}`));
  const functions = inSection("function");
  const canonical = (row) => {
    const signature = row.data?.canonical_signature ?? "";
    return signature.startsWith("catalog_private.") ? signature : `catalog_private.${signature}`;
  };
  for (const signature of foundationFunctions) {
    const functionRow = functions.find((r) => canonical(r) === `catalog_private.${signature}`);
    if (!functionRow)
      block("MISSING_FOUNDATION_FUNCTION",signature);
    else {
      if (!inSection("function_acl").some((r) => r.data.signature === functionRow.item))
        block("SNAPSHOT_INCOMPLETE",`function ACL: ${signature}`);
      for (const roleName of ["catalog_admin","catalog_import","catalog_public_reader",
        ...(stage === "post" ? ["catalog_admin_reader_runtime"] : [])]) {
        if (!by("function_effective",`${functionRow.item}:${roleName}`))
          block("SNAPSHOT_INCOMPLETE",`function effective: ${signature}:${roleName}`);
      }
    }
  }
  for (const fn of functions) {
    const signature = canonical(fn);
    if (!knownFunctions.has(signature)) block("UNKNOWN_PRIVATE_FUNCTION",signature);
    if (foundationFunctions.some((name) => signature === `catalog_private.${name}`) &&
      foundationOwner && fn.data.owner !== foundationOwner)
      block("FOUNDATION_FUNCTION_OWNER_MISMATCH",signature);
    if (signature.includes("lookup_catalog_import_receipt") ||
        signature.includes("purge_due_catalog_receipt_results")) {
      const lookup = signature.includes("lookup_catalog_import_receipt");
      const owner = lookup ? "catalog_receipt_lookup_owner" : "catalog_receipt_lifecycle_owner";
      if (fn.data.owner !== owner || fn.data.security_definer !== true ||
          !fn.data.search_path?.includes("search_path=pg_catalog, pg_temp"))
        block("RECEIPT_FUNCTION_IDENTITY",signature);
      const roleChecks = lookup
        ? { catalog_import:true, catalog_admin:false, catalog_admin_reader_runtime:false }
        : { catalog_receipt_maintenance:true, catalog_import:false,
          catalog_admin:false, catalog_admin_reader_runtime:false };
      for (const [role, expected] of Object.entries(roleChecks)) {
        const effective = by("function_effective",`${fn.item}:${role}`);
        if (role === "catalog_admin_reader_runtime" && stage === "pre") continue;
        if (effective?.execute !== expected) block("RECEIPT_EXECUTE",`${signature}:${role}`);
      }
    }
  }
  for (const acl of inSection("function_acl")) {
    const functionRow = functions.find((f) => f.item === acl.data.signature);
    const signature = functionRow ? canonical(functionRow) : acl.data.signature;
    const grantee = acl.data.grantee;
    const allowed = signature.includes("lookup_catalog_import_receipt")
      ? ["catalog_receipt_lookup_owner","catalog_import"]
      : signature.includes("purge_due_catalog_receipt_results")
        ? ["catalog_receipt_lifecycle_owner","catalog_receipt_maintenance"]
        : ["PUBLIC","catalog_admin","catalog_import","catalog_public_reader",
          "catalog_receipt_maintenance",functionRow?.data.owner];
    if (acl.data.privilege === "EXECUTE" && !allowed.includes(grantee))
      block("UNKNOWN_FUNCTION_GRANTEE",`${signature}:${grantee}`);
    if (stage === "post" && grantee === "PUBLIC" && acl.data.privilege === "EXECUTE")
      block("PUBLIC_PRIVATE_FUNCTION_EXECUTE",signature);
  }
  for (const effective of inSection("function_effective")) {
    const role = effective.data.role;
    const roleData = by("role",role);
    const functionRow = functions.find((f) => f.item === effective.data.signature);
    const allowed = ["catalog_admin","catalog_import","catalog_public_reader",
      "catalog_receipt_maintenance",functionRow?.data.owner];
    if (effective.data.execute && effective.data.schema_usage && !roleData?.superuser &&
      !allowed.includes(role)) block("UNKNOWN_FUNCTION_CALLER",`${effective.data.signature}:${role}`);
  }
  for (const membership of inSection("membership")) {
    if (["catalog_admin_reader_runtime","catalog_admin","catalog_import",
      "catalog_public_reader","catalog_receipt_maintenance"].includes(membership.data.member))
      block("UNREVIEWED_ROLE_MEMBERSHIP",membership.item);
  }
  const reader = by("role","catalog_admin_reader_runtime");
  if (stage === "pre" && reader) block("READER_ROLE_ALREADY_EXISTS","catalog_admin_reader_runtime");
  if (stage === "post") {
    if (!reader) block("MISSING_READER_ROLE","catalog_admin_reader_runtime");
    else if (reader.superuser || reader.bypass_rls || reader.inherit || reader.create_db ||
      reader.create_role || !reader.login) block("READER_ROLE_FLAGS","catalog_admin_reader_runtime");
    const db = by("effective_database","catalog_admin_reader_runtime");
    if (!db?.connect || db.create || db.temp) block("READER_DATABASE_PRIVILEGES","catalog_admin_reader_runtime");
    for (const schema of (profile === "catalog-shared" ? ["catalog_private","catalog_public"] : businessSchemas)) {
      const effective = by("effective_schema",`catalog_admin_reader_runtime:${schema}`);
      if (schema === "catalog_private" ? !effective?.usage || effective.create
        : effective?.usage || effective?.create)
        block("READER_SCHEMA_PRIVILEGES",schema);
    }
    for (const table of privateTables) {
      const effective = by("effective_relation",`catalog_admin_reader_runtime:catalog_private.${table}`);
      if (!effective?.select || effective.insert || effective.update || effective.delete || effective.truncate)
        block("READER_TABLE_PRIVILEGES",table);
    }
    for (const fn of functions) {
      if (by("function_effective",`${fn.item}:catalog_admin_reader_runtime`)?.execute)
        block("READER_FUNCTION_EXECUTE",canonical(fn));
    }
    const receipts = by("effective_relation",
      "catalog_admin_reader_runtime:catalog_private.catalog_import_receipts");
    if (receipts && Object.entries(receipts).some(([key,value]) =>
      ["select","insert","update","delete","truncate"].includes(key) && value === true))
      block("READER_RECEIPT_TABLE_PRIVILEGES","catalog_private.catalog_import_receipts");
    for (const fn of inSection("rfq_function_effective")) {
      if (fn.data.role === "catalog_admin_reader_runtime" && fn.data.execute && fn.data.schema_usage)
        block("READER_RFQ_FUNCTION_EXECUTE",fn.item);
    }
  }
  const publicDb = inSection("database_acl").some((r) => r.data.grantee === "PUBLIC" &&
    ["TEMPORARY","CREATE"].includes(r.data.privilege));
  if (publicDb) block("PUBLIC_DATABASE_CREATE_OR_TEMP","current database");
  for (const acl of inSection("default_acl")) {
    if (acl.data.schema === "catalog_private" && acl.data.grantee === "PUBLIC" &&
      acl.data.privilege === "EXECUTE") block("PUBLIC_DEFAULT_FUNCTION_EXECUTE",acl.item);
  }
  const registry = by("migration_registry","supabase_migrations.schema_migrations");
  if (!registry?.exists) block("MISSING_MIGRATION_REGISTRY","supabase_migrations.schema_migrations");
  if (profile === "catalog-shared") {
    // The parent Catalog-only gate has already checked the actual exact version set.
  } else if (migrationVersions === null || migrationVersions === undefined)
    block("MIGRATION_HISTORY_UNVERIFIED","version-only list required");
  else if (!Array.isArray(migrationVersions) || migrationVersions.length === 0 ||
    migrationVersions.some((version) => typeof version !== "string" || !/^\d{14}$/.test(version)) ||
    new Set(migrationVersions).size !== migrationVersions.length)
    block("MIGRATION_HISTORY_INVALID","expected unique 14-digit migration versions");
  else {
    for (const version of (profile === "catalog-shared" ? [foundationVersion] : requiredVersions))
      if (!migrationVersions.includes(version))
      block("MISSING_MIGRATION",version);
    if (stage === "pre" && migrationVersions.includes(readerMigrationVersion))
      block("READ_ROLE_MIGRATION_ALREADY_APPLIED",readerMigrationVersion);
    if (stage === "post" && !migrationVersions.includes(readerMigrationVersion))
      block("MISSING_MIGRATION",readerMigrationVersion);
  }
  return { decision: findings.length ? "BLOCKED" : "PASS", findings };
}

/** Only the explicit public profiles are accepted; shared checks are private implementation detail. */
export function checkCatalogPermissionSnapshot(rows, { stage = "pre", migrationVersions = null,
  profile = "mixed", adminIdentity } = {}) {
  if (profile === "catalog-only")
    return checkCatalogOnlySnapshot(rows,{stage,migrationVersions,adminIdentity});
  if (profile !== "mixed") throw new Error("Unknown snapshot profile");
  return checkSnapshotCore(rows,{stage,migrationVersions,profile});
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const args = process.argv.slice(2);
  const catalogOnly = args[0] === "catalog-only";
  const [path, stage] = catalogOnly ? args.slice(1) : args;
  const historyPath = catalogOnly ? (args.length === 5 ? args[3] : undefined) : args[2];
  const adminIdentity = catalogOnly ? args.at(-1) : undefined;
  if (!path || (catalogOnly ? ![4,5].includes(args.length) ||
      !["empty","foundation","admin-read"].includes(stage) ||
      !["absent","present"].includes(adminIdentity) :
      args.length < 2 || args.length > 3 || !["pre","post"].includes(stage))) {
    process.stderr.write("Usage: checker <snapshot.jsonl> <pre|post> [migration-versions.txt] OR checker catalog-only <snapshot.jsonl> <empty|foundation|admin-read> <migration-versions.txt> <absent|present>\n");
    process.exitCode = 2;
  } else {
    const rows = (await readFile(path,"utf8")).trim().split(/\r?\n/).filter(Boolean)
      .map((line) => JSON.parse(line));
    const migrationVersions = historyPath ? await readFile(historyPath,"utf8")
      .then((value) => value.trim().split(/\r?\n/).filter(Boolean))
      .catch(() => null) : null;
    const result = checkCatalogPermissionSnapshot(rows,{stage,migrationVersions,
      profile:catalogOnly ? "catalog-only" : "mixed",adminIdentity});
    process.stdout.write(`${JSON.stringify(result,null,2)}\n`);
    if (result.decision !== "PASS") process.exitCode = 1;
  }
}
