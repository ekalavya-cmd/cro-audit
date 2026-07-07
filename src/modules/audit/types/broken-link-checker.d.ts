declare module 'broken-link-checker' {
  export interface Link {
    url?: {
      resolved?: string;
      original?: string;
    };
    http?: {
      statusCode?: number;
      redirects?: Array<{
        url?: string | URL;
      }>;
    };
    broken?: boolean;
    brokenReason?: string;
    excluded?: boolean;
  }

  export interface HtmlCheckerOptions {
    maxSockets?: number;
    maxSocketsPerHost?: number;
    requestMethod?: 'get' | 'head';
    userAgent?: string;
    retry405Head?: boolean;
    retryHeadFail?: boolean;
    timeout?: number;
  }

  export interface HtmlCheckerEvents {
    link?: (result: Link) => void;
    complete?: () => void;
    error?: (error: Error) => void;
    end?: () => void;
  }

  export class HtmlChecker {
    constructor(options?: HtmlCheckerOptions, handlers?: HtmlCheckerEvents);
    scan(html: string, baseUrl: string): void;
  }
}
