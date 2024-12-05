-- Drop and recreate model_performance table with all required columns
DROP TABLE IF EXISTS model_performance CASCADE;

CREATE TABLE model_performance (
    id SERIAL PRIMARY KEY,
    prediction_id INTEGER REFERENCES model_predictions(id),
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

-- Create index for performance queries
CREATE INDEX idx_model_performance_model_type ON model_performance(model_type);
