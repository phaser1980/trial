-- Real-time pattern analytics views
CREATE MATERIALIZED VIEW pattern_analysis_summary AS
WITH recent_patterns AS (
    SELECT 
        dp.*,
        pd.entropy,
        pd.seedtype,
        pd.transitions
    FROM discovered_patterns dp
    LEFT JOIN patterndata pd ON dp.pattern = pd.pattern
    WHERE dp.created_at >= NOW() - INTERVAL '3 hours'
),
pattern_metrics AS (
    SELECT 
        pattern,
        COUNT(*) as occurrence_count,
        AVG(entropy) as avg_entropy,
        MAX(frequency) as max_frequency,
        array_agg(DISTINCT seedtype) as detected_seedtypes,
        MAX(created_at) as last_seen
    FROM recent_patterns
    GROUP BY pattern
),
transition_analysis AS (
    SELECT 
        pattern,
        jsonb_object_agg(
            COALESCE(transitions, '{}'),
            COUNT(*)
        ) as transition_patterns
    FROM recent_patterns
    GROUP BY pattern
)
SELECT 
    pm.*,
    ta.transition_patterns,
    CASE 
        WHEN pm.avg_entropy < 0.3 THEN 'High Predictability'
        WHEN pm.avg_entropy < 0.7 THEN 'Medium Predictability'
        ELSE 'Low Predictability'
    END as predictability_class
FROM pattern_metrics pm
JOIN transition_analysis ta ON pm.pattern = ta.pattern;

-- Create index for better refresh performance
CREATE INDEX idx_pattern_analysis_time 
ON discovered_patterns(created_at, pattern);

-- Create function to refresh view
CREATE OR REPLACE FUNCTION refresh_pattern_analytics()
RETURNS void AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY pattern_analysis_summary;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to refresh view on pattern updates
CREATE OR REPLACE FUNCTION trigger_pattern_analytics_refresh()
RETURNS TRIGGER AS $$
BEGIN
    -- Refresh after 10 new patterns or 5 minutes, whichever comes first
    IF (SELECT COUNT(*) FROM discovered_patterns 
        WHERE created_at > (SELECT MAX(last_seen) FROM pattern_analysis_summary)) >= 10 
        OR NOT EXISTS (
            SELECT 1 FROM pattern_analysis_summary 
            WHERE last_seen > NOW() - INTERVAL '5 minutes'
        )
    THEN
        PERFORM refresh_pattern_analytics();
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER refresh_pattern_analytics_trigger
AFTER INSERT ON discovered_patterns
FOR EACH STATEMENT
EXECUTE FUNCTION trigger_pattern_analytics_refresh();

-- Create view for model performance in pattern detection
CREATE MATERIALIZED VIEW model_pattern_performance AS
WITH pattern_predictions AS (
    SELECT 
        mp.model_name,
        dp.pattern,
        mp.was_correct,
        mp.confidence,
        mp.created_at
    FROM model_predictions mp
    JOIN sequences s ON mp.sequence_id = s.id
    JOIN discovered_patterns dp ON dp.created_at <= mp.created_at 
        AND dp.last_occurrence >= mp.created_at
    WHERE mp.created_at >= NOW() - INTERVAL '3 hours'
)
SELECT 
    model_name,
    pattern,
    COUNT(*) as total_predictions,
    SUM(CASE WHEN was_correct THEN 1 ELSE 0 END)::float / COUNT(*) as accuracy,
    AVG(confidence) as avg_confidence,
    CORR(CASE WHEN was_correct THEN 1 ELSE 0 END, confidence) as confidence_correlation
FROM pattern_predictions
GROUP BY model_name, pattern;
