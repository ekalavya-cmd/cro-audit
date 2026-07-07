export interface ExtractStructureResult {
  structure: {
    h1: boolean;
    meta: {
      title: string;
      description: string;
    };
  };

  navLinks: {
    totalCount: number;
    topLevelCount: number;
    hasAboutLink: boolean;
  };

  images: {
    total: number;
    altCoverage: number;
  };

  cta: {
    count: number;
  };

  forms: {
    formCount: number;
    totalFields: number;
    requiredFields: number;
    requiredRatio: number;
  };

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

  conversionSignals: {
    urgency: boolean;
    incentives: boolean;
  };

  errorHandling: {
    hasErrorHandling: boolean;
  };
}
