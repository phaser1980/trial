-- Migrate data from sequences to sequences_partitioned
INSERT INTO sequences_partitioned (
    id,
    symbol,
    created_at,
    entropy_value,
    pattern_detected,
    transitions,
    pattern_strength,
    batch_id,
    metadata
)
SELECT 
    id,
    symbol,
    created_at,
    entropy_value,
    pattern_detected,
    transitions,
    pattern_strength,
    batch_id,
    metadata
FROM sequences;

-- Create function to manage partitions automatically
CREATE OR REPLACE FUNCTION manage_sequence_partitions()
RETURNS void AS $$
DECLARE
    partition_date DATE;
    partition_name TEXT;
    start_date TEXT;
    end_date TEXT;
BEGIN
    -- Create future partition if it doesn't exist
    partition_date := date_trunc('month', NOW() + interval '1 month')::date;
    partition_name := 'sequences_partitioned_' || to_char(partition_date, 'YYYY_MM');
    start_date := to_char(partition_date, 'YYYY-MM-DD');
    end_date := to_char(partition_date + interval '1 month', 'YYYY-MM-DD');
    
    IF NOT EXISTS (
        SELECT 1
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relname = partition_name
        AND n.nspname = 'public'
    ) THEN
        EXECUTE format(
            'CREATE TABLE %I PARTITION OF sequences_partitioned
            FOR VALUES FROM (%L) TO (%L)',
            partition_name, start_date, end_date
        );
        
        RAISE NOTICE 'Created new partition: %', partition_name;
    END IF;
    
    -- Drop old partitions (keep last 3 months)
    FOR partition_name IN (
        SELECT c.relname
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relname LIKE 'sequences_partitioned_%'
        AND n.nspname = 'public'
        AND c.relname < 'sequences_partitioned_' || 
            to_char(date_trunc('month', NOW() - interval '3 months'), 'YYYY_MM')
    )
    LOOP
        EXECUTE format('DROP TABLE %I', partition_name);
        RAISE NOTICE 'Dropped old partition: %', partition_name;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Schedule partition management
SELECT cron.schedule('manage_partitions_monthly', '0 0 1 * *', 'SELECT manage_sequence_partitions()');

-- Create indexes on the partitioned table
CREATE INDEX idx_sequences_partitioned_created_at 
ON sequences_partitioned(created_at);

CREATE INDEX idx_sequences_partitioned_batch_id 
ON sequences_partitioned(batch_id);

CREATE INDEX idx_sequences_partitioned_entropy 
ON sequences_partitioned(entropy_value);

-- Update sequences to use partitioned table
CREATE OR REPLACE VIEW sequences AS 
SELECT * FROM sequences_partitioned;
