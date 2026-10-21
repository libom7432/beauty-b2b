// Synthetic metadata rows for offline checker tests only.
export function completeSnapshot(stage) {
  const rows = [];
  const add = (section, item, data) => rows.push({section,item,data});
  add("database","synthetic_audit_database",{});
  add("migration_registry","supabase_migrations.schema_migrations",{exists:true});
  for (const schema of ["catalog_private","catalog_public","rfq_private","admin_private"])
    add("schema",schema,{exists:true});
  for (const role of ["catalog_admin","catalog_import","catalog_public_reader","anon"])
    add("role",role,{login:false,inherit:false,superuser:false,bypass_rls:false,
      create_db:false,create_role:false,replication:false});
  for (const role of ["catalog_admin","catalog_import","catalog_public_reader","anon"])
    add("effective_database",role,{connect:true,create:false,temp:false});
  if (stage === "post") {
    add("role","catalog_admin_reader_runtime",{login:true,inherit:false,superuser:false,
      bypass_rls:false,create_db:false,create_role:false,replication:false});
    add("effective_database","catalog_admin_reader_runtime",{connect:true,create:false,temp:false});
    for (const schema of ["catalog_private","catalog_public","rfq_private","admin_private"])
      add("effective_schema",`catalog_admin_reader_runtime:${schema}`,
        {usage:schema === "catalog_private",create:false});
  }
  const columns = {
    products:["id","product_code","slug","product_type","attributes","customization_options",
      "oem","odm","lead_time_min_days","lead_time_max_days","seo_indexable","featured",
      "new_arrival","published_at"],
    product_variants:["id","product_id","sku","attributes","moq_quantity","moq_unit",
      "order_multiple","package_quantity","package_unit","reference_price","reference_currency","sort_order"],
    categories:["id","parent_id","slug","name_en","name_zh","description_en",
      "description_zh","sort_order"],
    product_categories:["product_id","category_id","is_primary","sort_order"],
    product_images:["id","product_id","variant_id","public_url","role","sort_order",
      "width","height","format","alt_en","alt_zh"],
    product_translations:["product_id","locale","name","short_description","description",
      "seo_title","seo_description"],
  };
  for (const [table,viewColumns] of Object.entries(columns)) {
    const name = table.replace(/^product_variants$/, "variants")
      .replace(/^product_images$/, "images").replace(/^product_translations$/, "translations");
    const privateName = `catalog_private.${table}`;
    const publicName = `catalog_public.${table}`;
    add("relation",privateName,{exists:true,actual_kind:"r",owner:"catalog_owner",rls_enabled:true});
    add("relation",publicName,{exists:true,actual_kind:"v",owner:"catalog_public_reader",
      options:["security_barrier=true"],columns:viewColumns,view_mentions_published:true,
      view_mentions_storage_key:false});
    add("effective_relation",`anon:${privateName}`,{select:false});
    add("effective_relation",`anon:${publicName}`,{select:true});
    if (stage === "post") add("effective_relation",`catalog_admin_reader_runtime:${privateName}`,
      {select:true,insert:false,update:false,delete:false,truncate:false});
    for (const [prefix,role] of [["catalog_admin_all_","catalog_admin"],
      ["catalog_import_all_","catalog_import"]])
      add("policy",`${privateName}.${prefix}${name}`,
        {using_true:true,check_true:true,roles:[role]});
    add("policy",`${privateName}.catalog_reader_${name}`,
      {command:"r",roles:["catalog_public_reader"],using_true:false,
        using_mentions_published:true});
    if (stage === "post") add("policy",`${privateName}.catalog_admin_reader_${name}`,
      {command:"r",roles:["catalog_admin_reader_runtime"],using_true:true});
  }
  for (const signature of ["normalized_variant_attributes(jsonb)","product_row_guard()",
    "variant_row_guard()","category_guard()","touch_updated_at()",
    "check_product_publication(uuid)","enforce_product_publication()"] ) {
    const name = `catalog_private.${signature}`;
    add("function",name,{canonical_signature:name,owner:"catalog_owner"});
    add("function_acl",`${name}:catalog_owner:EXECUTE`,
      {signature:name,grantee:"catalog_owner",privilege:"EXECUTE"});
    for (const role of ["catalog_admin","catalog_import","catalog_public_reader",
      ...(stage === "post" ? ["catalog_admin_reader_runtime"] : [])])
      add("function_effective",`${name}:${role}`,
        {signature:name,role,execute:false,schema_usage:role !== "catalog_admin_reader_runtime"});
  }
  return rows;
}
