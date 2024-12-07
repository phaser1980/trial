-- Add seed comparison and Monte Carlo simulation functions

-- Function to calculate sequence similarity score
CREATE OR REPLACE FUNCTION calculate_sequence_similarity(
    seq1 INTEGER[],
    seq2 INTEGER[]
) RETURNS FLOAT AS $$
DECLARE
    match_count INTEGER := 0;
    min_length INTEGER;
BEGIN
    min_length := LEAST(array_length(seq1, 1), array_length(seq2, 1));
    
    FOR i IN 1..min_length LOOP
        IF seq1[i] = seq2[i] THEN
            match_count := match_count + 1;
        END IF;
    END LOOP;

    RETURN match_count::FLOAT / min_length;
END;
$$ LANGUAGE plpgsql;

-- Function to compare sequences generated by different seeds
CREATE OR REPLACE FUNCTION compare_seed_sequences(
    batch_id_param UUID,
    test_seed INTEGER,
    sequence_length INTEGER DEFAULT 100,
    algorithm TEXT DEFAULT 'LCG'
) RETURNS JSONB AS $$
DECLARE
    original_sequence INTEGER[];
    test_sequence INTEGER[];
    similarity_score FLOAT;
    transition_similarity FLOAT;
BEGIN
    -- Get original sequence
    SELECT array_agg(symbol ORDER BY created_at)
    INTO original_sequence
    FROM sequences_partitioned
    WHERE batch_id = batch_id_param
    LIMIT sequence_length;

    -- Generate test sequence using provided seed
    WITH RECURSIVE test_gen AS (
        -- Initial value based on algorithm
        SELECT
            CASE algorithm
                WHEN 'LCG' THEN (1664525 * test_seed + 1013904223) % (2^32)
                ELSE test_seed
            END as value,
            1 as position
        UNION ALL
        SELECT
            CASE algorithm
                WHEN 'LCG' THEN (1664525 * value + 1013904223) % (2^32)
                ELSE (value << 13) # (value >> 17) # (value << 5)
            END,
            position + 1
        FROM test_gen
        WHERE position < sequence_length
    )
    SELECT array_agg(value % 4 ORDER BY position)
    INTO test_sequence
    FROM test_gen;

    -- Calculate similarity scores
    similarity_score := calculate_sequence_similarity(original_sequence, test_sequence);
    
    -- Calculate transition matrix similarity
    WITH original_transitions AS (
        SELECT 
            symbol as from_symbol,
            LEAD(symbol) OVER (ORDER BY created_at) as to_symbol,
            COUNT(*) OVER (PARTITION BY symbol, LEAD(symbol) OVER (ORDER BY created_at)) as count
        FROM sequences_partitioned
        WHERE batch_id = batch_id_param
    ),
    test_transitions AS (
        SELECT 
            t1.value % 4 as from_symbol,
            t2.value % 4 as to_symbol,
            COUNT(*) as count
        FROM (
            SELECT value, position FROM test_gen
        ) t1
        JOIN (
            SELECT value, position FROM test_gen
        ) t2 ON t2.position = t1.position + 1
        GROUP BY t1.value % 4, t2.value % 4
    )
    SELECT COALESCE(
        CORR(
            original_transitions.count::float,
            test_transitions.count::float
        ),
        0
    )
    INTO transition_similarity
    FROM original_transitions
    FULL OUTER JOIN test_transitions
        ON original_transitions.from_symbol = test_transitions.from_symbol
        AND original_transitions.to_symbol = test_transitions.to_symbol;

    RETURN jsonb_build_object(
        'seed', test_seed,
        'algorithm', algorithm,
        'sequence_similarity', ROUND(similarity_score::numeric, 4),
        'transition_similarity', ROUND(transition_similarity::numeric, 4),
        'confidence_score', ROUND(((similarity_score + transition_similarity) / 2)::numeric, 4),
        'metadata', jsonb_build_object(
            'original_length', array_length(original_sequence, 1),
            'test_length', array_length(test_sequence, 1),
            'timestamp', CURRENT_TIMESTAMP
        )
    );
END;
$$ LANGUAGE plpgsql;

-- Function to run Monte Carlo simulation for seed discovery
CREATE OR REPLACE FUNCTION monte_carlo_seed_search(
    batch_id_param UUID,
    num_simulations INTEGER DEFAULT 1000,
    algorithm TEXT DEFAULT 'LCG'
) RETURNS JSONB AS $$
DECLARE
    best_seeds JSONB[];
    current_result JSONB;
    min_seed INTEGER := 1;
    max_seed INTEGER := 2^31 - 1;
    test_seed INTEGER;
BEGIN
    FOR i IN 1..num_simulations LOOP
        -- Generate random seed within range
        test_seed := min_seed + floor(random() * (max_seed - min_seed + 1));
        
        -- Compare sequences
        SELECT compare_seed_sequences(batch_id_param, test_seed, 100, algorithm)
        INTO current_result;

        -- Store result if confidence score is high enough
        IF (current_result->>'confidence_score')::float > 0.7 THEN
            best_seeds := array_append(best_seeds, current_result);
        END IF;

        -- Early exit if we found a very good match
        IF (current_result->>'confidence_score')::float > 0.95 THEN
            EXIT;
        END IF;
    END LOOP;

    RETURN jsonb_build_object(
        'best_matches', COALESCE(jsonb_agg(s ORDER BY (s->>'confidence_score')::float DESC), '[]'::jsonb),
        'simulation_count', i,
        'algorithm', algorithm,
        'metadata', jsonb_build_object(
            'batch_id', batch_id_param,
            'timestamp', CURRENT_TIMESTAMP,
            'max_confidence', (
                SELECT MAX((s->>'confidence_score')::float)
                FROM unnest(best_seeds) s
            )
        )
    );
END;
$$ LANGUAGE plpgsql;