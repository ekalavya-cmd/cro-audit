export interface LinkResult {
  url: string;
  status: number | 'error';
  redirects: number;
  redirectChain: string[];
}

export interface CheckLinksResult {
  brokenLinks: LinkResult[];
  navigation: {
    internal: number;
    external: number;
  };
  navLinks: {
    totalCount: number;
    topLevelCount: number;
    hasAboutLink: boolean;
  };
  summary: {
    total: number;
    valid: number;
    broken: number;
    error: number;
    avgClickDepth: number;
    orphanPages: number;
    redirects: number;
    redirectChain: number;
  };
}
