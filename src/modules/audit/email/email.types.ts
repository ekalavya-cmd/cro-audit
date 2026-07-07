import { Recommendation } from '../types/index';

export type { Recommendation };

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
}

export interface AuditEmailData {
  url: string;
  mode?: 'seo' | 'uxui' | 'full';
  score: number;
  grade: string;
  label: string;
  breakdown: Record<string, unknown>;
  metrics?: Record<string, string | number>;
  quickWins: Array<{ issue: string; impact: string }> | string[];
  recommendations?: Recommendation[];
  criticalIssueCount: number;
  message: string;
  timestamp: string;
}
