-- Add constraints to existing tables

-- Sequences table constraints
ALTER TABLE sequences
    ADD CONSTRAINT check_symbol_range 
    CHECK (symbol >= 0 AND symbol <= 3),
    ADD CONSTRAINT check_created_at 
    CHECK (created_at <= CURRENT_TIMESTAMP);

-- Model predictions constraints
ALTER TABLE model_predictions
    ADD CONSTRAINT check_confidence_score_range 
    CHECK (confidence_score >= 0 AND confidence_score <= 1),
    ADD CONSTRAINT fk_sequence_id 
    FOREIGN KEY (sequence_id) REFERENCES sequences(id) ON DELETE CASCADE;

-- Pattern analysis constraints
ALTER TABLE pattern_analysis
    ADD CONSTRAINT check_entropy_range 
    CHECK (entropy >= 0 AND entropy <= 1),
    ADD CONSTRAINT check_frequency_positive 
    CHECK (frequency >= 0);

-- Pattern analysis daily constraints
ALTER TABLE pattern_analysis_daily
    ADD CONSTRAINT check_total_sequences_positive 
    CHECK (total_sequences >= 0),
    ADD CONSTRAINT check_avg_entropy_range 
    CHECK (avg_entropy >= 0 AND avg_entropy <= 1),
    ADD CONSTRAINT check_unique_batches_positive 
    CHECK (unique_batches >= 0);
