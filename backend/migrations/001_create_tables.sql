-- Create sequence_history table
CREATE TABLE IF NOT EXISTS sequence_history (
    id SERIAL PRIMARY KEY,
    session_id VARCHAR(50) NOT NULL,
    symbol INTEGER NOT NULL CHECK (symbol >= 0 AND symbol <= 3),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    batch_id UUID DEFAULT gen_random_uuid(), -- Group sequences from same generation/session
    source VARCHAR(20) DEFAULT 'manual' -- 'manual' or 'generated'
);

-- Create seeds_and_patterns table
CREATE TABLE IF NOT EXISTS seeds_and_patterns (
    id SERIAL PRIMARY KEY,
    session_id VARCHAR(50) NOT NULL,
    batch_id UUID REFERENCES sequence_history(batch_id),
    detected_seed VARCHAR(255),
    entropy FLOAT,
    pattern_type VARCHAR(50), -- 'linear', 'multiplicative', 'xorshift', etc.
    confidence FLOAT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create model_results table
CREATE TABLE IF NOT EXISTS model_results (
    id SERIAL PRIMARY KEY,
    session_id VARCHAR(50) NOT NULL,
    model_type VARCHAR(50) NOT NULL, -- 'markov', 'entropy', 'chi-square', 'monte-carlo'
    prediction INTEGER CHECK (prediction >= 0 AND prediction <= 3),
    actual INTEGER CHECK (actual >= 0 AND actual <= 3),
    confidence FLOAT,
    accuracy FLOAT,
    metadata JSONB, -- Store model-specific data
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes
CREATE INDEX idx_sequence_history_session_batch ON sequence_history(session_id, batch_id);
CREATE INDEX idx_sequence_history_created ON sequence_history(created_at);
CREATE INDEX idx_seeds_patterns_session ON seeds_and_patterns(session_id);
CREATE INDEX idx_model_results_session ON model_results(session_id);

-- Add triggers for updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_seeds_patterns_updated_at
    BEFORE UPDATE ON seeds_and_patterns
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
