-- Add constraints and validation rules

-- Sequences table constraints
ALTER TABLE sequences
    ADD CONSTRAINT check_symbol_range 
    CHECK (symbol >= 0 AND symbol <= 3),
    ADD CONSTRAINT check_created_at 
    CHECK (created_at <= CURRENT_TIMESTAMP);

-- Model predictions constraints
ALTER TABLE model_predictions
    ADD CONSTRAINT check_confidence_range 
    CHECK (confidence >= 0 AND confidence <= 1),
    ADD CONSTRAINT check_prediction_symbol 
    CHECK (predicted_symbol >= 0 AND predicted_symbol <= 3),
    ADD CONSTRAINT fk_sequence_id 
    FOREIGN KEY (sequence_id) REFERENCES sequences(id) ON DELETE CASCADE;

-- Pattern data constraints
ALTER TABLE patterndata
    ADD CONSTRAINT check_entropy_range 
    CHECK (entropy >= 0 AND entropy <= 1),
    ADD CONSTRAINT check_seedtype 
    CHECK (seedtype IN ('linear', 'multiplicative', 'xorshift', 'mersenne', 'unknown'));

-- Model performance constraints
ALTER TABLE model_performance
    ADD CONSTRAINT check_accuracy_range 
    CHECK (accuracy >= 0 AND accuracy <= 1),
    ADD CONSTRAINT check_confidence_calibration_range 
    CHECK (confidence_calibration >= 0 AND confidence_calibration <= 1),
    ADD CONSTRAINT check_sample_size_positive 
    CHECK (sample_size > 0);

-- Add constraints to LSTM-related tables
ALTER TABLE lstm_models
    ADD CONSTRAINT check_training_status 
    CHECK (training_status IN (true, false));

ALTER TABLE lstm_training_metrics
    ADD CONSTRAINT check_loss_positive 
    CHECK (loss >= 0),
    ADD CONSTRAINT check_epochs_positive 
    CHECK (epochs > 0),
    ADD CONSTRAINT check_validation_accuracy_range 
    CHECK (validation_accuracy >= 0 AND validation_accuracy <= 1);

-- Add constraints to Monte Carlo tables
ALTER TABLE monte_carlo_simulations
    ADD CONSTRAINT check_iterations_positive 
    CHECK (num_iterations > 0);

ALTER TABLE monte_carlo_outcomes
    ADD CONSTRAINT check_probability_range 
    CHECK (probability >= 0 AND probability <= 1),
    ADD CONSTRAINT check_entropy_range 
    CHECK (entropy >= 0 AND entropy <= 1);

-- Add constraints to HMM tables
ALTER TABLE hmm_training
    ADD CONSTRAINT check_convergence_range 
    CHECK (convergence_score >= 0 AND convergence_score <= 1),
    ADD CONSTRAINT check_iterations_positive 
    CHECK (iterations > 0);

-- Create a function to validate JSON structure
CREATE OR REPLACE FUNCTION validate_json_structure(data jsonb, required_keys text[])
RETURNS boolean AS $$
BEGIN
    FOR i IN 1..array_length(required_keys, 1) LOOP
        IF NOT data ? required_keys[i] THEN
            RETURN false;
        END IF;
    END LOOP;
    RETURN true;
END;
$$ LANGUAGE plpgsql;

-- Add JSON validation constraints
ALTER TABLE lstm_models
    ADD CONSTRAINT valid_model_config 
    CHECK (validate_json_structure(model_config, ARRAY['layers', 'optimizer', 'loss']));

ALTER TABLE monte_carlo_simulations
    ADD CONSTRAINT valid_simulation_params 
    CHECK (validate_json_structure(simulation_params, ARRAY['iterations', 'confidence_level']));

-- Add trigger for automatic timestamp updates
CREATE OR REPLACE FUNCTION update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.created_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply timestamp trigger to relevant tables
CREATE TRIGGER update_timestamp_trigger
    BEFORE INSERT ON sequences
    FOR EACH ROW
    EXECUTE FUNCTION update_timestamp();

-- Add the same trigger to other tables that need it
DO $$
DECLARE
    table_name text;
BEGIN
    FOR table_name IN 
        SELECT tablename 
        FROM pg_tables 
        WHERE schemaname = 'public' 
        AND tablename LIKE '%predictions'
    LOOP
        EXECUTE format('
            CREATE TRIGGER update_timestamp_trigger
            BEFORE INSERT ON %I
            FOR EACH ROW
            EXECUTE FUNCTION update_timestamp();
        ', table_name);
    END LOOP;
END $$;
