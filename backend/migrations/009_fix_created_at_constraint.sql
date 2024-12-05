-- Drop the problematic created_at constraint
ALTER TABLE sequences DROP CONSTRAINT IF EXISTS check_created_at;
