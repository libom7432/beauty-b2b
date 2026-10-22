-- DRAFT / NOT APPROVED FOR MIGRATION
-- Sprint 2.6-B5-S2. Offline contract only. Do not apply to Supabase.
-- Requires the Catalog Foundation and Admin Read Runtime roles, schemas and products table.
-- This draft deliberately grants no collection write identity and changes no existing Catalog table.
BEGIN;

DO $$
BEGIN
  IF to_regclass('catalog_private.products') IS NULL
     OR to_regrole('catalog_public_reader') IS NULL
     OR to_regrole('catalog_admin_reader_runtime') IS NULL
     OR to_regrole('anon') IS NULL THEN
    RAISE EXCEPTION 'Collections prerequisites missing; review target before migration';
  END IF;
  IF to_regclass('catalog_private.collections') IS NOT NULL
     OR to_regclass('catalog_private.product_collections') IS NOT NULL
     OR to_regclass('catalog_public.collections') IS NOT NULL
     OR to_regclass('catalog_public.product_collections') IS NOT NULL THEN
    RAISE EXCEPTION 'Collections object already exists; review before migration';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN
    ('catalog_public_reader', 'catalog_admin_reader_runtime')
    AND (rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolreplication OR rolinherit
      OR rolcanlogin IS DISTINCT FROM (rolname = 'catalog_admin_reader_runtime'))) THEN
    RAISE EXCEPTION 'Collections read role has unexpected elevated attributes';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_auth_members m
    WHERE m.member IN ('catalog_public_reader'::regrole::oid,
      'catalog_admin_reader_runtime'::regrole::oid)
      OR m.roleid IN ('catalog_public_reader'::regrole::oid,
        'catalog_admin_reader_runtime'::regrole::oid)) THEN
    RAISE EXCEPTION 'Collections read role membership needs separate approval';
  END IF;
  IF has_schema_privilege('catalog_public_reader', 'catalog_public', 'CREATE')
     OR has_schema_privilege('anon', 'catalog_public', 'CREATE') THEN
    RAISE EXCEPTION 'Existing public schema CREATE privilege needs separate review';
  END IF;
END $$;

CREATE TABLE catalog_private.collections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE CHECK (length(slug) <= 200 AND slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name_en text NOT NULL DEFAULT '',
  name_zh text NOT NULL DEFAULT '',
  description_en text NOT NULL DEFAULT '',
  description_zh text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','retired')),
  sort_order integer NOT NULL DEFAULT 0,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'published' OR
    (btrim(name_en) <> '' AND btrim(name_zh) <> ''))
);
CREATE INDEX collections_order_idx ON catalog_private.collections(sort_order, id);
CREATE INDEX collections_public_order_idx ON catalog_private.collections(sort_order, id)
  WHERE status = 'published';

CREATE TABLE catalog_private.product_collections (
  collection_id uuid NOT NULL REFERENCES catalog_private.collections(id) ON DELETE RESTRICT,
  product_id uuid NOT NULL REFERENCES catalog_private.products(id) ON DELETE RESTRICT,
  sort_order integer NOT NULL DEFAULT 0,
  PRIMARY KEY (collection_id, product_id)
);
CREATE INDEX product_collections_order_idx
  ON catalog_private.product_collections(collection_id, sort_order, product_id);
CREATE INDEX product_collections_product_idx
  ON catalog_private.product_collections(product_id, collection_id);

CREATE FUNCTION catalog_private.collections_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Collections must be retired, not deleted'; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status = 'retired' THEN RAISE EXCEPTION 'Retired collection is terminal'; END IF;
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'Collection identity and creation time are immutable';
    END IF;
    IF OLD.published_at IS NOT NULL AND NEW.slug IS DISTINCT FROM OLD.slug THEN
      RAISE EXCEPTION 'Once-published collection slug is immutable';
    END IF;
    IF OLD.published_at IS NOT NULL AND NEW.published_at IS DISTINCT FROM OLD.published_at THEN
      RAISE EXCEPTION 'First publication time is immutable';
    END IF;
    IF OLD.published_at IS NULL AND NEW.status = 'published' THEN
      NEW.published_at := now();
    ELSIF OLD.published_at IS NULL AND NEW.published_at IS NOT NULL THEN
      RAISE EXCEPTION 'Only publication can set published_at';
    END IF;
  ELSIF NEW.status = 'published' THEN
    NEW.published_at := now();
  ELSIF NEW.published_at IS NOT NULL THEN
    RAISE EXCEPTION 'Draft or retired collection cannot supply published_at';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION catalog_private.collections_guard() FROM PUBLIC;
CREATE TRIGGER collections_guard BEFORE INSERT OR UPDATE OR DELETE
  ON catalog_private.collections FOR EACH ROW
  EXECUTE FUNCTION catalog_private.collections_guard();

ALTER TABLE catalog_private.collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog_private.product_collections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON catalog_private.collections, catalog_private.product_collections FROM PUBLIC, anon;
GRANT SELECT ON catalog_private.collections, catalog_private.product_collections
  TO catalog_admin_reader_runtime, catalog_public_reader;
CREATE POLICY collections_admin_read ON catalog_private.collections FOR SELECT
  TO catalog_admin_reader_runtime USING (true);
