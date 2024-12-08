// Core symbol definitions
export enum Symbol {
  Heart = 0,
  Diamond = 1,
  Club = 2,
  Spade = 3
}

export const SYMBOL_NAMES: { [key in Symbol]: string } = {
  [Symbol.Heart]: '♥️ Heart',
  [Symbol.Diamond]: '♦️ Diamond',
  [Symbol.Club]: '♣️ Club',
  [Symbol.Spade]: '♠️ Spade'
};

// Type guards for basic validation
export function isNonNullObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function hasRequiredProperty<T extends string>(
  obj: Record<string, unknown>,
  prop: T,
  type: 'string' | 'number' | 'boolean'
): obj is Record<string, unknown> & Record<T, unknown> {
  return typeof obj[prop] === type;
}

// Prediction types and validation
export interface PredictionData {
  predicted_symbol: number;
  details?: {
    confidence?: number;
    pattern?: string;
    frequency?: number;
    [key: string]: unknown;
  };
}

export function isPredictionData(value: unknown): value is PredictionData {
  if (!isNonNullObject(value)) {
    console.error('PredictionData must be an object:', value);
    return false;
  }

  if (!hasRequiredProperty(value, 'predicted_symbol', 'number')) {
    console.error('PredictionData missing predicted_symbol:', value);
    return false;
  }

  if (value.details !== undefined && !isNonNullObject(value.details)) {
    console.error('PredictionData details must be an object:', value);
    return false;
  }

  return true;
}

export interface ModelPrediction {
  model_name: string;
  model_type: string;
  prediction_data: PredictionData;
  confidence_score: number;
}

export function isModelPrediction(value: unknown): value is ModelPrediction {
  if (!isNonNullObject(value)) {
    console.error('ModelPrediction must be an object:', value);
    return false;
  }

  const required: [string, 'string' | 'number'][] = [
    ['model_name', 'string'],
    ['model_type', 'string'],
    ['confidence_score', 'number']
  ];

  for (const [prop, type] of required) {
    if (!hasRequiredProperty(value, prop, type)) {
      console.error(`ModelPrediction missing ${prop}:`, value);
      return false;
    }
  }

  if (!isNonNullObject(value.prediction_data)) {
    console.error('ModelPrediction missing prediction_data:', value);
    return false;
  }

  return isPredictionData(value.prediction_data);
}

// Frontend types with strict validation
export interface LocalPredictionData {
  predicted_symbol: Symbol;
  details?: {
    confidence?: number;
    pattern?: string;
    frequency?: number;
    [key: string]: unknown;
  };
}

export interface LocalModelPrediction {
  model_name: string;
  model_type: string;
  prediction_data: LocalPredictionData;
  confidence_score: number;
}

export interface LocalSequenceAnalysis {
  id: number;
  symbol: Symbol;
  timestamp: string;
  entropy_value: number;
  pattern_detected: boolean;
  model_predictions: LocalModelPrediction[];
}

// Safe transformation functions
export function transformPredictionData(data: PredictionData): LocalPredictionData | null {
  const symbol = data.predicted_symbol;
  if (!(symbol in Symbol)) {
    console.error('Invalid symbol in prediction data:', symbol);
    return null;
  }

  return {
    predicted_symbol: symbol as Symbol,
    details: data.details
  };
}

export function transformPrediction(pred: unknown): LocalModelPrediction | null {
  if (!isModelPrediction(pred)) {
    return null;
  }

  const predictionData = transformPredictionData(pred.prediction_data);
  if (!predictionData) {
    return null;
  }

  return {
    model_name: pred.model_name,
    model_type: pred.model_type,
    prediction_data: predictionData,
    confidence_score: pred.confidence_score
  };
}

export function transformSequence(data: unknown): LocalSequenceAnalysis | null {
  if (!isNonNullObject(data)) {
    console.error('Sequence must be an object:', data);
    return null;
  }

  const seq = data as Record<string, unknown>;
  const required: [string, 'string' | 'number' | 'boolean'][] = [
    ['id', 'number'],
    ['symbol', 'number'],
    ['created_at', 'string'],
    ['entropy_value', 'number'],
    ['pattern_detected', 'boolean']
  ];

  for (const [prop, type] of required) {
    if (!hasRequiredProperty(seq, prop, type)) {
      console.error(`Sequence missing ${prop}:`, seq);
      return null;
    }
  }

  const symbol = seq.symbol as number;
  if (!(symbol in Symbol)) {
    console.error('Invalid symbol in sequence:', symbol);
    return null;
  }

  const predictions = Array.isArray(seq.model_predictions)
    ? seq.model_predictions
        .map(transformPrediction)
        .filter((p): p is LocalModelPrediction => p !== null)
    : [];

  return {
    id: seq.id as number,
    symbol: symbol as Symbol,
    timestamp: seq.created_at as string,
    entropy_value: seq.entropy_value as number,
    pattern_detected: seq.pattern_detected as boolean,
    model_predictions: predictions
  };
}

// Progress tracking
export interface BatchProgress {
  status: 'idle' | 'processing' | 'complete' | 'error';
  current: number;
  total: number;
  progress: number;
  results?: LocalModelPrediction[];
  error?: string;
}
