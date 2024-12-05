-- Drop existing tables if they exist
DROP TABLE IF EXISTS model_results CASCADE;
DROP TABLE IF EXISTS seeds_and_patterns CASCADE;
DROP TABLE IF EXISTS sequence_history CASCADE;
DROP TABLE IF EXISTS sequences CASCADE;
DROP TABLE IF EXISTS model_predictions CASCADE;
DROP TABLE IF EXISTS model_performance CASCADE;

-- Create sequences table
CREATE TABLE IF NOT EXISTS sequences (
    id SERIAL PRIMARY KEY,
    symbol INTEGER NOT NULL CHECK (symbol >= 0 AND symbol <= 3),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    entropy_value FLOAT,
    pattern_detected BOOLEAN DEFAULT FALSE,
    transitions JSONB,
    pattern_strength FLOAT,
    batch_id UUID DEFAULT gen_random_uuid() UNIQUE,  -- Added UNIQUE constraint
    metadata JSONB DEFAULT '{}'::jsonb
);

-- Create model_predictions table
CREATE TABLE IF NOT EXISTS model_predictions (
    id SERIAL PRIMARY KEY,
    sequence_id INTEGER REFERENCES sequences(id),
    model_type VARCHAR(50) NOT NULL,
    prediction_data JSONB NOT NULL,
    confidence_score FLOAT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    metadata JSONB DEFAULT '{}'::jsonb,
    rng_seed INTEGER,
    rng_type VARCHAR(50)
);

-- Remove model_performance table creation since it's handled in migration 008

-- Create indexes
CREATE INDEX idx_sequences_created_at ON sequences(created_at);
CREATE INDEX idx_sequences_entropy ON sequences(entropy_value);
CREATE INDEX idx_sequences_pattern_detected ON sequences(pattern_detected);
CREATE INDEX idx_sequences_batch_id ON sequences(batch_id);
CREATE INDEX idx_model_predictions_type ON model_predictions(model_type);
CREATE INDEX idx_model_predictions_rng ON model_predictions(rng_type, rng_seed) WHERE model_type = 'rng_seed_discovery';

-- Create RNG analysis summary view
CREATE OR REPLACE VIEW rng_analysis_summary AS
SELECT 
    s.created_at::date as analysis_date,
    COUNT(*) as total_sequences,
    AVG(s.entropy_value) as avg_entropy,
    COUNT(DISTINCT mp.rng_seed) as unique_seeds_detected,
    AVG(mp.confidence_score) as avg_confidence
FROM sequences s
LEFT JOIN model_predictions mp 
    ON mp.model_type = 'rng_seed_discovery'
    AND mp.created_at::date = s.created_at::date
GROUP BY s.created_at::date
ORDER BY s.created_at::date DESC;

-- Grant permissions
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO PUBLIC;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO PUBLIC;
