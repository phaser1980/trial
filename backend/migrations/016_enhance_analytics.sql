-- Migration: 016_enhance_analytics.sql

-- Step 1: Create transition matrix calculation function
CREATE OR REPLACE FUNCTION calculate_transition_matrix(batch_id_param UUID)
RETURNS JSONB AS $$
DECLARE
    result JSONB;
BEGIN
    WITH symbol_transitions AS (
        SELECT 
            symbol as from_symbol,
            LEAD(symbol) OVER (ORDER BY created_at) as to_symbol,
            created_at
        FROM sequences_partitioned
        WHERE batch_id = batch_id_param
        ORDER BY created_at
    ),
    transition_counts AS (
        SELECT 
            from_symbol,
            to_symbol,
            COUNT(*) as transition_count,
            COUNT(*) FILTER (WHERE pattern_detected)::float / NULLIF(COUNT(*), 0) as pattern_confidence
        FROM symbol_transitions st
        LEFT JOIN sequences_partitioned sp ON sp.batch_id = batch_id_param
            AND sp.created_at = st.created_at
        WHERE to_symbol IS NOT NULL
        GROUP BY from_symbol, to_symbol
    ),
    transition_probabilities AS (
        SELECT 
            from_symbol,
            to_symbol,
            transition_count::float / SUM(transition_count) OVER (PARTITION BY from_symbol) as probability,
            pattern_confidence
        FROM transition_counts
    )
    SELECT jsonb_build_object(
        'matrix', jsonb_object_agg(
            from_symbol::text || '_' || to_symbol::text,
            jsonb_build_object(
                'probability', ROUND(probability::numeric, 4),
                'confidence', ROUND(pattern_confidence::numeric, 4)
            )
        ),
        'metadata', jsonb_build_object(
            'batch_id', batch_id_param,
            'calculated_at', CURRENT_TIMESTAMP,
            'total_transitions', (SELECT COUNT(*) FROM symbol_transitions WHERE to_symbol IS NOT NULL)
        )
    ) INTO result
    FROM transition_probabilities;

    RETURN result;
END;
$$ LANGUAGE plpgsql;

-- Step 2: Create a function to analyze transition patterns
CREATE OR REPLACE FUNCTION analyze_transition_patterns(batch_id_param UUID)
RETURNS JSONB AS $$
DECLARE
    transitions JSONB;
    pattern_strength FLOAT;
BEGIN
    -- Get transition matrix
    SELECT calculate_transition_matrix(batch_id_param) INTO transitions;
    
    -- Calculate pattern strength based on transition probabilities
    WITH matrix_data AS (
        SELECT 
            (jsonb_each_text(transitions->'matrix')).value::jsonb->'probability' as prob
    )
    SELECT 
        -- Higher variance in probabilities indicates stronger patterns
        VARIANCE(prob::text::float) * 100 INTO pattern_strength 
    FROM matrix_data;

    RETURN jsonb_build_object(
        'transitions', transitions,
        'pattern_strength', ROUND(pattern_strength::numeric, 4),
        'analysis', jsonb_build_object(
            'has_strong_pattern', pattern_strength > 0.1,
            'confidence_level', 
            CASE 
                WHEN pattern_strength > 0.2 THEN 'high'
                WHEN pattern_strength > 0.1 THEN 'medium'
                ELSE 'low'
            END
        )
    );
END;
$$ LANGUAGE plpgsql;

-- Step 3: Create materialized view for enhanced analytics
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_enhanced_sequence_analytics AS
WITH batch_analytics AS (
    SELECT 
        batch_id,
        analyze_transition_patterns(batch_id) as pattern_analysis,
        AVG(entropy_value) as avg_entropy,
        COUNT(*) as sequence_length
    FROM sequences_partitioned
    GROUP BY batch_id
)
SELECT 
    gen_random_uuid() as id,
    batch_id,
    pattern_analysis,
    avg_entropy,
    sequence_length,
    CURRENT_TIMESTAMP as calculated_at
FROM batch_analytics;

-- Create index on the new materialized view
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_enhanced_sequence_analytics_batch_id 
ON mv_enhanced_sequence_analytics (batch_id);

-- Step 4: Create refresh function for the new materialized view
CREATE OR REPLACE FUNCTION refresh_enhanced_sequence_analytics()
RETURNS void AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_enhanced_sequence_analytics;
END;
$$ LANGUAGE plpgsql;

-- Schedule regular refresh (every hour)
SELECT cron.schedule(
    'refresh_enhanced_analytics_hourly',
    '30 * * * *',  -- 30 minutes past every hour
    $$SELECT refresh_enhanced_sequence_analytics()$$
);
