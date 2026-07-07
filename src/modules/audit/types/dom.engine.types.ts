import type { CheckLinksResult } from './checkLinks.types';

// Shared fields used in both SEO and UX/UI modes
interface DomSharedFields {
  // Navigation — from checkLinks
  navLinks: {
    topLevelCount: number;
    totalCount: number;
    hasAboutLink: boolean;
  };
  // Images — from extractStructure
  images: {
    total: number;
    altCoverage: number;
  };
  // Trust signals — from extractStructure (isHttps used in both modes)
  trustSignals: {
    isHttps: boolean;
    testimonials: boolean;
    clientLogos: boolean;
    trustBadges: boolean;
    contactInfo: {
      phone: boolean;
      email: boolean;
      address: boolean;
    };
  };
  // Links — from checkLinks
  links: {
    summary: {
      broken: number;
      error: number;
      total: number;
      valid: number;
      redirects: number;
      redirectChain: number;
      avgClickDepth: number;
      orphanPages: number;
    };
    brokenLinks: CheckLinksResult['brokenLinks'];
    navigation: {
      internal: number;
      external: number;
    };
  };
}

// SEO mode fields
export type DomAnalysisResultSEO = DomSharedFields;

// UX/UI mode fields
export interface DomAnalysisResultUXUI extends DomSharedFields {
  url: string;
  heading: {
    h1: boolean;
  };
  // CTA — from extractStructure
  cta: {
    count: number;
  };
  // Forms — from extractStructure
  forms: {
    formCount: number;
    totalFields: number;
    requiredRatio: number;
  };
  // Error handling — from extractStructure
  errorHandling: {
    hasErrorHandling: boolean;
  };
  // Conversion signals — from extractStructure
  conversionSignals: {
    urgency: boolean;
    incentives: boolean;
  };
}

export type DomAnalysisResult<M extends 'seo' | 'uxui'> = M extends 'seo'
  ? DomAnalysisResultSEO
  : DomAnalysisResultUXUI;
