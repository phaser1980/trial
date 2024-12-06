-- Function to reset game state
CREATE OR REPLACE FUNCTION reset_game_state()
RETURNS void AS $$
BEGIN
    -- Truncate the partitioned sequences table (this will cascade to all partitions)
    TRUNCATE TABLE sequences_partitioned CASCADE;
    
    -- Reset the materialized view
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_sequence_analytics;
    
    -- Clear any model predictions
    TRUNCATE TABLE model_predictions CASCADE;
    
    -- Notify listeners that game state has been reset
    NOTIFY game_state_change, 'reset';
END;
$$ LANGUAGE plpgsql;

-- Function to add new sequence with automatic analysis
CREATE OR REPLACE FUNCTION add_sequence_with_analysis(
    p_symbol INTEGER,
    p_batch_id UUID
)
RETURNS TABLE (
    id INTEGER,
    symbol INTEGER,
    entropy_value FLOAT,
    pattern_detected BOOLEAN,
    pattern_strength FLOAT
) AS $$
DECLARE
    new_sequence RECORD;
BEGIN
    -- Insert the new sequence
    INSERT INTO sequences_partitioned (symbol, batch_id)
    VALUES (p_symbol, p_batch_id)
    RETURNING * INTO new_sequence;
    
    -- Trigger analysis (this will be handled by the analyze_new_sequence trigger)
    
    -- Return the new sequence with analysis results
    RETURN QUERY
    SELECT 
        s.id,
        s.symbol,
        s.entropy_value,
        s.pattern_detected,
        s.pattern_strength
    FROM sequences_partitioned s
    WHERE s.id = new_sequence.id;
END;
$$ LANGUAGE plpgsql;
