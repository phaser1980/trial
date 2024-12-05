-- Add constraints to existing tables

-- Function to safely drop a constraint if it exists
CREATE OR REPLACE FUNCTION drop_constraint_if_exists(
    p_table_name VARCHAR, 
    p_constraint_name VARCHAR
) RETURNS VOID AS $$
BEGIN
    IF EXISTS (
        SELECT 1 
        FROM pg_constraint 
        WHERE conname = p_constraint_name
    ) THEN
        EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', p_table_name, p_constraint_name);
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Sequences table constraints
SELECT drop_constraint_if_exists('sequences', 'check_symbol_range');
SELECT drop_constraint_if_exists('sequences', 'check_created_at');
ALTER TABLE sequences
    ADD CONSTRAINT check_symbol_range 
    CHECK (symbol >= 0 AND symbol <= 3);

-- Model predictions constraints
SELECT drop_constraint_if_exists('model_predictions', 'check_confidence_score_range');
SELECT drop_constraint_if_exists('model_predictions', 'fk_sequence_id');
ALTER TABLE model_predictions
    ADD CONSTRAINT check_confidence_score_range 
    CHECK (confidence_score >= 0 AND confidence_score <= 1),
    ADD CONSTRAINT fk_sequence_id 
    FOREIGN KEY (sequence_id) REFERENCES sequences(id) ON DELETE CASCADE;

-- Pattern analysis constraints
SELECT drop_constraint_if_exists('pattern_analysis', 'check_entropy_range');
SELECT drop_constraint_if_exists('pattern_analysis', 'check_frequency_positive');
ALTER TABLE pattern_analysis
    ADD CONSTRAINT check_entropy_range 
    CHECK (entropy >= 0 AND entropy <= 100),
    ADD CONSTRAINT check_frequency_positive 
    CHECK (frequency >= 0);

-- Pattern analysis daily constraints
SELECT drop_constraint_if_exists('pattern_analysis_daily', 'check_total_sequences_positive');
SELECT drop_constraint_if_exists('pattern_analysis_daily', 'check_avg_entropy_range');
SELECT drop_constraint_if_exists('pattern_analysis_daily', 'check_unique_batches_positive');
ALTER TABLE pattern_analysis_daily
    ADD CONSTRAINT check_total_sequences_positive 
    CHECK (total_sequences >= 0),
    ADD CONSTRAINT check_avg_entropy_range 
    CHECK (avg_entropy >= 0 AND avg_entropy <= 100),
    ADD CONSTRAINT check_unique_batches_positive 
    CHECK (unique_batches >= 0);

-- Clean up the helper function
DROP FUNCTION IF EXISTS drop_constraint_if_exists;
