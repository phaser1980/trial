-- Add RNG analysis columns to sequences table
ALTER TABLE sequences
  ADD COLUMN IF NOT EXISTS transitions jsonb,
  ADD COLUMN IF NOT EXISTS pattern_strength float;

-- Add RNG-specific columns to model_predictions
ALTER TABLE model_predictions
  ADD COLUMN IF NOT EXISTS rng_seed integer,
  ADD COLUMN IF NOT EXISTS rng_type varchar(50);

-- Create index for pattern analysis
CREATE INDEX IF NOT EXISTS idx_sequences_pattern_strength 
  ON sequences(pattern_strength);

-- Create index for RNG seed discovery
CREATE INDEX IF NOT EXISTS idx_model_predictions_rng 
  ON model_predictions(rng_type, rng_seed)
  WHERE model_type = 'rng_seed_discovery';

-- Create view for RNG analysis summary
CREATE OR REPLACE VIEW rng_analysis_summary AS
SELECT 
  s.created_at::date as analysis_date,
  COUNT(*) as total_sequences,
  AVG(s.entropy_value) as avg_entropy,
  COUNT(DISTINCT mp.rng_seed) as unique_seeds_detected,
  AVG(mp.confidence_score) as avg_confidence
FROM sequences s
LEFT JOIN model_predictions mp 
  ON mp.model_type = 'rng_seed_discovery'
  AND mp.created_at::date = s.created_at::date
GROUP BY s.created_at::date
ORDER BY s.created_at::date DESC;

-- Create function to update transitions
CREATE OR REPLACE FUNCTION update_sequence_transitions()
RETURNS trigger AS $$
BEGIN
  WITH recent_symbols AS (
    SELECT symbol 
    FROM sequences 
    WHERE created_at > NEW.created_at - interval '1 minute'
    ORDER BY created_at DESC 
    LIMIT 10
  ),
  transition_counts AS (
    SELECT 
      jsonb_object_agg(
        concat(lag(symbol) OVER (ORDER BY created_at), '->', symbol),
        COUNT(*)
      ) as transitions
    FROM recent_symbols
  )
  UPDATE sequences 
  SET transitions = (SELECT transitions FROM transition_counts)
  WHERE id = NEW.id;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for transitions
DROP TRIGGER IF EXISTS trg_update_transitions ON sequences;
CREATE TRIGGER trg_update_transitions
  AFTER INSERT ON sequences
  FOR EACH ROW
  EXECUTE FUNCTION update_sequence_transitions();
