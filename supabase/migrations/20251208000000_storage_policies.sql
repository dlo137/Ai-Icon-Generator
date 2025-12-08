-- =====================================================
-- Storage Policies for Thumbnails Bucket
-- =====================================================

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can upload to their own folder" ON storage.objects;
DROP POLICY IF EXISTS "Users can read their own folder" ON storage.objects;
DROP POLICY IF EXISTS "Users can update their own folder" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete from their own folder" ON storage.objects;

-- Policy: Users can upload (INSERT) to their own folder
CREATE POLICY "Users can upload to their own folder"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'thumbnails'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- Policy: Users can read (SELECT) from their own folder
CREATE POLICY "Users can read their own folder"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'thumbnails'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- Policy: Users can update files in their own folder
CREATE POLICY "Users can update their own folder"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'thumbnails'
  AND auth.uid()::text = (storage.foldername(name))[1]
)
WITH CHECK (
  bucket_id = 'thumbnails'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- Policy: Users can delete files from their own folder
CREATE POLICY "Users can delete from their own folder"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'thumbnails'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- Allow anonymous uploads for testing (OPTIONAL - comment out for production)
-- CREATE POLICY "Allow anonymous uploads for testing"
-- ON storage.objects
-- FOR INSERT
-- TO anon
-- WITH CHECK (bucket_id = 'thumbnails');
