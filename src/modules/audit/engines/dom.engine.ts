import puppeteer, { Browser, Page } from 'puppeteer';
import { extractStructure } from '../../../utils/extractStructure';
import { checkLinks } from '../../../utils/checkLinks';
import type { DomAnalysisResultSEO, DomAnalysisResultUXUI } from '../types/dom.engine.types';
import type { CheckLinksResult } from '../types/checkLinks.types';

export type { DomAnalysisResultSEO, DomAnalysisResultUXUI };

export interface DomAnalysisResult {
  navLinks: { totalCount: number; topLevelCount: number; hasAboutLink: boolean };
  images: { total: number; altCoverage: number };
  cta: { count: number };
  forms: { formCount: number; totalFields: number; requiredFields: number; requiredRatio: number };
  trustSignals: {
    isHttps: boolean;
    testimonials: boolean;
    clientLogos: boolean;
    trustBadges: boolean;
    contactInfo: { phone: boolean; email: boolean; address: boolean };
  };
  conversionSignals: { urgency: boolean; incentives: boolean };
  errorHandling: { hasErrorHandling: boolean };
  structure: { h1: boolean; meta: { title: string; description: string } };
  links: CheckLinksResult;
}

export class DomEngine {
  async analyze(browser: Browser, url: string): Promise<DomAnalysisResult> {
    console.log(`[DomEngine] Starting analysis for: ${url}`);
    const page: Page = await browser.newPage();

    try {
      // ── Fix 1: Realistic browser headers ─────────────────────────────────────
      // Live server IPs (cloud/datacenter) are flagged as bots by Cloudflare and
      // similar systems. Setting a real UA + Accept-Language makes the request
      // indistinguishable from an ordinary Chrome browser visit.
      await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      );
      await page.setExtraHTTPHeaders({
        'Accept-Language': 'en-US,en;q=0.9',
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      });

      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

      // ── Fix 2: JS-rendered nav wait ───────────────────────────────────────────
      // React / Next.js / Vue sites render their navigation client-side. On a
      // live server (slower CPU, network conditions) networkidle2 can fire before
      // JS has painted the nav links. We wait up to 5 s for at least one anchor
      // inside a nav or header to appear. If it never does, we proceed anyway —
      // the audit should never be blocked by this wait.
      await page
        .waitForFunction(
          () => document.querySelectorAll('nav a, header a, [role="navigation"] a').length > 0,
          {
            timeout: 5000,
          },
        )
        .catch(() => {
          console.warn(
            `[DomEngine] Nav links did not appear within 5 s after networkidle2 — proceeding with current DOM snapshot.`,
          );
        });

      const html = await page.content();

      const [structure, links] = await Promise.all([
        extractStructure(html, page),
        checkLinks(url, html),
      ]);

      console.log(`[DomEngine] Analysis complete for: ${url}`);
      return {
        structure: structure.structure,
        navLinks: structure.navLinks,
        images: structure.images,
        cta: structure.cta,
        forms: structure.forms,
        trustSignals: structure.trustSignals,
        conversionSignals: structure.conversionSignals,
        errorHandling: structure.errorHandling,
        links,
      };
    } finally {
      await page.close();
    }
  }

  // SEO mode
  async analyzeSEO(url: string): Promise<DomAnalysisResultSEO> {
    const { page, html, browser, startTime } = await this._launch(url);

    try {
      const [structure, links] = await Promise.all([
        extractStructure(html, page),
        checkLinks(url, html),
      ]);

      this._logTime(startTime);

      return {
        navLinks: {
          // Prefer structure.navLinks — has 4-tier scoring, mega-menu, and legacy table-nav support
          topLevelCount: structure.navLinks.topLevelCount,
          totalCount: structure.navLinks.totalCount,
          hasAboutLink: structure.navLinks.hasAboutLink,
        },
        images: {
          total: structure.images.total,
          altCoverage: structure.images.altCoverage,
        },
        trustSignals: {
          isHttps: structure.trustSignals.isHttps,
          testimonials: structure.trustSignals.testimonials,
          clientLogos: structure.trustSignals.clientLogos,
          trustBadges: structure.trustSignals.trustBadges,
          contactInfo: {
            phone: structure.trustSignals.contactInfo.phone,
            email: structure.trustSignals.contactInfo.email,
            address: structure.trustSignals.contactInfo.address,
          },
        },
        links: {
          summary: links.summary,
          brokenLinks: links.brokenLinks,
          navigation: links.navigation,
        },
      };
    } finally {
      await browser.close();
    }
  }

  // UX/UI mode
  async analyzeUXUI(url: string): Promise<DomAnalysisResultUXUI> {
    const { page, html, browser, startTime } = await this._launch(url);

    try {
      const [structure, links] = await Promise.all([
        extractStructure(html, page),
        checkLinks(url, html),
      ]);

      this._logTime(startTime);

      return {
        url: url,
        navLinks: {
          // Prefer structure.navLinks — has 4-tier scoring, mega-menu, and legacy table-nav support
          topLevelCount: structure.navLinks.topLevelCount,
          totalCount: structure.navLinks.totalCount,
          hasAboutLink: structure.navLinks.hasAboutLink,
        },
        images: {
          total: structure.images.total,
          altCoverage: structure.images.altCoverage,
        },
        trustSignals: {
          isHttps: structure.trustSignals.isHttps,
          testimonials: structure.trustSignals.testimonials,
          clientLogos: structure.trustSignals.clientLogos,
          trustBadges: structure.trustSignals.trustBadges,
          contactInfo: {
            phone: structure.trustSignals.contactInfo.phone,
            email: structure.trustSignals.contactInfo.email,
            address: structure.trustSignals.contactInfo.address,
          },
        },
        links: {
          summary: links.summary,
          brokenLinks: links.brokenLinks,
          navigation: links.navigation,
        },
        // UX/UI-only fields
        heading: {
          h1: structure.structure.h1,
        },
        cta: {
          count: structure.cta.count,
        },
        forms: {
          formCount: structure.forms.formCount,
          totalFields: structure.forms.totalFields,
          requiredRatio: structure.forms.requiredRatio,
        },
        errorHandling: {
          hasErrorHandling: structure.errorHandling.hasErrorHandling,
        },
        conversionSignals: {
          urgency: structure.conversionSignals.urgency,
          incentives: structure.conversionSignals.incentives,
        },
      };
    } finally {
      await browser.close();
    }
  }

  // Puppeteer setup
  private async _launch(url: string) {
    const browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    });

    const startTime = Date.now();
    const page = await browser.newPage();

    // Block images, fonts, stylesheets, media — not needed for DOM extraction
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const type = req.resourceType();
      if (['image', 'stylesheet', 'font', 'media'].includes(type)) {
        req.abort();
      } else {
        req.continue();
      }
    });

    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const html = await page.content();

    const puppeteerTime = Date.now();
    console.log(`Puppeteer: ${((puppeteerTime - startTime) / 1000).toFixed(2)}s`);

    return { browser, page, html, startTime: puppeteerTime };
  }

  // Timing log
  private _logTime(puppeteerTime: number) {
    const analysisTime = Date.now();
    console.log(`Analysis: ${((analysisTime - puppeteerTime) / 1000).toFixed(2)}s`);
  }
}
