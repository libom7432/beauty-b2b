-- Sprint 2.5-B2. Independent catalog foundation. No RFQ objects are changed.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    RAISE EXCEPTION 'Expected existing anon role';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'catalog_admin') THEN
    CREATE ROLE catalog_admin NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'catalog_import') THEN
    CREATE ROLE catalog_import NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'catalog_public_reader') THEN
    CREATE ROLE catalog_public_reader NOLOGIN NOINHERIT;
  END IF;
END $$;

CREATE SCHEMA catalog_private;
CREATE SCHEMA catalog_public;
REVOKE ALL ON SCHEMA catalog_private, catalog_public FROM PUBLIC;
REVOKE ALL ON SCHEMA catalog_private FROM anon;
GRANT USAGE ON SCHEMA catalog_private TO catalog_admin, catalog_import, catalog_public_reader;
GRANT USAGE ON SCHEMA catalog_public TO anon, catalog_admin, catalog_import;

CREATE TABLE catalog_private.categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid REFERENCES catalog_private.categories(id) ON DELETE RESTRICT,
  slug text NOT NULL CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','retired')),
  name_en text NOT NULL DEFAULT '', name_zh text NOT NULL DEFAULT '',
  description_en text NOT NULL DEFAULT '', description_zh text NOT NULL DEFAULT '',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (parent_id IS DISTINCT FROM id)
);
CREATE UNIQUE INDEX categories_root_slug_uq ON catalog_private.categories(slug) WHERE parent_id IS NULL;
CREATE UNIQUE INDEX categories_sibling_slug_uq ON catalog_private.categories(parent_id, slug) WHERE parent_id IS NOT NULL;
CREATE INDEX categories_parent_order_idx ON catalog_private.categories(parent_id, sort_order, id);

CREATE TABLE catalog_private.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_code text NOT NULL UNIQUE CHECK (product_code = btrim(product_code) AND product_code <> ''),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  product_type text NOT NULL CHECK (product_type = btrim(product_type) AND product_type <> ''),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','retired')),
  attributes jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(attributes) = 'object'),
  customization_options jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(customization_options) = 'array'),
  oem boolean NOT NULL DEFAULT false, odm boolean NOT NULL DEFAULT false,
  lead_time_min_days integer CHECK (lead_time_min_days >= 0),
  lead_time_max_days integer CHECK (lead_time_max_days >= 0),
  seo_indexable boolean NOT NULL DEFAULT false,
  featured boolean NOT NULL DEFAULT false, new_arrival boolean NOT NULL DEFAULT false,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (lead_time_max_days IS NULL OR lead_time_min_days IS NULL OR lead_time_max_days >= lead_time_min_days)
);
CREATE INDEX products_public_listing_idx ON catalog_private.products(status, featured DESC, updated_at DESC, id);
CREATE INDEX products_type_status_idx ON catalog_private.products(product_type, status, id);

