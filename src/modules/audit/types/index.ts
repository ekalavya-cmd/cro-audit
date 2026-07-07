export interface AuditRequest {
  url: string;
  email?: string;
}

export interface ScoreBreakdown {
  visualClarity: number;
  mobileExperience: number;
  performance: number;
  accessibility: number;
  navigationIA: number;
  conversionOptimization: number;
  trust: number;
}

export interface Recommendation {
  category: keyof ScoreBreakdown;
  issue: string;
  recommendation: string;
  impact: 'High' | 'Medium' | 'Low';
  businessValue: string;
}

export interface AuditResult {
  url: string;
  overallScore: number;
  grade: string;
  breakdown: ScoreBreakdown;
  quickWins: string[];
  criticalIssues: string[];
  recommendations: Recommendation[];
  metrics: {
    bounceRate: string;
    conversion: string;
    engagement: string;
  };
  timestamp: string;
  message: string;
}

export interface SEOPerformanceDetail {
  lighthouseScore: number;
  lcp: string;
  cls: number;
  tti: string;
}

export interface SEONavigationDetail {
  brokenLinks: number;
  menuItems: number;
  avgClickDepth: number;
  orphanPages: number;
}

export interface SEOBreakdownItem {
  score: number;
  weight: number;
  contribution: number;
}

export interface SEOQuickWin {
  issue: string;
  message: string;
  fix: string;
  source: string;
  impact: 'medium' | 'low' | 'high';
}

export interface SEOResult {
  auditMode: 'seo';
  seoScore: number;
  grade: string;
  label: string;
  message: string;
  breakdown: {
    performance: SEOBreakdownItem;
    navigation: SEOBreakdownItem;
  };
  performanceDetail: SEOPerformanceDetail;
  navigationDetail: SEONavigationDetail;
  quickWins: SEOQuickWin[];
  criticalIssueCount: number;
  metrics: {
    bounceRate: string;
    conversion: string;
    engagement: string;
  };
  recommendations: Recommendation[];
}

export interface UXUIBreakdownItem {
  score: number;
  weight: number;
  contribution: number;
}

export interface AIRatings {
  value_proposition_clarity: number;
  cta_visibility: number;
  above_fold_clarity: number;
  whitespace_balance: number;
  design_consistency: number;
  typography_variation: number;
  cta_placement_quality: number;
  trust_visual_signals: number;
}

export interface UXUIQuickWin {
  issue: string;
  message: string;
  fix: string;
  source: string;
  impact: 'medium' | 'low' | 'high';
}

export interface UXUIResult {
  auditMode: 'uxui';
  uxuiScore: number;
  grade: string;
  label: string;
  message: string;
  breakdown: {
    visualClarity: UXUIBreakdownItem;
    conversionFlow: UXUIBreakdownItem;
    mobileExperience: UXUIBreakdownItem;
    trustCredibility: UXUIBreakdownItem;
    accessibility: UXUIBreakdownItem;
  };
  aiRatings: AIRatings;
  quickWins: UXUIQuickWin[];
  criticalIssueCount: number;
  metrics: {
    bounceRate: string;
    conversion: string;
    engagement: string;
  };
  recommendations: Recommendation[];
}

export interface FullAuditResult {
  auditMode: 'full';
  overall: number;
  grade: string;
  label: string;
  message: string;
  breakdown: ScoreBreakdown;
  quickWins: any[]; // Using any[] to match the flexible QuickWin structure
  criticalIssueCount: number;
  recommendations: Recommendation[];
  metrics: {
    bounceRate: string;
    conversion: string;
    engagement: string;
  };
  seoResult?: SEOResult;
  uxuiResult?: UXUIResult;
}
