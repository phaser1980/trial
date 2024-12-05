BEGIN;

-- First, drop any existing constraints or indexes that might cause conflicts
DROP TABLE IF EXISTS model_performance CASCADE;

-- Create the table with all required columns and constraints
CREATE TABLE model_performance (
    id SERIAL PRIMARY KEY,
    prediction_id INTEGER,
    model_type VARCHAR(50) NOT NULL,
    actual_value TEXT,
    predicted_value TEXT,
    error_metrics JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    metadata JSONB DEFAULT '{}'::jsonb,
    correct_predictions INTEGER DEFAULT 0,
    total_predictions INTEGER DEFAULT 0,
    last_updated TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Add foreign key constraint separately to ensure clean creation
ALTER TABLE model_performance 
    ADD CONSTRAINT model_performance_prediction_id_fkey 
    FOREIGN KEY (prediction_id) 
    REFERENCES model_predictions(id) ON DELETE CASCADE;

-- Create index for performance queries
CREATE INDEX idx_model_performance_model_type ON model_performance(model_type);

COMMIT;
