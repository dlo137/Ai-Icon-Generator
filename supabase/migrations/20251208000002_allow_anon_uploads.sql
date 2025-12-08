-- =====================================================
-- Allow Anonymous Uploads for Testing
-- =====================================================
-- This allows unauthenticated users to upload to thumbnails bucket
-- REMOVE THIS IN PRODUCTION!

-- Policy: Allow anonymous uploads for testing
CREATE POLICY "Allow anonymous uploads for testing"
ON storage.objects
FOR INSERT
TO anon
WITH CHECK (bucket_id = 'thumbnails');

-- Policy: Allow anonymous reads for testing
CREATE POLICY "Allow anonymous reads for testing"
ON storage.objects
FOR SELECT
TO anon
USING (bucket_id = 'thumbnails');
