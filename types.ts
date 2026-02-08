
export interface AccelerationData {
  timestamp: number;
  x: number; // Transversal (Latéral)
  y: number; // Longitudinal
  z: number; // Vertical
  magnitude: number;
  pk?: number; // Point Kilométrique au moment de la mesure
}

export type PKDirection = 'croissant' | 'decroissant';
export type TrackType = 'LGV1' | 'LGV2' | 'V1' | 'V2' | '';

export interface AudioSettings {
  enabled: boolean;
  alertLA: boolean;
  alertLI: boolean;
  alertLAI: boolean;
  sessionEvents: boolean;
}

export interface SessionConfig {
  startPK: number;
  direction: PKDirection;
  track: TrackType;
  thresholdLA: number; // Alerte (S1) - 1.2 m/s² par défaut
  thresholdLI: number; // Intervention (S2) - 2.2 m/s² par défaut
  thresholdLAI: number; // Action Immédiate (S3) - 2.8 m/s² par défaut
  // Métadonnées
  operator: string;
  line: string;
  train: string;
  engineNumber: string;
  position: string;
  note: string;
}

export interface SessionStats extends SessionConfig {
  maxVertical: number;
  maxTransversal: number;
  avgMagnitude: number;
  duration: number;
  countLA: number;
  countLI: number;
  countLAI: number;
  startTime: number;
}

export interface GeminiAnalysis {
  activityType: string;
  intensityScore: number;
  observations: string[];
  recommendations: string;
  complianceLevel: 'Conforme' | 'Surveillance' | 'Critique';
  anomalousPKs: string[];
}

export interface SessionRecord {
  id: string;
  date: string;
  stats: SessionStats;
  data: AccelerationData[];
  analysis: GeminiAnalysis | null;
}
