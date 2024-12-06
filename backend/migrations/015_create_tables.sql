-- Create sequences table with partitioning
CREATE TABLE IF NOT EXISTS sequences_partitioned (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    symbol INTEGER NOT NULL CHECK (symbol >= 0 AND symbol <= 3),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    entropy_value FLOAT,
    pattern_detected BOOLEAN DEFAULT FALSE,
    pattern_strength FLOAT DEFAULT 0.0,
    batch_id UUID NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

-- Create partitions for the last month and next month
CREATE TABLE IF NOT EXISTS sequences_partitioned_current PARTITION OF sequences_partitioned
    FOR VALUES FROM (CURRENT_DATE - INTERVAL '1 month')
    TO (CURRENT_DATE + INTERVAL '1 month');

-- Create indexes on commonly queried columns
CREATE INDEX IF NOT EXISTS idx_sequences_created_at ON sequences_partitioned USING BRIN (created_at);
CREATE INDEX IF NOT EXISTS idx_sequences_batch_id ON sequences_partitioned USING HASH (batch_id);
CREATE INDEX IF NOT EXISTS idx_sequences_entropy ON sequences_partitioned USING BTREE (entropy_value);

-- Create materialized view for analytics
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_sequence_analytics AS
SELECT
    gen_random_uuid() as id,
    date_trunc('hour', created_at) as time_bucket,
    COUNT(*) as sequence_count,
    AVG(entropy_value) as avg_entropy,
    jsonb_build_object(
        'detected', COUNT(*) FILTER (WHERE pattern_detected),
        'not_detected', COUNT(*) FILTER (WHERE NOT pattern_detected)
    ) as pattern_distribution,
    COUNT(DISTINCT batch_id) as unique_batches,
    AVG(pattern_strength) as avg_confidence,
    COUNT(DISTINCT metadata->>'seed') as unique_seeds
FROM sequences_partitioned
GROUP BY date_trunc('hour', created_at);

-- Create index on materialized view
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_sequence_analytics_time_bucket 
ON mv_sequence_analytics (time_bucket);

-- Function to refresh materialized view
CREATE OR REPLACE FUNCTION refresh_sequence_analytics()
RETURNS void AS $$
DECLARE
    is_populated boolean;
BEGIN
    SELECT EXISTS (SELECT 1 FROM mv_sequence_analytics LIMIT 1) INTO is_populated;
    
    IF is_populated THEN
        REFRESH MATERIALIZED VIEW CONCURRENTLY mv_sequence_analytics;
    ELSE
        REFRESH MATERIALIZED VIEW mv_sequence_analytics;
    END IF;
END;
$$ LANGUAGE plpgsql;