CREATE POLICY product_collections_admin_read ON catalog_private.product_collections FOR SELECT
  TO catalog_admin_reader_runtime USING (true);
CREATE POLICY collections_public_read ON catalog_private.collections FOR SELECT
  TO catalog_public_reader USING (status = 'published');
CREATE POLICY product_collections_public_read ON catalog_private.product_collections FOR SELECT
  TO catalog_public_reader USING (
    EXISTS (SELECT 1 FROM catalog_private.collections c
      WHERE c.id = collection_id AND c.status = 'published')
    AND EXISTS (SELECT 1 FROM catalog_private.products p
      WHERE p.id = product_id AND p.status = 'published')
  );

-- Owner-executed, explicit-column projections mirror Catalog Foundation.
-- No private table or storage_key is exposed to anon.
CREATE VIEW catalog_public.collections WITH (security_barrier = true) AS
SELECT id, slug, name_en, name_zh, description_en, description_zh, sort_order
FROM catalog_private.collections WHERE status = 'published';
CREATE VIEW catalog_public.product_collections WITH (security_barrier = true) AS
SELECT pc.collection_id, pc.product_id, pc.sort_order
FROM catalog_private.product_collections pc
JOIN catalog_private.collections c ON c.id = pc.collection_id
JOIN catalog_private.products p ON p.id = pc.product_id
WHERE c.status = 'published' AND p.status = 'published';
GRANT CREATE ON SCHEMA catalog_public TO catalog_public_reader;
ALTER VIEW catalog_public.collections OWNER TO catalog_public_reader;
ALTER VIEW catalog_public.product_collections OWNER TO catalog_public_reader;
REVOKE CREATE ON SCHEMA catalog_public FROM catalog_public_reader;
REVOKE ALL ON catalog_public.collections, catalog_public.product_collections FROM PUBLIC;
GRANT SELECT ON catalog_public.collections, catalog_public.product_collections TO anon;

-- Fail closed if a target's default ACL adds an unreviewed private-table grantee.
DO $$
DECLARE bad_object text;
BEGIN
  SELECT c.oid::regclass::text INTO bad_object
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) acl
  WHERE n.nspname = 'catalog_private'
    AND c.relname IN ('collections', 'product_collections')
    AND (acl.grantee NOT IN (c.relowner,
      'catalog_admin_reader_runtime'::regrole::oid,
      'catalog_public_reader'::regrole::oid)
      OR (acl.grantee <> c.relowner AND
        (acl.privilege_type <> 'SELECT' OR acl.is_grantable)))
  LIMIT 1;
  IF bad_object IS NOT NULL THEN
    RAISE EXCEPTION 'Unreviewed private collections ACL on %', bad_object;
  END IF;
  bad_object := NULL;
  SELECT c.oid::regclass::text INTO bad_object
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) acl
  WHERE n.nspname = 'catalog_public'
    AND c.relname IN ('collections', 'product_collections')
    AND (acl.grantee NOT IN (c.relowner, 'anon'::regrole::oid)
      OR (acl.grantee = 'anon'::regrole::oid AND
        (acl.privilege_type <> 'SELECT' OR acl.is_grantable)))
  LIMIT 1;
  IF bad_object IS NOT NULL THEN
    RAISE EXCEPTION 'Unreviewed public collections view ACL on %', bad_object;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p
    CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
    WHERE p.oid = 'catalog_private.collections_guard()'::regprocedure
      AND acl.grantee <> p.proowner) THEN
    RAISE EXCEPTION 'Unreviewed collections guard function EXECUTE ACL';
  END IF;
  IF has_table_privilege('anon', 'catalog_private.collections', 'SELECT')
     OR has_table_privilege('anon', 'catalog_private.product_collections', 'SELECT')
     OR has_table_privilege('catalog_admin_reader_runtime', 'catalog_private.collections', 'INSERT')
     OR has_table_privilege('catalog_admin_reader_runtime', 'catalog_private.collections', 'UPDATE')
     OR has_table_privilege('catalog_admin_reader_runtime', 'catalog_private.collections', 'DELETE')
     OR has_table_privilege('catalog_admin_reader_runtime', 'catalog_private.product_collections', 'INSERT')
     OR has_table_privilege('catalog_admin_reader_runtime', 'catalog_private.product_collections', 'UPDATE')
     OR has_table_privilege('catalog_admin_reader_runtime', 'catalog_private.product_collections', 'DELETE')
     OR has_table_privilege('catalog_public_reader', 'catalog_private.collections', 'INSERT')
     OR has_table_privilege('catalog_public_reader', 'catalog_private.collections', 'UPDATE')
     OR has_table_privilege('catalog_public_reader', 'catalog_private.collections', 'DELETE')
     OR has_table_privilege('catalog_public_reader', 'catalog_private.product_collections', 'INSERT')
     OR has_table_privilege('catalog_public_reader', 'catalog_private.product_collections', 'UPDATE')
     OR has_table_privilege('catalog_public_reader', 'catalog_private.product_collections', 'DELETE') THEN
    RAISE EXCEPTION 'Collections private-table effective privileges exceed read-only design';
  END IF;
END $$;

COMMIT;
