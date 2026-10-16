-- ============================================================================
-- Migration: 20261015000000_private_receipts_storage.sql
-- Purpose:
--   1. Create and configure private storage bucket 'mali-receipts'
--      (public = false, 5MB max file size, restricted to image/jpeg, image/png,
--       image/webp, application/pdf).
--   2. Enforce strict Row-Level Security on storage.objects scoped strictly to owner.
--   3. Enforce path convention: (storage.foldername(name))[1] = auth.uid()::text.
--   4. Revoke all permissions from anon and PUBLIC on storage.objects and storage.buckets.
--   5. Maintain safe, idempotent execution across clean and migrated environments.
-- ============================================================================

BEGIN;

-- 1. Ensure storage schema and tables exist (idempotent in both managed Supabase and local PGlite)
CREATE SCHEMA IF NOT EXISTS storage;

CREATE TABLE IF NOT EXISTS storage.buckets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner UUID,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  public BOOLEAN DEFAULT false,
  avif_autodetection BOOLEAN DEFAULT false,
  file_size_limit BIGINT,
  allowed_mime_types TEXT[],
  owner_id TEXT
);

CREATE TABLE IF NOT EXISTS storage.objects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id TEXT REFERENCES storage.buckets(id),
  name TEXT,
  owner UUID,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  last_accessed_at TIMESTAMPTZ DEFAULT now(),
  metadata JSONB,
  path_tokens TEXT[] GENERATED ALWAYS AS (string_to_array(name, '/')) STORED,
  version TEXT,
  owner_id TEXT
);

-- Ensure storage.foldername function exists
CREATE OR REPLACE FUNCTION storage.foldername(name TEXT)
RETURNS TEXT[]
LANGUAGE plpgsql
AS $$
DECLARE
  _parts TEXT[];
BEGIN
  IF name IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT string_to_array(name, '/') INTO _parts;
  IF array_length(_parts, 1) <= 1 THEN
    RETURN ARRAY[]::TEXT[];
  END IF;
  RETURN _parts[1:array_length(_parts, 1) - 1];
END;
$$;

-- 2. Define private storage bucket 'mali-receipts'
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'mali-receipts',
  'mali-receipts',
  false,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']::TEXT[]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types,
  updated_at = now();

-- 3. Enable and FORCE RLS on storage.objects and storage.buckets
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage.objects FORCE ROW LEVEL SECURITY;

ALTER TABLE storage.buckets ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage.buckets FORCE ROW LEVEL SECURITY;

-- 4. Explicitly REVOKE ALL permissions from anon and PUBLIC
REVOKE ALL ON TABLE storage.objects FROM anon;
REVOKE ALL ON TABLE storage.buckets FROM anon;
REVOKE ALL ON TABLE storage.objects FROM PUBLIC;
REVOKE ALL ON TABLE storage.buckets FROM PUBLIC;

-- Grant minimal permissions to authenticated
GRANT USAGE ON SCHEMA storage TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE storage.objects TO authenticated;
GRANT SELECT ON TABLE storage.buckets TO authenticated;
GRANT EXECUTE ON FUNCTION storage.foldername(TEXT) TO authenticated;

-- 5. Drop existing policies on storage.objects for mali-receipts (Idempotency)
DROP POLICY IF EXISTS "mali_receipts_select_authenticated" ON storage.objects;
DROP POLICY IF EXISTS "mali_receipts_insert_authenticated" ON storage.objects;
DROP POLICY IF EXISTS "mali_receipts_update_authenticated" ON storage.objects;
DROP POLICY IF EXISTS "mali_receipts_delete_authenticated" ON storage.objects;

-- SELECT policy: authenticated user can only read their own receipts
CREATE POLICY "mali_receipts_select_authenticated"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'mali-receipts'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- INSERT policy: authenticated user can only upload to their own folder, enforcing size limit and MIME types
CREATE POLICY "mali_receipts_insert_authenticated"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'mali-receipts'
  AND (storage.foldername(name))[1] = auth.uid()::text
  AND metadata IS NOT NULL
  AND (metadata->>'size') IS NOT NULL
  AND (metadata->>'size')::bigint <= 5242880
  AND (metadata->>'size')::bigint >= 0
  AND (
    COALESCE(metadata->>'mimetype', metadata->>'content-type') = ANY(ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
  )
);

-- UPDATE policy: authenticated user can only update their own receipts
CREATE POLICY "mali_receipts_update_authenticated"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'mali-receipts'
  AND (storage.foldername(name))[1] = auth.uid()::text
)
WITH CHECK (
  bucket_id = 'mali-receipts'
  AND (storage.foldername(name))[1] = auth.uid()::text
  AND metadata IS NOT NULL
  AND (metadata->>'size') IS NOT NULL
  AND (metadata->>'size')::bigint <= 5242880
  AND (metadata->>'size')::bigint >= 0
  AND (
    COALESCE(metadata->>'mimetype', metadata->>'content-type') = ANY(ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
  )
);

-- DELETE policy: authenticated user can only delete their own receipts
CREATE POLICY "mali_receipts_delete_authenticated"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'mali-receipts'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- Bucket read policy for authenticated users
DROP POLICY IF EXISTS "mali_receipts_bucket_select" ON storage.buckets;
CREATE POLICY "mali_receipts_bucket_select"
ON storage.buckets
FOR SELECT
TO authenticated
USING (id = 'mali-receipts');

COMMIT;