-- SKU combination keys and textual values are case/whitespace-insensitive.
-- Values are intentionally flat scalars; units belong in explicit SKU columns.
CREATE FUNCTION catalog_private.normalized_variant_attributes(input jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE STRICT SET search_path = pg_catalog AS $$
DECLARE key text; value jsonb; normalized_key text; normalized_value jsonb; result jsonb := '{}'::jsonb;
BEGIN
  IF jsonb_typeof(input) <> 'object' THEN RAISE EXCEPTION 'Variant attributes must be an object'; END IF;
  FOR key, value IN SELECT * FROM jsonb_each(input) LOOP
    normalized_key := lower(btrim(key));
    IF normalized_key !~ '^[a-z][a-z0-9_]*$' OR result ? normalized_key THEN
      RAISE EXCEPTION 'Invalid or duplicate normalized variant attribute key: %', key;
    END IF;
    IF jsonb_typeof(value) = 'string' THEN
      normalized_value := to_jsonb(lower(regexp_replace(btrim(value #>> '{}'), '[[:space:]]+', ' ', 'g')));
      IF normalized_value = '""'::jsonb THEN RAISE EXCEPTION 'Empty variant attribute value: %', key; END IF;
    ELSIF jsonb_typeof(value) IN ('number','boolean') THEN normalized_value := value;
    ELSE RAISE EXCEPTION 'Variant attribute value must be a string, number or boolean: %', key;
    END IF;
    result := result || jsonb_build_object(normalized_key, normalized_value);
  END LOOP;
  RETURN result;
END $$;

CREATE TABLE catalog_private.product_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES catalog_private.products(id) ON DELETE RESTRICT,
  sku text NOT NULL UNIQUE CHECK (sku = btrim(sku) AND sku <> ''),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','retired')),
  attributes jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(attributes) = 'object'),
  moq_quantity bigint NOT NULL CHECK (moq_quantity > 0 AND moq_quantity <= 9007199254740991),
  moq_unit text NOT NULL CHECK (moq_unit = btrim(moq_unit) AND moq_unit <> ''),
  order_multiple bigint CHECK (order_multiple > 0),
  package_quantity bigint CHECK (package_quantity > 0),
  package_unit text CHECK (package_unit = btrim(package_unit) AND package_unit <> ''),
  reference_price numeric(14,4) CHECK (reference_price > 0),
  reference_currency text CHECK (reference_currency ~ '^[A-Z]{3}$'),
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, product_id),
  CHECK ((package_quantity IS NULL) = (package_unit IS NULL)),
  CHECK ((reference_price IS NULL) = (reference_currency IS NULL))
);
CREATE UNIQUE INDEX product_variants_combination_uq ON catalog_private.product_variants
  (product_id, catalog_private.normalized_variant_attributes(attributes));
CREATE INDEX product_variants_product_status_idx ON catalog_private.product_variants(product_id, status, sort_order, id);

CREATE TABLE catalog_private.product_categories (
  product_id uuid NOT NULL REFERENCES catalog_private.products(id) ON DELETE RESTRICT,
  category_id uuid NOT NULL REFERENCES catalog_private.categories(id) ON DELETE RESTRICT,
  is_primary boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (product_id, category_id)
);
CREATE UNIQUE INDEX product_categories_one_primary_uq ON catalog_private.product_categories(product_id) WHERE is_primary;
CREATE INDEX product_categories_category_idx ON catalog_private.product_categories(category_id, product_id);

CREATE TABLE catalog_private.product_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES catalog_private.products(id) ON DELETE RESTRICT,
  variant_id uuid,
  storage_key text NOT NULL CHECK (storage_key = btrim(storage_key) AND storage_key <> ''),
  public_url text NOT NULL CHECK (public_url = btrim(public_url) AND public_url <> ''),
  role text NOT NULL CHECK (role IN ('primary','detail','variant')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','retired')),
  sort_order integer NOT NULL DEFAULT 0,
  width integer CHECK (width > 0), height integer CHECK (height > 0),
  format text CHECK (format IN ('jpeg','png','webp','avif')),
  alt_en text NOT NULL DEFAULT '', alt_zh text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (variant_id, product_id) REFERENCES catalog_private.product_variants(id, product_id) ON DELETE RESTRICT,
  CHECK (role <> 'primary' OR variant_id IS NULL),
  CHECK (role <> 'variant' OR variant_id IS NOT NULL)
);
CREATE UNIQUE INDEX product_images_primary_uq ON catalog_private.product_images(product_id) WHERE role = 'primary' AND status = 'published';
CREATE UNIQUE INDEX product_images_storage_key_uq ON catalog_private.product_images(storage_key);
CREATE INDEX product_images_product_idx ON catalog_private.product_images(product_id, status, sort_order, id);
CREATE INDEX product_images_variant_idx ON catalog_private.product_images(variant_id) WHERE variant_id IS NOT NULL;

CREATE TABLE catalog_private.product_translations (
  product_id uuid NOT NULL REFERENCES catalog_private.products(id) ON DELETE RESTRICT,
  locale text NOT NULL CHECK (locale IN ('en','zh')),
  name text NOT NULL DEFAULT '', short_description text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '', seo_title text NOT NULL DEFAULT '',
  seo_description text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (product_id, locale)
);

CREATE FUNCTION catalog_private.product_row_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Products must be retired, not deleted'; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.product_code IS DISTINCT FROM OLD.product_code THEN RAISE EXCEPTION 'Product code is immutable'; END IF;
    IF OLD.published_at IS NOT NULL AND NEW.slug IS DISTINCT FROM OLD.slug THEN RAISE EXCEPTION 'Published slug is immutable'; END IF;
    IF OLD.published_at IS NOT NULL AND NEW.published_at IS DISTINCT FROM OLD.published_at THEN RAISE EXCEPTION 'published_at is immutable'; END IF;
    IF OLD.published_at IS NULL AND NEW.status = 'published' THEN NEW.published_at := now(); END IF;
    IF OLD.published_at IS NULL AND NEW.status <> 'published' AND NEW.published_at IS NOT NULL THEN
      RAISE EXCEPTION 'Only publication can set published_at';
    END IF;
  ELSIF NEW.status = 'published' THEN
    NEW.published_at := now();
  END IF;
  IF NEW.status <> 'published' AND NEW.published_at IS NOT NULL AND TG_OP = 'INSERT' THEN
    RAISE EXCEPTION 'Draft or retired product cannot supply published_at';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER products_guard BEFORE INSERT OR UPDATE OR DELETE ON catalog_private.products
FOR EACH ROW EXECUTE FUNCTION catalog_private.product_row_guard();

CREATE FUNCTION catalog_private.variant_row_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'SKUs must be retired, not deleted'; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.sku IS DISTINCT FROM OLD.sku OR NEW.product_id IS DISTINCT FROM OLD.product_id THEN
      RAISE EXCEPTION 'SKU identity is immutable';
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER variants_guard BEFORE INSERT OR UPDATE OR DELETE ON catalog_private.product_variants
FOR EACH ROW EXECUTE FUNCTION catalog_private.variant_row_guard();

CREATE FUNCTION catalog_private.category_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE cursor_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Categories must be retired, not deleted'; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status <> 'draft' AND (NEW.slug IS DISTINCT FROM OLD.slug OR NEW.parent_id IS DISTINCT FROM OLD.parent_id) THEN
    RAISE EXCEPTION 'Published category URL is immutable';
  END IF;
  cursor_id := NEW.parent_id;
  WHILE cursor_id IS NOT NULL LOOP
    IF cursor_id = NEW.id THEN RAISE EXCEPTION 'Category cycle'; END IF;
    SELECT parent_id INTO cursor_id FROM catalog_private.categories WHERE id = cursor_id;
  END LOOP;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER categories_guard BEFORE INSERT OR UPDATE OR DELETE ON catalog_private.categories
FOR EACH ROW EXECUTE FUNCTION catalog_private.category_guard();

CREATE FUNCTION catalog_private.touch_updated_at() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER product_categories_touch BEFORE UPDATE ON catalog_private.product_categories
FOR EACH ROW EXECUTE FUNCTION catalog_private.touch_updated_at();
CREATE TRIGGER product_images_touch BEFORE UPDATE ON catalog_private.product_images
FOR EACH ROW EXECUTE FUNCTION catalog_private.touch_updated_at();
CREATE TRIGGER product_translations_touch BEFORE UPDATE ON catalog_private.product_translations
FOR EACH ROW EXECUTE FUNCTION catalog_private.touch_updated_at();

CREATE FUNCTION catalog_private.check_product_publication(pid uuid) RETURNS void
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE current_status text;
BEGIN
  -- Serialize concurrent catalog changes that affect one product's publication state.
  PERFORM 1 FROM catalog_private.products WHERE id = pid FOR UPDATE;
  SELECT status INTO current_status FROM catalog_private.products WHERE id = pid;
  IF current_status IS NULL THEN RETURN; END IF;
  IF current_status = 'retired' AND EXISTS (
    SELECT 1 FROM catalog_private.product_variants WHERE product_id = pid AND status = 'published'
  ) THEN RAISE EXCEPTION 'Retired product cannot have a published SKU'; END IF;
  IF current_status <> 'published' THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM catalog_private.product_variants WHERE product_id = pid AND status = 'published') THEN
    RAISE EXCEPTION 'Published product needs a published SKU'; END IF;
  IF (SELECT count(*) FROM catalog_private.product_categories pc JOIN catalog_private.categories c ON c.id = pc.category_id
      WHERE pc.product_id = pid AND pc.is_primary AND c.status = 'published') <> 1 THEN
    RAISE EXCEPTION 'Published product needs exactly one active primary category'; END IF;
  IF (SELECT count(*) FROM catalog_private.product_translations t WHERE t.product_id = pid AND t.locale IN ('en','zh')
      AND btrim(t.name) <> '' AND btrim(t.short_description) <> '' AND btrim(t.description) <> ''
      AND btrim(t.seo_title) <> '' AND btrim(t.seo_description) <> '') <> 2 THEN
    RAISE EXCEPTION 'Published product needs complete English and Chinese translations'; END IF;
  IF NOT EXISTS (SELECT 1 FROM catalog_private.product_images WHERE product_id = pid AND role = 'primary'
      AND status = 'published' AND btrim(alt_en) <> '' AND btrim(alt_zh) <> '') THEN
    RAISE EXCEPTION 'Published product needs an active primary image with English and Chinese ALT'; END IF;
END $$;

CREATE FUNCTION catalog_private.enforce_product_publication() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE pid uuid;
BEGIN
  IF TG_TABLE_NAME = 'categories' THEN
    FOR pid IN SELECT product_id FROM catalog_private.product_categories
      WHERE category_id = CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END LOOP
      PERFORM catalog_private.check_product_publication(pid);
    END LOOP;
    IF EXISTS (
      SELECT 1 FROM catalog_private.categories child
      LEFT JOIN catalog_private.categories parent ON parent.id = child.parent_id
      WHERE child.status = 'published' AND child.parent_id IS NOT NULL AND parent.status IS DISTINCT FROM 'published'
    ) THEN RAISE EXCEPTION 'Published category needs a published parent'; END IF;
  ELSE
    IF TG_TABLE_NAME = 'products' THEN
      pid := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
    ELSE
      pid := CASE WHEN TG_OP = 'DELETE' THEN OLD.product_id ELSE NEW.product_id END;
    END IF;
    PERFORM catalog_private.check_product_publication(pid);
    IF TG_OP = 'UPDATE' AND TG_TABLE_NAME <> 'products' THEN
      IF OLD.product_id IS DISTINCT FROM NEW.product_id THEN
        PERFORM catalog_private.check_product_publication(OLD.product_id);
      END IF;
    END IF;
  END IF;
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER products_publication_check AFTER INSERT OR UPDATE OR DELETE ON catalog_private.products
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION catalog_private.enforce_product_publication();
CREATE CONSTRAINT TRIGGER variants_publication_check AFTER INSERT OR UPDATE OR DELETE ON catalog_private.product_variants
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION catalog_private.enforce_product_publication();
CREATE CONSTRAINT TRIGGER categories_publication_check AFTER INSERT OR UPDATE OR DELETE ON catalog_private.categories
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION catalog_private.enforce_product_publication();
CREATE CONSTRAINT TRIGGER product_categories_publication_check AFTER INSERT OR UPDATE OR DELETE ON catalog_private.product_categories
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION catalog_private.enforce_product_publication();
CREATE CONSTRAINT TRIGGER images_publication_check AFTER INSERT OR UPDATE OR DELETE ON catalog_private.product_images
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION catalog_private.enforce_product_publication();
CREATE CONSTRAINT TRIGGER translations_publication_check AFTER INSERT OR UPDATE OR DELETE ON catalog_private.product_translations
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION catalog_private.enforce_product_publication();

ALTER TABLE catalog_private.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog_private.product_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog_private.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog_private.product_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog_private.product_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog_private.product_translations ENABLE ROW LEVEL SECURITY;

-- Server-side administration/import roles only. Neither role has LOGIN or database CONNECT here.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA catalog_private TO catalog_admin;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA catalog_private TO catalog_import;
GRANT SELECT ON ALL TABLES IN SCHEMA catalog_private TO catalog_public_reader;
CREATE POLICY catalog_admin_all_products ON catalog_private.products TO catalog_admin USING (true) WITH CHECK (true);
CREATE POLICY catalog_import_all_products ON catalog_private.products TO catalog_import USING (true) WITH CHECK (true);
CREATE POLICY catalog_reader_products ON catalog_private.products FOR SELECT TO catalog_public_reader USING (status = 'published');
CREATE POLICY catalog_admin_all_variants ON catalog_private.product_variants TO catalog_admin USING (true) WITH CHECK (true);
CREATE POLICY catalog_import_all_variants ON catalog_private.product_variants TO catalog_import USING (true) WITH CHECK (true);
CREATE POLICY catalog_reader_variants ON catalog_private.product_variants FOR SELECT TO catalog_public_reader
USING (status = 'published' AND EXISTS (
  SELECT 1 FROM catalog_private.products p WHERE p.id = product_id AND p.status = 'published'));
CREATE POLICY catalog_admin_all_categories ON catalog_private.categories TO catalog_admin USING (true) WITH CHECK (true);
CREATE POLICY catalog_import_all_categories ON catalog_private.categories TO catalog_import USING (true) WITH CHECK (true);
CREATE POLICY catalog_reader_categories ON catalog_private.categories FOR SELECT TO catalog_public_reader USING (status = 'published');
CREATE POLICY catalog_admin_all_product_categories ON catalog_private.product_categories TO catalog_admin USING (true) WITH CHECK (true);
CREATE POLICY catalog_import_all_product_categories ON catalog_private.product_categories TO catalog_import USING (true) WITH CHECK (true);
CREATE POLICY catalog_reader_product_categories ON catalog_private.product_categories FOR SELECT TO catalog_public_reader
USING (EXISTS (SELECT 1 FROM catalog_private.products p WHERE p.id = product_id AND p.status = 'published')
  AND EXISTS (SELECT 1 FROM catalog_private.categories c WHERE c.id = category_id AND c.status = 'published'));
CREATE POLICY catalog_admin_all_images ON catalog_private.product_images TO catalog_admin USING (true) WITH CHECK (true);
CREATE POLICY catalog_import_all_images ON catalog_private.product_images TO catalog_import USING (true) WITH CHECK (true);
CREATE POLICY catalog_reader_images ON catalog_private.product_images FOR SELECT TO catalog_public_reader
USING (status = 'published' AND EXISTS (
  SELECT 1 FROM catalog_private.products p WHERE p.id = product_id AND p.status = 'published')
  AND (variant_id IS NULL OR EXISTS (
    SELECT 1 FROM catalog_private.product_variants v WHERE v.id = variant_id AND v.status = 'published')));
CREATE POLICY catalog_admin_all_translations ON catalog_private.product_translations TO catalog_admin USING (true) WITH CHECK (true);
CREATE POLICY catalog_import_all_translations ON catalog_private.product_translations TO catalog_import USING (true) WITH CHECK (true);
CREATE POLICY catalog_reader_translations ON catalog_private.product_translations FOR SELECT TO catalog_public_reader
USING (EXISTS (SELECT 1 FROM catalog_private.products p WHERE p.id = product_id AND p.status = 'published'));

-- Explicit-column, owner-executed views prevent anonymous access to draft rows or private columns.
CREATE VIEW catalog_public.products WITH (security_barrier = true) AS
SELECT id, product_code, slug, product_type, attributes, customization_options, oem, odm,
  lead_time_min_days, lead_time_max_days, seo_indexable, featured, new_arrival, published_at
FROM catalog_private.products WHERE status = 'published';
CREATE VIEW catalog_public.product_variants WITH (security_barrier = true) AS
SELECT v.id, v.product_id, v.sku, v.attributes, v.moq_quantity, v.moq_unit, v.order_multiple,
  v.package_quantity, v.package_unit, v.reference_price, v.reference_currency, v.sort_order
FROM catalog_private.product_variants v JOIN catalog_private.products p ON p.id = v.product_id
WHERE p.status = 'published' AND v.status = 'published';
CREATE VIEW catalog_public.categories WITH (security_barrier = true) AS
SELECT id, parent_id, slug, name_en, name_zh, description_en, description_zh, sort_order
FROM catalog_private.categories WHERE status = 'published';
CREATE VIEW catalog_public.product_categories WITH (security_barrier = true) AS
SELECT pc.product_id, pc.category_id, pc.is_primary, pc.sort_order
FROM catalog_private.product_categories pc
JOIN catalog_private.products p ON p.id = pc.product_id
JOIN catalog_private.categories c ON c.id = pc.category_id
WHERE p.status = 'published' AND c.status = 'published';
CREATE VIEW catalog_public.product_images WITH (security_barrier = true) AS
SELECT i.id, i.product_id, i.variant_id, i.public_url, i.role, i.sort_order,
  i.width, i.height, i.format, i.alt_en, i.alt_zh
FROM catalog_private.product_images i JOIN catalog_private.products p ON p.id = i.product_id
LEFT JOIN catalog_private.product_variants v ON v.id = i.variant_id
WHERE p.status = 'published' AND i.status = 'published' AND (i.variant_id IS NULL OR v.status = 'published');
CREATE VIEW catalog_public.product_translations WITH (security_barrier = true) AS
SELECT t.product_id, t.locale, t.name, t.short_description, t.description, t.seo_title, t.seo_description
FROM catalog_private.product_translations t JOIN catalog_private.products p ON p.id = t.product_id
WHERE p.status = 'published';
-- The view owner is a non-login, non-bypass read role, not the migration owner.
-- Temporarily permit ownership transfer, then remove schema CREATE again.
GRANT CREATE ON SCHEMA catalog_public TO catalog_public_reader;
ALTER VIEW catalog_public.products OWNER TO catalog_public_reader;
ALTER VIEW catalog_public.product_variants OWNER TO catalog_public_reader;
ALTER VIEW catalog_public.categories OWNER TO catalog_public_reader;
ALTER VIEW catalog_public.product_categories OWNER TO catalog_public_reader;
ALTER VIEW catalog_public.product_images OWNER TO catalog_public_reader;
ALTER VIEW catalog_public.product_translations OWNER TO catalog_public_reader;
REVOKE CREATE ON SCHEMA catalog_public FROM catalog_public_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA catalog_public TO anon;
REVOKE ALL ON ALL TABLES IN SCHEMA catalog_private FROM anon, PUBLIC;

