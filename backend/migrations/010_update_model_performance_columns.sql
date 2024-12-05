-- Add any missing columns to model_performance table
DO $$ 
BEGIN
    -- Add accuracy column if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                  WHERE table_name = 'model_performance' AND column_name = 'accuracy') THEN
        ALTER TABLE model_performance ADD COLUMN accuracy FLOAT DEFAULT 0;
    END IF;

    -- Add confidence_calibration column if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                  WHERE table_name = 'model_performance' AND column_name = 'confidence_calibration') THEN
        ALTER TABLE model_performance ADD COLUMN confidence_calibration FLOAT DEFAULT 0;
    END IF;

    -- Add needs_retraining column if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                  WHERE table_name = 'model_performance' AND column_name = 'needs_retraining') THEN
        ALTER TABLE model_performance ADD COLUMN needs_retraining BOOLEAN DEFAULT FALSE;
    END IF;

    -- Add total_predictions column if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                  WHERE table_name = 'model_performance' AND column_name = 'total_predictions') THEN
        ALTER TABLE model_performance ADD COLUMN total_predictions INTEGER DEFAULT 0;
    END IF;

    -- Add correct_predictions column if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                  WHERE table_name = 'model_performance' AND column_name = 'correct_predictions') THEN
        ALTER TABLE model_performance ADD COLUMN correct_predictions INTEGER DEFAULT 0;
    END IF;
END $$;
