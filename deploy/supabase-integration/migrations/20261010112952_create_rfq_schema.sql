-- Sprint 2.4.3-A: server-owned RFQ storage. Run once through Supabase migrations.

-- Do not add this schema to Supabase's Exposed schemas.
CREATE SCHEMA rfq_private;
REVOKE ALL ON SCHEMA rfq_private FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE rfq_private.rfq_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rfq_number text NOT NULL UNIQUE,
  idempotency_key text NOT NULL UNIQUE,
  request_fingerprint text NOT NULL,
  full_name text NOT NULL,
  email text NOT NULL,
  company_name text NOT NULL,
  country text NOT NULL,
  whatsapp text,
  website text,
  buyer_type text,
  requirements text NOT NULL,
  customization jsonb NOT NULL DEFAULT '[]'::jsonb,
  purchase_timeline text,
  status text NOT NULL DEFAULT 'received',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rfq_number_format CHECK (rfq_number ~ '^[A-Z0-9-]{8,64}$'),
  CONSTRAINT rfq_idempotency_key_format CHECK (
    length(idempotency_key) BETWEEN 16 AND 128 AND idempotency_key = btrim(idempotency_key)
  ),
  CONSTRAINT rfq_fingerprint_format CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
  CONSTRAINT rfq_full_name_length CHECK (length(full_name) BETWEEN 2 AND 100 AND full_name = btrim(full_name)),
  CONSTRAINT rfq_email_length CHECK (length(email) BETWEEN 3 AND 254 AND email = btrim(email)),
  CONSTRAINT rfq_company_name_length CHECK (length(company_name) BETWEEN 2 AND 150 AND company_name = btrim(company_name)),
  CONSTRAINT rfq_country_format CHECK (country ~ '^[A-Z]{2}$'),
  CONSTRAINT rfq_whatsapp_length CHECK (whatsapp IS NULL OR (length(whatsapp) <= 30 AND whatsapp = btrim(whatsapp))),
  CONSTRAINT rfq_website_length CHECK (website IS NULL OR (length(website) <= 2048 AND website = btrim(website))),
  CONSTRAINT rfq_requirements_length CHECK (length(requirements) BETWEEN 10 AND 5000 AND requirements = btrim(requirements)),
  CONSTRAINT rfq_buyer_type_value CHECK (
    buyer_type IS NULL OR buyer_type IN ('wholesaler', 'retailer', 'nail_salon', 'beauty_brand', 'ecommerce_seller', 'other')
  ),
  CONSTRAINT rfq_customization_values CHECK (
    CASE WHEN jsonb_typeof(customization) = 'array'
      THEN (customization <@ '["oem", "odm", "private_label", "custom_packaging"]'::jsonb
        AND jsonb_array_length(customization) <= 4)
      ELSE false END
  ),
  CONSTRAINT rfq_purchase_timeline_value CHECK (
    purchase_timeline IS NULL OR purchase_timeline IN ('immediately', 'within_1_month', 'within_3_months', 'planning')
  ),
  CONSTRAINT rfq_status_value CHECK (status = 'received')
);

CREATE INDEX rfq_requests_created_at_idx ON rfq_private.rfq_requests (created_at DESC);

CREATE TABLE rfq_private.rfq_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rfq_request_id uuid NOT NULL REFERENCES rfq_private.rfq_requests (id) ON DELETE RESTRICT,
  product_id text NOT NULL,
  sku text,
  quantity bigint NOT NULL,
  -- Trusted catalog data at submission time. IDs, SKU and quantity live in columns above.
  -- Shape: {productName: {en, zh}, productSlug, selectedVariant: {id, attributes} | null}.
  product_snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rfq_item_product_id_format CHECK (length(btrim(product_id)) > 0 AND product_id = btrim(product_id)),
  CONSTRAINT rfq_item_sku_format CHECK (sku IS NULL OR (length(btrim(sku)) > 0 AND sku = btrim(sku))),
  CONSTRAINT rfq_item_quantity_positive CHECK (quantity BETWEEN 1 AND 9007199254740991),
  CONSTRAINT rfq_item_snapshot_shape CHECK ((
    jsonb_typeof(product_snapshot) = 'object'
    AND jsonb_typeof(product_snapshot->'productName') = 'object'
    AND jsonb_typeof(product_snapshot->'productName'->'en') = 'string'
    AND length(btrim(product_snapshot->'productName'->>'en')) > 0
    AND jsonb_typeof(product_snapshot->'productName'->'zh') = 'string'
    AND length(btrim(product_snapshot->'productName'->>'zh')) > 0
    AND jsonb_typeof(product_snapshot->'productSlug') = 'string'
    AND length(btrim(product_snapshot->>'productSlug')) > 0
    AND product_snapshot ? 'selectedVariant'
    AND (
      (sku IS NULL AND product_snapshot->'selectedVariant' = 'null'::jsonb)
      OR (sku IS NOT NULL
        AND jsonb_typeof(product_snapshot->'selectedVariant') = 'object'
        AND jsonb_typeof(product_snapshot->'selectedVariant'->'id') = 'string'
        AND length(btrim(product_snapshot->'selectedVariant'->>'id')) > 0
        AND jsonb_typeof(product_snapshot->'selectedVariant'->'attributes') = 'object')
    )
  ) IS TRUE)
);

