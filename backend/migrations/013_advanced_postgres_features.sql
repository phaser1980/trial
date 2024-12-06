-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS btree_gin;
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Partition sequences table by time
CREATE TABLE sequences_partitioned (
    id SERIAL,
    symbol INTEGER NOT NULL CHECK (symbol >= 0 AND symbol <= 3),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    entropy_value FLOAT,
    pattern_detected BOOLEAN DEFAULT FALSE,
    transitions JSONB,
    pattern_strength FLOAT,
    batch_id UUID DEFAULT gen_random_uuid(),
    metadata JSONB DEFAULT '{}'::jsonb
) PARTITION BY RANGE (created_at);

-- Create partitions for last 3 months and future month
CREATE TABLE sequences_partitioned_past3months 
    PARTITION OF sequences_partitioned 
    FOR VALUES FROM ('2023-10-01') TO ('2024-01-01');

CREATE TABLE sequences_partitioned_current 
    PARTITION OF sequences_partitioned 
    FOR VALUES FROM ('2024-01-01') TO ('2024-02-01');

CREATE TABLE sequences_partitioned_future 
    PARTITION OF sequences_partitioned 
    FOR VALUES FROM ('2024-02-01') TO ('2024-03-01');

-- Create materialized view for quick analytics
CREATE MATERIALIZED VIEW mv_sequence_analytics AS
WITH pattern_stats AS (
    SELECT 
        date_trunc('hour', created_at) as time_bucket,
        COUNT(*) as sequence_count,
        AVG(entropy_value) as avg_entropy,
        jsonb_object_agg(
            CASE 
                WHEN pattern_detected THEN 'detected'
                ELSE 'not_detected'
            END,
            COUNT(*)
        ) as pattern_distribution,
        array_agg(DISTINCT batch_id) as batch_ids
    FROM sequences
    GROUP BY date_trunc('hour', created_at)
),
model_stats AS (
    SELECT 
        date_trunc('hour', mp.created_at) as time_bucket,
        mp.model_type,
        AVG(mp.confidence_score) as avg_confidence,
        COUNT(DISTINCT mp.rng_seed) as unique_seeds
    FROM model_predictions mp
    GROUP BY date_trunc('hour', mp.created_at), mp.model_type
)
SELECT 
    ps.time_bucket,
    ps.sequence_count,
    ps.avg_entropy,
    ps.pattern_distribution,
    array_length(ps.batch_ids, 1) as unique_batches,
    ms.model_type,
    ms.avg_confidence,
    ms.unique_seeds
FROM pattern_stats ps
LEFT JOIN model_stats ms ON ps.time_bucket = ms.time_bucket;

-- Create indexes on materialized view
CREATE INDEX idx_mv_sequence_analytics_time 
ON mv_sequence_analytics(time_bucket);

CREATE INDEX idx_mv_sequence_analytics_model 
ON mv_sequence_analytics(model_type);

-- Create function to refresh materialized view
CREATE OR REPLACE FUNCTION refresh_sequence_analytics()
RETURNS void AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_sequence_analytics;
END;
$$ LANGUAGE plpgsql;

-- Create trigger function for automatic analysis
CREATE OR REPLACE FUNCTION analyze_new_sequence()
RETURNS TRIGGER AS $$
DECLARE
    window_size INTEGER := 10;
    recent_symbols INTEGER[];
    transition_matrix JSONB;
    entropy FLOAT;
