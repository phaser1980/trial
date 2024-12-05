-- Add model_name column to model_performance table
BEGIN;

-- First add the column as nullable
ALTER TABLE model_performance ADD COLUMN model_name VARCHAR(100);

-- Update existing rows with a default value based on model_type
UPDATE model_performance 
SET model_name = model_type || '_default'
WHERE model_name IS NULL;

-- Now that all rows have a value, we can safely add the NOT NULL constraint
ALTER TABLE model_performance ALTER COLUMN model_name SET NOT NULL;

-- Add index for better query performance
CREATE INDEX idx_model_performance_model_name ON model_performance(model_name);

COMMIT;
