-- Run only after the metadata snapshot confirms this registry exists and the
-- audited identity is authorized to SELECT it. Never select SQL statements.
SELECT version::text AS migration_version
FROM supabase_migrations.schema_migrations
ORDER BY version;