BEGIN
    -- Get recent symbols for this batch
    SELECT array_agg(symbol ORDER BY created_at DESC)
    INTO recent_symbols
    FROM sequences
    WHERE batch_id = NEW.batch_id
    ORDER BY created_at DESC
    LIMIT window_size;

    -- Calculate transition matrix
    WITH transitions AS (
        SELECT 
            symbol as from_symbol,
            lead(symbol) OVER (ORDER BY created_at) as to_symbol
        FROM sequences
        WHERE batch_id = NEW.batch_id
        AND created_at >= NOW() - INTERVAL '1 minute'
    )
    SELECT jsonb_object_agg(
        from_symbol || '_' || to_symbol,
        transition_count
    )
    INTO transition_matrix
    FROM (
        SELECT 
            from_symbol,
            to_symbol,
            COUNT(*) as transition_count
        FROM transitions
        WHERE to_symbol IS NOT NULL
        GROUP BY from_symbol, to_symbol
    ) t;

    -- Calculate entropy
    SELECT -1 * SUM(
        (COUNT(*) * 1.0 / window_size) * ln(COUNT(*) * 1.0 / window_size)
    ) / ln(4)  -- normalize by log(4) since we have 4 possible symbols
    INTO entropy
    FROM unnest(recent_symbols) as symbol
    GROUP BY symbol;

    -- Update the sequence with calculated values
    NEW.transitions := transition_matrix;
    NEW.entropy_value := entropy;
    
    -- Detect patterns based on entropy and transitions
    NEW.pattern_detected := 
        CASE 
            WHEN entropy < 0.5 AND jsonb_array_length(transition_matrix) < 8 THEN TRUE
            ELSE FALSE
        END;
    
    NEW.pattern_strength := 
        CASE 
            WHEN NEW.pattern_detected THEN 1 - entropy
            ELSE 0
        END;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for automatic analysis
CREATE TRIGGER tr_analyze_sequence
    BEFORE INSERT ON sequences
    FOR EACH ROW
    EXECUTE FUNCTION analyze_new_sequence();

-- Create job to refresh materialized view periodically
CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.schedule('refresh_sequence_analytics_hourly', '0 * * * *', 'SELECT refresh_sequence_analytics()');

-- Create specialized RNG pattern matching function
CREATE OR REPLACE FUNCTION match_rng_pattern(
    symbols INTEGER[],
    pattern_type TEXT DEFAULT 'LCG'  -- Linear Congruential Generator
) RETURNS TABLE (
    confidence FLOAT,
    potential_seed INTEGER,
    match_quality TEXT
) AS $$
DECLARE
    lcg_patterns JSONB;
    xorshift_patterns JSONB;
    msws_patterns JSONB;
BEGIN
    -- Define known RNG patterns
    lcg_patterns := '[
        {"seed": 1234, "sequence": [2,1,3,0,2,1], "frequency": 0.8},
        {"seed": 5678, "sequence": [0,2,1,3,1,2], "frequency": 0.7}
    ]'::jsonb;
    
    xorshift_patterns := '[
        {"seed": 12345, "sequence": [1,2,0,3,1,2], "frequency": 0.9},
        {"seed": 67890, "sequence": [3,1,2,0,2,1], "frequency": 0.85}
    ]'::jsonb;
    
    msws_patterns := '[
        {"seed": 11111, "sequence": [0,1,2,3,0,1], "frequency": 0.75},
        {"seed": 22222, "sequence": [2,3,0,1,2,3], "frequency": 0.7}
    ]'::jsonb;
    
    RETURN QUERY
    WITH pattern_matches AS (
        SELECT
            CASE pattern_type
                WHEN 'LCG' THEN p->>'seed'
                WHEN 'XORShift' THEN p->>'seed'
                WHEN 'MSWS' THEN p->>'seed'
            END::integer as seed,
            similarity(
                array_to_string(symbols, ','),
                p->>'sequence'
            ) as match_score,
            p->>'frequency' as known_frequency
        FROM jsonb_array_elements(
            CASE pattern_type
                WHEN 'LCG' THEN lcg_patterns
                WHEN 'XORShift' THEN xorshift_patterns
                WHEN 'MSWS' THEN msws_patterns
            END
        ) p
    )
    SELECT
        (match_score * known_frequency::float) as confidence,
        seed as potential_seed,
        CASE
            WHEN match_score >= 0.9 THEN 'STRONG'
            WHEN match_score >= 0.7 THEN 'MODERATE'
            ELSE 'WEAK'
        END as match_quality
    FROM pattern_matches
    WHERE match_score >= 0.5
    ORDER BY confidence DESC
    LIMIT 5;
END;
$$ LANGUAGE plpgsql;

-- Grant permissions
GRANT SELECT, INSERT ON sequences_partitioned TO PUBLIC;
GRANT SELECT ON mv_sequence_analytics TO PUBLIC;
GRANT EXECUTE ON FUNCTION analyze_new_sequence() TO PUBLIC;
GRANT EXECUTE ON FUNCTION match_rng_pattern(INTEGER[], TEXT) TO PUBLIC;
