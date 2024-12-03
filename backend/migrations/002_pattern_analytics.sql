-- Create table for storing pattern analysis results
CREATE TABLE IF NOT EXISTS pattern_analysis (
    id SERIAL PRIMARY KEY,
    batch_id UUID REFERENCES sequences(batch_id),
    pattern TEXT NOT NULL,
    entropy FLOAT,
    frequency INTEGER,
    transitions JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create summary table for daily analytics
CREATE TABLE IF NOT EXISTS pattern_analysis_daily (
    analysis_date DATE PRIMARY KEY,
    total_sequences INTEGER,
    avg_entropy FLOAT,
    transition_patterns JSONB,
    unique_batches INTEGER,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_pattern_analysis_batch 
ON pattern_analysis(batch_id);

CREATE INDEX IF NOT EXISTS idx_pattern_analysis_created 
ON pattern_analysis(created_at);

CREATE INDEX IF NOT EXISTS idx_pattern_analysis_entropy 
ON pattern_analysis(entropy);

-- Grant necessary permissions
GRANT SELECT, INSERT, UPDATE ON pattern_analysis TO PUBLIC;
GRANT SELECT, INSERT, UPDATE ON pattern_analysis_daily TO PUBLIC;
GRANT USAGE, SELECT ON SEQUENCE pattern_analysis_id_seq TO PUBLIC;