CREATE INDEX rfq_items_request_id_idx ON rfq_private.rfq_items (rfq_request_id);
-- Match validateRFQItems: a duplicate is the same product ID and SKU pair.
CREATE UNIQUE INDEX rfq_items_request_product_sku_unique_idx
  ON rfq_private.rfq_items (rfq_request_id, product_id, sku) WHERE sku IS NOT NULL;
CREATE UNIQUE INDEX rfq_items_request_variantless_product_unique_idx
  ON rfq_private.rfq_items (rfq_request_id, product_id) WHERE sku IS NULL;

CREATE TABLE rfq_private.rfq_notification_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rfq_request_id uuid NOT NULL UNIQUE REFERENCES rfq_private.rfq_requests (id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'pending',
  attempt_count integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz DEFAULT now(),
  lease_expires_at timestamptz,
  sent_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rfq_notification_status_value CHECK (status IN ('pending', 'processing', 'retry_wait', 'sent', 'failed')),
  CONSTRAINT rfq_notification_attempt_count CHECK (attempt_count >= 0),
  CONSTRAINT rfq_notification_last_error_length CHECK (last_error IS NULL OR length(last_error) <= 2000),
  CONSTRAINT rfq_notification_schedule CHECK (
    (status IN ('pending', 'retry_wait') AND next_attempt_at IS NOT NULL AND lease_expires_at IS NULL AND sent_at IS NULL)
    OR (status = 'processing' AND next_attempt_at IS NULL AND lease_expires_at IS NOT NULL AND sent_at IS NULL)
    OR (status = 'sent' AND next_attempt_at IS NULL AND lease_expires_at IS NULL AND sent_at IS NOT NULL)
    OR (status = 'failed' AND next_attempt_at IS NULL AND lease_expires_at IS NULL AND sent_at IS NULL)
  )
);

CREATE INDEX rfq_notification_jobs_due_idx
  ON rfq_private.rfq_notification_jobs (status, next_attempt_at)
  WHERE status IN ('pending', 'retry_wait');
CREATE INDEX rfq_notification_jobs_expired_lease_idx
  ON rfq_private.rfq_notification_jobs (lease_expires_at)
  WHERE status = 'processing';

CREATE FUNCTION rfq_private.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER rfq_requests_updated_at BEFORE UPDATE ON rfq_private.rfq_requests
  FOR EACH ROW EXECUTE FUNCTION rfq_private.set_updated_at();
CREATE TRIGGER rfq_items_updated_at BEFORE UPDATE ON rfq_private.rfq_items
  FOR EACH ROW EXECUTE FUNCTION rfq_private.set_updated_at();
CREATE TRIGGER rfq_notification_jobs_updated_at BEFORE UPDATE ON rfq_private.rfq_notification_jobs
  FOR EACH ROW EXECUTE FUNCTION rfq_private.set_updated_at();

ALTER TABLE rfq_private.rfq_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE rfq_private.rfq_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE rfq_private.rfq_notification_jobs ENABLE ROW LEVEL SECURITY;

-- No policies or client grants. Future server-only access needs an explicit role design.
REVOKE ALL ON ALL TABLES IN SCHEMA rfq_private FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION rfq_private.set_updated_at() FROM PUBLIC, anon, authenticated, service_role;

