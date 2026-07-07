import { Browser } from 'puppeteer';
import OpenAI from 'openai';
import { ENV } from '../../../config/env';
import {
  DESKTOP_CONFIG,
  MOBILE_CONFIG,
  BLOCKED_DOMAINS,
  DeviceConfig,
  ScreenshotResult,
  CombinedVisualResult,
  RawVisualScores,
  DIMENSION_KEYS,
  sleep,
  waitForPageReady,
  dismissCookieBanner,
  fixUnsupportedImages,
  slowScrollToLoad,
  fixWhiteGaps,
  analyzeScreenshot,
  buildAnalysisResult,
} from '../../../utils/visual.utils';
import path from 'path';
import { promises as fs } from 'fs';

export class VisualEngine {
  private openai?: OpenAI;

  constructor() {
    if (ENV.OPENAI_API_KEY) {
      this.openai = new OpenAI({ apiKey: ENV.OPENAI_API_KEY });
    }
  }

  // ─── PUBLIC: CAPTURE SCREENSHOTS ─────────────────────────────
  async captureScreenshots(browser: Browser, url: string): Promise<ScreenshotResult> {
    // ✅ KEY OPTIMIZATION: desktop + mobile captured in parallel tabs
    // Previously: desktop (40s) → sleep(1000) → mobile (40s) = ~81s
    // Now: both simultaneously = ~40s (the longer of the two)
    console.log(`[VisualEngine] Starting screenshot capture for: ${url}`);
    const [desktop, mobile] = await Promise.all([
      this._capturePage(browser, url, DESKTOP_CONFIG, 'desktop'),
      this._capturePage(browser, url, MOBILE_CONFIG, 'mobile'),
    ]);

    // Fire-and-forget disk write — doesn't block the audit
    // this._saveToDisk(url, desktop, mobile).catch((err) =>
    //   console.error('Screenshot save failed (non-blocking):', err),
    // );

    console.log(`[VisualEngine] Screenshot capture complete for: ${url}`);
    return {
      desktop: { base64: desktop.toString('base64') },
      mobile: { base64: mobile.toString('base64') },
    };
  }

  // ─── PUBLIC: AI ANALYSIS ─────────────────────────────────────
  async analyzeWithAI(screenshots: ScreenshotResult): Promise<CombinedVisualResult> {
    if (!this.openai) return this._fallbackCombinedResult();

    // ✅ Already parallel — desktop + mobile AI calls simultaneously
    const [desktop, mobile] = await Promise.all([
      analyzeScreenshot(this.openai, screenshots.desktop.base64, 'desktop'),
      analyzeScreenshot(this.openai, screenshots.mobile.base64, 'mobile'),
    ]);

    const d = desktop.overall_visual_score;
    const m = mobile.overall_visual_score;
    const combinedRaw = parseFloat((((d + m) / 2) * 10).toFixed(1));

    return {
      desktop,
      mobile,
      combined_ux_health: {
        visual_clarity_raw: combinedRaw,
        weighted_contribution: parseFloat((combinedRaw * 0.2).toFixed(1)),
        note: 'Visual Clarity = 20% of total UX Health Score',
        desktop_score: d,
        mobile_score: m,
      },
    };
  }

  // ─── PRIVATE: SINGLE PAGE CAPTURE ────────────────────────────
  private async _capturePage(
    browser: Browser,
    url: string,
    deviceConfig: DeviceConfig,
    label: 'desktop' | 'mobile',
  ): Promise<Buffer> {
    const page = await browser.newPage();

    try {
      await page.setUserAgent(deviceConfig.userAgent);
      await page.setViewport(deviceConfig.viewport);

      await page.setRequestInterception(true);
      page.on('request', (req) => {
        const blocked =
          req.resourceType() === 'websocket' || BLOCKED_DOMAINS.some((d) => req.url().includes(d));
        if (blocked) {
          req.abort();
        } else {
          req.continue();
        }
      });

      // ✅ networkidle2 handles most of the "wait for content" work
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

      // Adaptive wait — only adds delay for SPAs that need JS hydration
      await waitForPageReady(page);

      await dismissCookieBanner(page);
      await sleep(200); // ✅ 200ms (was 300ms in utils, reduced further here)

      await fixUnsupportedImages(page); // conditional — skips wait on non-HEIF sites
      await slowScrollToLoad(page); // 350ms/step instead of 600ms
      await fixWhiteGaps(page);
      await sleep(500); // ✅ 500ms final settle (was 800ms)

      const raw = await page.screenshot({
        fullPage: true,
        type: 'jpeg',
        // ✅ Lower quality slightly — still sharp enough for AI analysis
        // Smaller file = faster base64 encode + faster API upload
        quality: label === 'mobile' ? 60 : 72,
      });

      return raw as Buffer;
    } finally {
      await page.close();
    }
  }

  // ─── PRIVATE: DISK SAVE (background, non-blocking) ───────────
  private async _saveToDisk(url: string, desktop: Buffer, mobile: Buffer): Promise<void> {
    const dir = path.join(process.cwd(), 'websites_screenshots');
    await fs.mkdir(dir, { recursive: true });
    const slug = url
      .replace(/^https?:\/\//, '')
      .replace(/[<>:"/\\|?*]/g, '_')
      .substring(0, 50);
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    await Promise.all([
      fs.writeFile(path.join(dir, `${slug}_${ts}_desktop.jpg`), desktop),
      fs.writeFile(path.join(dir, `${slug}_${ts}_mobile.jpg`), mobile),
    ]);
  }

  // ─── PRIVATE: FALLBACK ────────────────────────────────────────
  private _fallbackCombinedResult(): CombinedVisualResult {
    const scores = DIMENSION_KEYS.reduce(
      (acc, key) => ({ ...acc, [key]: 7 }),
      {} as RawVisualScores,
    );
    return {
      desktop: buildAnalysisResult(scores, 'desktop'),
      mobile: buildAnalysisResult(scores, 'mobile'),
      combined_ux_health: {
        visual_clarity_raw: 70,
        weighted_contribution: 14,
        note: 'Visual Clarity = 20% of total (fallback — no API key)',
        desktop_score: 7,
        mobile_score: 7,
      },
    };
  }
}
