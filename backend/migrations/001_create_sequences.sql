-- Drop existing tables if they exist
DROP TABLE IF EXISTS sequences CASCADE;

-- Create sequences table
CREATE TABLE sequences (
    id SERIAL PRIMARY KEY,
    symbol INTEGER NOT NULL CHECK (symbol >= 0 AND symbol < 4),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    entropy_value DOUBLE PRECISION,
    pattern_detected BOOLEAN DEFAULT false,
    transitions JSONB,
    pattern_strength DOUBLE PRECISION,
    batch_id UUID DEFAULT gen_random_uuid() UNIQUE,
    metadata JSONB DEFAULT '{}'::jsonb
);

-- Add indexes
CREATE INDEX idx_sequences_created_at ON sequences(created_at);
CREATE INDEX idx_sequences_entropy ON sequences(entropy_value);
CREATE INDEX idx_sequences_pattern_detected ON sequences(pattern_detected);
CREATE INDEX idx_sequences_batch_id ON sequences(batch_id);

-- Add check constraint for created_at
ALTER TABLE sequences DROP CONSTRAINT IF EXISTS check_created_at;
ALTER TABLE sequences ADD CONSTRAINT check_created_at 
    CHECK (created_at IS NULL OR created_at <= CURRENT_TIMESTAMP + interval '1 second');
