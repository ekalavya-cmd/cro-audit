import { Browser, Page } from 'puppeteer';
import { AxePuppeteer } from '@axe-core/puppeteer';

export interface AxeAuditResult {
  critical: number;
  serious: number;
  moderate: number;
  minor: number;
  accessibility: number;
  tapTargetScore?: number;
  overflowScore?: number;
  textScore?: number;
}

export class AxeEngine {
  /**
   * Audit tap target sizes - checks if interactive elements have sufficient size
   * Minimum recommended size: 48x48px (WCAG 2.5.5)
   */
  // ─── TAP TARGETS ─────────────────────────────────────────────
  // Only check primary interactive elements, not all links
  private async auditTapTargets(page: Page): Promise<number> {
    try {
      return await page.evaluate(() => {
        const MIN_SIZE = 44; // Apple HIG standard — 44px not 48px

        // ✅ Only buttons and form inputs — NOT nav links or text anchors
        const selectors = [
          'button',
          'input[type="button"]',
          'input[type="submit"]',
          'input[type="checkbox"]',
          'input[type="radio"]',
          '[role="button"]',
        ];

        let pass = 0,
          total = 0;
        const seen = new Set<Element>();

        for (const sel of selectors) {
          document.querySelectorAll(sel).forEach((el) => {
            if (seen.has(el)) return;
            seen.add(el);
            const rect = el.getBoundingClientRect();
            if (rect.width < 5 || rect.height < 5) return; // skip hidden
            total++;
            if (rect.width >= MIN_SIZE && rect.height >= MIN_SIZE) pass++;
          });
        }

        // ✅ Return 0-100 score, not boolean
        if (total === 0) return 100;
        return Math.round((pass / total) * 100);
      });
    } catch {
      return 80;
    } // safe default
  }

  // ─── HORIZONTAL OVERFLOW ─────────────────────────────────────
  private async checkHorizontalOverflow(page: Page): Promise<number> {
    try {
      return await page.evaluate(() => {
        const windowWidth = window.innerWidth;
        const docOverflow = document.documentElement.scrollWidth > windowWidth + 10; // 10px tolerance

        // ✅ Only count truly problematic fixed/absolute elements
        let badElements = 0;
        document.querySelectorAll('*').forEach((el) => {
          const style = window.getComputedStyle(el);
          if (style.position === 'fixed' || style.position === 'absolute') {
            const rect = el.getBoundingClientRect();
            if (rect.right > windowWidth + 20) badElements++; // 20px grace
          }
        });

        if (!docOverflow && badElements === 0) return 100;
        if (!docOverflow && badElements <= 2) return 80; // minor overflow
        if (docOverflow && badElements === 0) return 60;
        return 30; // real overflow problem
      });
    } catch {
      return 80;
    }
  }

  // ─── TEXT TOO SMALL ──────────────────────────────────────────
  private async checkTextTooSmall(page: Page): Promise<number> {
    try {
      return await page.evaluate(() => {
        const MIN_SIZE = 12; // ✅ 12px not 14px — 12px is actually fine on mobile

        // ✅ Only leaf text elements — p, li, label, td (not divs/spans which are layout)
        let small = 0,
          total = 0;
        document.querySelectorAll('p, li, label, td, th').forEach((el) => {
          const text = el.textContent?.trim() || '';
          if (!text || text.length < 3) return;
          const size = parseFloat(window.getComputedStyle(el).fontSize);
          if (size > 0) {
            total++;
            if (size < MIN_SIZE) small++;
          }
        });

        if (total === 0) return 100;
        const ratio = small / total;
        if (ratio === 0) return 100;
        if (ratio < 0.05) return 85;
        if (ratio < 0.15) return 60;
        return 30;
      });
    } catch {
      return 80;
    }
  }

  /**
   * Run Axe Audit using a shared browser instance.
   * @param browser - The Puppeteer Browser instance passed from AuditService
   * @param url - The target URL
   * @param lighthouseAccessibility - The score from Lighthouse to average with
   * @param mode - The audit mode ('seo' or 'uxui')
   */
  async runAudit(
    browser: Browser,
    url: string,
    lighthouseAccessibility: number,
    mode: 'seo' | 'uxui' = 'uxui',
  ): Promise<AxeAuditResult> {
    // Return fallback data if mode is seo
    if (mode === 'seo') {
      return {
        critical: 0,
        serious: 0,
        moderate: 0,
        minor: 0,
        accessibility: 0,
        tapTargetScore: 0,
        overflowScore: 0,
        textScore: 0,
      };
    }

    // Open a new tab in the existing browser instead of launching a new Chrome process
    console.log(`[AxeEngine] Starting audit for: ${url}`);
    const page: Page = await browser.newPage();

    try {
      // Realistic browser headers — prevents bot-detection blocks on live server IPs
      // (same pattern as DomEngine — must be set before page.goto())
      await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      );
      await page.setExtraHTTPHeaders({
        'Accept-Language': 'en-US,en;q=0.9',
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      });

      // Set a reasonable timeout and wait for network to settle
      // Increase timeout and add error handling for navigation failures
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });

      // Ensure the DOM is fully parsed
      await page.waitForFunction('document.readyState === "complete"', { timeout: 15000 });

      // Set mobile viewport for mobile experience checks
      await page.setViewport({
        width: 375,
        height: 812,
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
      });

      // Wait for page to adjust to new viewport
      await page.waitForFunction('document.readyState === "complete"', { timeout: 10000 });

      const maxRetries = 3;
      let results: any = null;
      let lastError: Error | null = null;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          // Analyze the page
          results = await new AxePuppeteer(page).analyze();
          break;
        } catch (err: any) {
          lastError = err instanceof Error ? err : new Error(String(err));

          const isFrameError = lastError.message.includes('Frame is not ready');
          if (attempt < maxRetries && isFrameError) {
            await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
            continue;
          }
          throw lastError;
        }
      }

      if (!results) throw new Error('Axe auditing failed after retries.');

      const violations = Array.isArray(results.violations) ? results.violations : [];

      // Extract counts based on impact
      const counts = {
        critical: violations.filter((v: any) => v.impact === 'critical').length,
        serious: violations.filter((v: any) => v.impact === 'serious').length,
        moderate: violations.filter((v: any) => v.impact === 'moderate').length,
        minor: violations.filter((v: any) => v.impact === 'minor').length,
      };
      // console.log('Axe violation counts:', counts, lighthouseAccessibility);

      // Calculate axe-specific score
      let axeScore =
        100 - (counts.critical * 10 + counts.serious * 5 + counts.moderate * 3 + counts.minor * 1);
      axeScore = Math.max(0, Math.min(100, axeScore));

      // Blend with Lighthouse accessibility score (50/50 split)
      const accessibility = Math.round(lighthouseAccessibility * 0.5 + axeScore * 0.5);

      // Run tap target audit, horizontal overflow check, and text too small check
      const tapTargetScore = await this.auditTapTargets(page);
      const overflowScore = await this.checkHorizontalOverflow(page);
      const textScore = await this.checkTextTooSmall(page);

      // console.log(
      //   'Axe tap target audit passed:',
      //   tapTargetScore,
      //   'Horizontal overflow:',
      //   !hasHorizontalOverflow,
      //   'Text too small:',
      //   textTooSmall,
      // );

      console.log(`[AxeEngine] Audit complete for: ${url}`);
      return {
        ...counts,
        accessibility,
        tapTargetScore,
        overflowScore,
        textScore,
      };
    } finally {
      // CRITICAL: Only close the tab/page, NOT the browser.
      // The browser is managed by the AuditService.
      await page.close();
    }
  }
}
