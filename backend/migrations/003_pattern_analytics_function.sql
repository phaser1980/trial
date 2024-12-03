CREATE OR REPLACE FUNCTION update_daily_analytics()
RETURNS TRIGGER AS
$BODY$
DECLARE
    curr_date DATE;
BEGIN
    curr_date := NEW.created_at::date;
    
    INSERT INTO pattern_analysis_daily (
        analysis_date,
        total_sequences,
        avg_entropy,
        transition_patterns,
        unique_batches
    )
    SELECT 
        curr_date,
        COUNT(*),
        AVG(entropy_value),
        jsonb_build_object(
            'transitions',
            jsonb_agg(DISTINCT transitions)
        ),
        COUNT(DISTINCT batch_id)
    FROM sequences
    WHERE created_at::date = curr_date
    ON CONFLICT (analysis_date) DO UPDATE
    SET 
        total_sequences = EXCLUDED.total_sequences,
        avg_entropy = EXCLUDED.avg_entropy,
        transition_patterns = EXCLUDED.transition_patterns,
        unique_batches = EXCLUDED.unique_batches,
        updated_at = CURRENT_TIMESTAMP;
    
    RETURN NEW;
END;
$BODY$
LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_daily_analytics ON sequences;
CREATE TRIGGER trg_update_daily_analytics
    AFTER INSERT ON sequences
    FOR EACH ROW
    EXECUTE FUNCTION update_daily_analytics();
