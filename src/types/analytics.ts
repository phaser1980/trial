// Database-driven analytics types
export interface SequenceAnalytics {
  time_bucket: string;
  sequence_count: number;
  avg_entropy: number;
  pattern_distribution: {
    detected: number;
    not_detected: number;
  };
  unique_batches: number;
  model_type?: string;
  avg_confidence?: number;
  unique_seeds?: number;
}

export interface RNGPattern {
  confidence: number;
  potential_seed: number;
  match_quality: 'STRONG' | 'MODERATE' | 'WEAK';
}

export interface SequenceAnalysis {
  id: number;
  symbol: number;
  created_at: string;
  entropy_value: number;
  pattern_detected: boolean;
  pattern_strength: number;
  rng_analysis: {
    lcg_analysis: RNGPattern[];
    xorshift_analysis: RNGPattern[];
    msws_analysis: RNGPattern[];
  };
}

export interface AnalyticsResponse {
  sequences: SequenceAnalysis[];
  metadata: {
    total_count: number;
    patterns_detected: number;
  };
}
