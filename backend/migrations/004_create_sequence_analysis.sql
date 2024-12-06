-- Create sequence_analysis table
CREATE TABLE IF NOT EXISTS sequence_analysis (
    sequence_id INTEGER PRIMARY KEY REFERENCES sequences(id) ON DELETE CASCADE,
    entropy FLOAT NOT NULL,
    patterns JSONB NOT NULL DEFAULT '{}',
    transitions JSONB NOT NULL DEFAULT '{}',
    analyzed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_sequence_analysis_analyzed_at ON sequence_analysis(analyzed_at);

-- Create model_performance table if it doesn't exist
CREATE TABLE IF NOT EXISTS model_performance (
    model_name VARCHAR(50) PRIMARY KEY,
    correct_predictions INTEGER NOT NULL DEFAULT 0,
    total_predictions INTEGER NOT NULL DEFAULT 0,
    last_updated TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Add indexes for performance monitoring
CREATE INDEX IF NOT EXISTS idx_model_performance_last_updated ON model_performance(last_updated);
