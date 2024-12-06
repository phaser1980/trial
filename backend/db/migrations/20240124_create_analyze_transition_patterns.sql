-- Function to analyze transition patterns in a sequence batch
CREATE OR REPLACE FUNCTION analyze_transition_patterns(batch_id UUID)
RETURNS JSON AS $$
DECLARE
    result JSON;
BEGIN
    WITH ordered_sequence AS (
        SELECT 
            symbol,
            LEAD(symbol) OVER (ORDER BY (metadata->>'position')::int) as next_symbol,
            metadata->>'timestamp' as timestamp
        FROM sequences
        WHERE batch_id = $1
        ORDER BY (metadata->>'position')::int
    ),
    transition_counts AS (
        SELECT 
            symbol as from_symbol,
            next_symbol as to_symbol,
            COUNT(*) as transition_count
        FROM ordered_sequence
        WHERE next_symbol IS NOT NULL
        GROUP BY symbol, next_symbol
    ),
    total_transitions AS (
        SELECT SUM(transition_count) as total
        FROM transition_counts
    ),
    transition_probabilities AS (
        SELECT 
            from_symbol,
            to_symbol,
            transition_count,
            (transition_count::float / total::float) as probability
        FROM transition_counts, total_transitions
    ),
    pattern_stats AS (
        SELECT 
            json_build_object(
                'transition_matrix', json_agg(
                    json_build_object(
                        'from', from_symbol,
                        'to', to_symbol,
                        'count', transition_count,
                        'probability', round(probability::numeric, 4)
                    )
                ),
                'total_transitions', (SELECT total FROM total_transitions),
                'timestamp', now()
            ) as stats
        FROM transition_probabilities
    )
    SELECT stats INTO result FROM pattern_stats;

    -- If no transitions found, return empty result
    IF result IS NULL THEN
        result := json_build_object(
            'transition_matrix', '[]'::json,
            'total_transitions', 0,
            'timestamp', now()
        );
    END IF;

    RETURN result;
END;
$$ LANGUAGE plpgsql;
