import lighthouse, { Flags } from 'lighthouse';
import * as chromeLauncher from 'chrome-launcher';
import { promises as fs } from 'fs';
import path from 'path';
import puppeteer, { Browser } from 'puppeteer-core';

export class LighthouseEngine {
  // 🔹 Extract text readability
  private extractTextReadability(report: any): boolean {
    return report.audits['font-size-ok']?.score === 1;
  }

  // 🔹 Launch Chrome
  private async launchChrome() {
    const userDataDir = path.join(process.cwd(), 'tmp', `lighthouse_profile_${Date.now()}`);

    await fs.mkdir(userDataDir, { recursive: true });

    const chrome = await chromeLauncher.launch({
      chromeFlags: [
        '--headless=new',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--disable-extensions',
        '--no-zygote',
        `--user-data-dir=${userDataDir}`,
      ],
    });

    return {
      chrome,
      userDataDir,
    };
  }

  // 🔹 FLAGS (Only valid fields)
  private getFlags(port: number, mode: 'seo' | 'uxui'): Flags {
    const categories =
      mode === 'seo' ? ['performance', 'accessibility', 'seo'] : ['performance', 'accessibility'];
    return {
      port,
      output: 'json',
      logLevel: 'silent',
      onlyCategories: categories as any,
    };
  }

  // 🔹 DESKTOP CONFIG
  private getDesktopConfig() {
    return {
      extends: 'lighthouse:default',
      settings: {
        formFactor: 'desktop',
        screenEmulation: {
          mobile: false,
          width: 1350,
          height: 940,
          deviceScaleFactor: 1,
          disabled: false,
        },
        throttling: {
          rttMs: 40,
          throughputKbps: 10240,
          cpuSlowdownMultiplier: 1,
        },
      },
    };
  }

  // 🔹 MOBILE CONFIG
  private getMobileConfig() {
    return {
      extends: 'lighthouse:default',
      settings: {
        formFactor: 'mobile',
        screenEmulation: {
          mobile: true,
          width: 412,
          height: 823,
          deviceScaleFactor: 1.75,
          disabled: false,
        },
        throttling: {
          rttMs: 150,
          throughputKbps: 1638.4,
          cpuSlowdownMultiplier: 4,
        },
      },
    };
  }

  // 🔹 SEO / PERFORMANCE (Desktop)
  private async runSEOAudit(url: string, chrome: any, browser: Browser) {
    const flags = this.getFlags(chrome.port, 'seo');
    const config = this.getDesktopConfig();

    const result: any = await lighthouse(url, flags, config as any);

    if (!result) {
      throw new Error('Lighthouse desktop audit failed');
    }

    const report = result.lhr;

    const performance = (report.categories.performance?.score || 0) * 100;
    const accessibility = (report.categories.accessibility?.score || 0) * 100;
    const lcp = (report.audits['largest-contentful-paint']?.numericValue || 0) / 1000;
    const cls = report.audits['cumulative-layout-shift']?.numericValue || 0;
    const tti = (report.audits['interactive']?.numericValue || 0) / 1000;

    return {
      performance,
      accessibility,
      lcp,
      cls,
      tti,
      mobilePerformance: 0,
      browser,
      chrome,
    };
  }

  // 🔹 UX/UI (Mobile)
  private async runUXUIAudit(url: string, chrome: any, browser: Browser) {
    const flags = this.getFlags(chrome.port, 'uxui');
    const config = this.getMobileConfig();

    const result: any = await lighthouse(url, flags, config as any);

    if (!result) {
      throw new Error('Lighthouse mobile audit failed');
    }

    const report = result.lhr;

    const mobilePerformance = (report.categories.performance?.score || 0) * 100;
    // console.log('Lighthouse Mobile Performance Score:', mobilePerformance);
    const accessibility = (report.categories.accessibility?.score || 0) * 100;

    return {
      performance: mobilePerformance,
      accessibility,
      lcp: 0,
      cls: 0,
      tti: 0,
      mobilePerformance,
      browser,
      chrome,
    };
  }

  // 🔹 FULL AUDIT (Desktop)
  private async runFullAudit(url: string, chrome: any, browser: Browser) {
    const flags = this.getFlags(chrome.port, 'seo');
    const config = this.getDesktopConfig();

    const result: any = await lighthouse(url, flags, config as any);

    if (!result) {
      throw new Error('Lighthouse full audit failed');
    }

    const report = result.lhr;

    const lighthousePerformance = (report.categories.performance?.score || 0) * 100;
    const lighthouseAccessibility = (report.categories.accessibility?.score || 0) * 100;

    const lcpSeconds = (report.audits['largest-contentful-paint']?.numericValue || 0) / 1000;
    const clsValue = report.audits['cumulative-layout-shift']?.numericValue || 0;
    const ttiSeconds = (report.audits['interactive']?.numericValue || 0) / 1000;
    const tbtRaw = report.audits['total-blocking-time']?.numericValue || 0;

    const performance = Math.round(
      lighthousePerformance * 0.6 +
        this.normalizeLCP(lcpSeconds) * 0.1 +
        this.normalizeCLS(clsValue) * 0.1 +
        this.normalizeTTI(ttiSeconds) * 0.1 +
        this.normalizeTBT(tbtRaw) * 0.1,
    );

    return {
      performance,
      accessibility: lighthouseAccessibility,
      lcp: lcpSeconds,
      cls: clsValue,
      tti: ttiSeconds,
      mobilePerformance: 0,
      browser,
      chrome,
    };
  }

  private normalizeLCP(lcpSeconds: number): number {
    const IDEAL_LCP = 2.5;
    if (lcpSeconds <= IDEAL_LCP) return 100;
    return Math.max(0, (IDEAL_LCP / lcpSeconds) * 100);
  }

  private normalizeCLS(clsValue: number): number {
    const IDEAL_CLS = 0.1;
    if (clsValue <= IDEAL_CLS) return 100;
    return Math.max(0, (IDEAL_CLS / clsValue) * 100);
  }

  private normalizeTTI(ttiSeconds: number): number {
    const IDEAL_TTI = 3.5;
    if (ttiSeconds <= IDEAL_TTI) return 100;
    return Math.max(0, (IDEAL_TTI / ttiSeconds) * 100);
  }

  private normalizeTBT(tbtRaw: number): number {
    const IDEAL_TBT = 200;
    if (tbtRaw <= IDEAL_TBT) return 100;
    return Math.max(0, (IDEAL_TBT / tbtRaw) * 100);
  }

  // 🔹 RUN AUDIT (ENTRY POINT)
  async runAudit(url: string, mode?: 'seo' | 'uxui') {
    const launched = await this.launchChrome();

    const chrome = launched.chrome;
    const userDataDir = launched.userDataDir;

    console.log('Chrome Port:', chrome.port);

    const browser = await puppeteer.connect({
      browserURL: `http://localhost:${chrome.port}`,
      defaultViewport: null,
    });

    const auditMethods: Record<
      string,
      (url: string, chrome: any, browser: Browser) => Promise<any>
    > = {
      seo: (url, chrome, browser) => this.runSEOAudit(url, chrome, browser),

      uxui: (url, chrome, browser) => this.runUXUIAudit(url, chrome, browser),

      full: (url, chrome, browser) => this.runFullAudit(url, chrome, browser),
    };

    const result = await auditMethods[mode ?? 'full'](url, chrome, browser);

    return {
      ...result,
      userDataDir,
    };
  }
}
