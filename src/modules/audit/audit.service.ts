import { LighthouseEngine } from './engines/lighthouse.engine';
import {
  DomEngine,
  DomAnalysisResultSEO,
  DomAnalysisResultUXUI,
  DomAnalysisResult,
} from './engines/dom.engine';
import { VisualEngine } from './engines/visual.engine';
import { AxeEngine } from './engines/axe.engine';
import { ScoreCalculator } from './scoring/score.calculator';
import { CombinedVisualResult } from '../../utils/visual.utils';
import { AuditResult, SEOResult, UXUIResult, FullAuditResult, Recommendation } from './types';
import { emailService } from './email/email.service';
import { promises as fs } from 'fs';
import path from 'path';

/**
 * Helper to wrap a promise with a timeout
 */
function runWithTimeout<T>(
  promise: Promise<T>,
  ms: number,
  fallback: T,
  label: string,
  logPrefix: string = '',
): Promise<T> {
  let timeoutId: NodeJS.Timeout;
  const timeoutPromise = new Promise<T>((resolve) => {
    timeoutId = setTimeout(() => {
      console.warn(`${logPrefix}[Timeout] ${label} exceeded ${ms}ms, using fallback.`);
      resolve(fallback);
    }, ms);
  });

  return Promise.race([
    promise.then((result) => {
      clearTimeout(timeoutId);
      return result;
    }),
    timeoutPromise,
  ]);
}

export class AuditService {
  private lighthouseEngine = new LighthouseEngine();
  private axeEngine = new AxeEngine();
  private domEngine = new DomEngine();
  private visualEngine = new VisualEngine();
  private scoreCalculator = new ScoreCalculator();

  async runFullAudit(
    url: string,
    mode?: string,
    emailRecipient?: string,
    jobId?: string,
    onProgress?: (step: string) => void,
  ): Promise<AuditResult | SEOResult | UXUIResult> {
    const logPrefix = jobId ? `[Job: ${jobId}] ` : '';
    if (onProgress) onProgress('started');
    const lighthouseResult = await this.lighthouseEngine.runAudit(
      url,
      mode as 'seo' | 'uxui' | undefined,
    );
    if (onProgress) onProgress('lighthouse');

    const { browser, chrome, performance, accessibility, lcp, cls, tti, mobilePerformance } =
      lighthouseResult;

    let axeData: Awaited<ReturnType<AxeEngine['runAudit']>>;
    let domData: DomAnalysisResultSEO | DomAnalysisResultUXUI | DomAnalysisResult;
    let screenshots: Awaited<ReturnType<VisualEngine['captureScreenshots']>>;
    let visualAI: CombinedVisualResult | null = null;

    try {
      if (mode === 'uxui') {
        // ── Parallel execution: Axe + DOM + Visual screenshots run concurrently ──
        // Each engine opens its own Puppeteer tab via browser.newPage(), so running
        // all three simultaneously is safe and roughly 3× faster than sequential.
        const axePromise = this.axeEngine.runAudit(browser, url, accessibility, 'uxui');
        const domPromise = this.domEngine.analyze(browser, url);
        const visualPromise = this.visualEngine.captureScreenshots(browser, url);

        [axeData, domData, screenshots] = (await Promise.all([
          runWithTimeout(axePromise, 60000, null, 'Axe Audit', logPrefix),
          runWithTimeout(domPromise, 45000, null, 'Dom Analysis', logPrefix),
          runWithTimeout(visualPromise, 60000, null, 'Visual Capture', logPrefix),
        ])) as any;

        // Emit all parallel-phase progress steps together once Promise.all resolves
        if (onProgress) onProgress('axe');
        if (onProgress) onProgress('dom_nav');
        if (onProgress) onProgress('dom_seo');
        if (onProgress) onProgress('visual_mobile');

        // Handle nulls with fallbacks
        if (!axeData) {
          axeData = {
            critical: 0,
            serious: 0,
            moderate: 0,
            minor: 0,
            accessibility: Math.round(accessibility * 0.8),
            tapTargetScore: 100,
            overflowScore: 100,
            textScore: 100,
          };
        }
        if (!domData) {
          domData = {
            navLinks: { totalCount: 0, topLevelCount: 0, hasAboutLink: false },
            images: { total: 0, altCoverage: 0 },
            cta: { count: 0 },
            forms: { formCount: 0, totalFields: 0, requiredFields: 0, requiredRatio: 0 },
            trustSignals: {
              isHttps: true,
              testimonials: false,
              clientLogos: false,
              trustBadges: false,
              contactInfo: { phone: false, email: false, address: false },
            },
            conversionSignals: { urgency: false, incentives: false },
            errorHandling: { hasErrorHandling: false },
            structure: { h1: false, meta: { title: '', description: '' } },
            links: {
              summary: {
                total: 0,
                valid: 0,
                broken: 0,
                error: 0,
                avgClickDepth: 0,
                orphanPages: 0,
                redirects: 0,
                redirectChain: 0,
              },
              brokenLinks: [],
              navigation: { internal: 0, external: 0 },
              navLinks: { totalCount: 0, topLevelCount: 0, hasAboutLink: false },
            },
          } as DomAnalysisResult;
        }

        // analyzeWithAI must stay sequential — it depends on the screenshots result
        visualAI = screenshots ? await this.visualEngine.analyzeWithAI(screenshots) : null;
        if (onProgress) onProgress('visual_trust');
      } else if (mode === 'seo') {
        // ── SEO: axeData is a static stub; only DOM analysis runs ────────────────
        // No visual engine in SEO mode. axeData and domData run in parallel via
        // Promise.all even though axeData is a resolved stub — keeps the pattern
        // consistent and allows future engine additions without refactoring.
        const domPromise = this.domEngine.analyze(browser, url);

        [axeData, domData] = (await Promise.all([
          Promise.resolve({
            critical: 0,
            serious: 0,
            moderate: 0,
            minor: 0,
            accessibility,
            tapTargetScore: 100,
            overflowScore: 100,
            textScore: 100,
          }),
          runWithTimeout(domPromise, 45000, null, 'Dom Analysis', logPrefix),
        ])) as any;

        if (onProgress) onProgress('dom_nav');
        if (onProgress) onProgress('dom_seo');

        if (!domData) {
          domData = {
            navLinks: { totalCount: 0, topLevelCount: 0, hasAboutLink: false },
            images: { total: 0, altCoverage: 0 },
            cta: { count: 0 },
            forms: { formCount: 0, totalFields: 0, requiredFields: 0, requiredRatio: 0 },
            trustSignals: {
              isHttps: true,
              testimonials: false,
              clientLogos: false,
              trustBadges: false,
              contactInfo: { phone: false, email: false, address: false },
            },
            conversionSignals: { urgency: false, incentives: false },
            errorHandling: { hasErrorHandling: false },
            structure: { h1: false, meta: { title: '', description: '' } },
            links: {
              summary: {
                total: 0,
                valid: 0,
                broken: 0,
                error: 0,
                avgClickDepth: 0,
                orphanPages: 0,
                redirects: 0,
                redirectChain: 0,
              },
              brokenLinks: [],
              navigation: { internal: 0, external: 0 },
              navLinks: { totalCount: 0, topLevelCount: 0, hasAboutLink: false },
            },
          } as DomAnalysisResult;
        }
      } else {
        // ── Full: Axe + DOM + Visual screenshots all run in parallel ─────────────
        const axePromise = this.axeEngine.runAudit(browser, url, accessibility, 'uxui');
        const domPromise = this.domEngine.analyze(browser, url);
        const visualPromise = this.visualEngine.captureScreenshots(browser, url);

        [axeData, domData, screenshots] = (await Promise.all([
          runWithTimeout(axePromise, 60000, null, 'Axe Audit', logPrefix),
          runWithTimeout(domPromise, 45000, null, 'Dom Analysis', logPrefix),
          runWithTimeout(visualPromise, 60000, null, 'Visual Capture', logPrefix),
        ])) as any;

        // Emit all parallel-phase progress steps together once Promise.all resolves
        if (onProgress) onProgress('axe');
        if (onProgress) onProgress('dom_nav');
        if (onProgress) onProgress('dom_seo');
        if (onProgress) onProgress('visual_mobile');

        // Handle nulls with fallbacks
        if (!axeData) {
          axeData = {
            critical: 0,
            serious: 0,
            moderate: 0,
            minor: 0,
            accessibility: Math.round(accessibility * 0.8),
            tapTargetScore: 100,
            overflowScore: 100,
            textScore: 100,
          };
        }
        if (!domData) {
          domData = {
            navLinks: { totalCount: 0, topLevelCount: 0, hasAboutLink: false },
            images: { total: 0, altCoverage: 0 },
            cta: { count: 0 },
            forms: { formCount: 0, totalFields: 0, requiredFields: 0, requiredRatio: 0 },
            trustSignals: {
              isHttps: true,
              testimonials: false,
              clientLogos: false,
              trustBadges: false,
              contactInfo: { phone: false, email: false, address: false },
            },
            conversionSignals: { urgency: false, incentives: false },
            errorHandling: { hasErrorHandling: false },
            structure: { h1: false, meta: { title: '', description: '' } },
            links: {
              summary: {
                total: 0,
                valid: 0,
                broken: 0,
                error: 0,
                avgClickDepth: 0,
                orphanPages: 0,
                redirects: 0,
                redirectChain: 0,
              },
              brokenLinks: [],
              navigation: { internal: 0, external: 0 },
              navLinks: { totalCount: 0, topLevelCount: 0, hasAboutLink: false },
            },
          } as DomAnalysisResult;
        }

        // analyzeWithAI must stay sequential — it depends on the screenshots result
        visualAI = screenshots ? await this.visualEngine.analyzeWithAI(screenshots) : null;
        if (onProgress) onProgress('visual_trust');
      }

      if (onProgress) onProgress('scoring');
      const calcResult = this.scoreCalculator.calculate({
        mode: mode as 'seo' | 'uxui' | undefined,
        lighthouse: { performance, lcp, cls, tti, mobilePerformance, accessibility },
        axe: axeData,
        dom: domData as DomAnalysisResult,
        visual: visualAI,
      });

      if (mode === 'seo' && calcResult.auditMode === 'seo') {
        const seoResult = calcResult as SEOResult;
        if (emailRecipient) {
          this.sendEmailAsync(emailRecipient, seoResult, url, mode || 'seo');
        }
        return seoResult;
      }

      if (mode === 'uxui' && calcResult.auditMode === 'uxui') {
        const uxuiResult = calcResult as UXUIResult;
        if (emailRecipient) {
          this.sendEmailAsync(emailRecipient, uxuiResult, url, mode || 'uxui');
        }
        return uxuiResult;
      }

      const fullResult = calcResult as FullAuditResult;
      const { overall, breakdown, recommendations, metrics, message, grade, quickWins } =
        fullResult;

      const finalReport: AuditResult = {
        url,
        overallScore: overall,
        grade,
        breakdown,
        quickWins,
        criticalIssues: recommendations
          .filter((r) => r.impact === 'High')
          .map((r) => r.issue)
          .slice(0, 3),
        recommendations,
        metrics,
        timestamp: new Date().toISOString(),
        message,
      };

      if (emailRecipient) {
        this.sendEmailAsync(emailRecipient, finalReport, url, mode || 'full', logPrefix);
      }

      return finalReport;
    } finally {
      console.log(`${logPrefix}Starting cleanup for URL:`, url);
      if (browser) {
        try {
          // Add a timeout to browser.close to prevent hanging during cleanup
          await runWithTimeout(browser.close(), 10000, undefined, 'Browser Close', logPrefix);
          console.log(`${logPrefix}Browser closed for URL:`, url);
        } catch (e) {
          console.warn(`${logPrefix}browser.close failed:`, e);
        }
        try {
          await browser.disconnect();
          console.log(`${logPrefix}Browser disconnected for URL:`, url);
        } catch (e) {
          console.warn(`${logPrefix}browser.disconnect failed:`, e);
        }
      }
      if (chrome) {
        try {
          // Check if process is still alive before trying to kill it (prevents noisy error logs)
          let isAlive = false;
          if (chrome.process && chrome.process.pid) {
            try {
              process.kill(chrome.process.pid, 0);
              isAlive = true;
            } catch {
              isAlive = false;
            }
          }

          if (isAlive) {
            await chrome.kill();
            console.log(`${logPrefix}Chrome killed successfully for URL:`, url);
          } else {
            console.log(`${logPrefix}Chrome already exited for URL:`, url);
          }
        } catch (error) {
          const e = error as { code?: string };
          const ignoredErrors = ['ESRCH', 'EPERM'];
          if (ignoredErrors.includes(e.code ?? '')) {
            console.log(`${logPrefix}Chrome already closed or temp files locked (safe to ignore).`);
          } else {
            if (chrome.process && chrome.process.pid) {
              try {
                process.kill(chrome.process.pid, 'SIGTERM');
                console.log(`${logPrefix}Chrome process killed via SIGTERM for URL:`, url);
              } catch (killError) {
                const killErr = killError as { code?: string; message?: string };
                if (killErr.code !== 'ESRCH') {
                  console.warn(`${logPrefix}Unexpected fallback failure:`, killErr.message);
                }
              }
            }
          }
        }
      }
      console.log(`${logPrefix}Cleanup completed for URL:`, url);
    }
  }

  private async _saveAiReport(url: string, visualAI: CombinedVisualResult): Promise<void> {
    const dir = path.join(process.cwd(), 'final_reports');
    await fs.mkdir(dir, { recursive: true });
    const clean = url
      .replace(/^https?:\/\//, '')
      .replace(/[<>:"/\\|?*]/g, '_')
      .substring(0, 100);
    const ts = new Date().toISOString().replace(/:/g, '-');
    await fs.writeFile(
      path.join(dir, `ai_report_${clean}__${ts}.json`),
      JSON.stringify(visualAI, null, 2),
    );
  }

  private async _saveFinalReport(report: AuditResult): Promise<void> {
    const dir = path.join(process.cwd(), 'final_reports');
    await fs.mkdir(dir, { recursive: true });
    const clean = report.url
      .replace(/^https?:\/\//, '')
      .replace(/[<>:"/\\|?*]/g, '_')
      .substring(0, 100);
    const ts = new Date().toISOString().replace(/:/g, '-');
    await fs.writeFile(
      path.join(dir, `final_report_${clean}__${ts}.json`),
      JSON.stringify(report, null, 2),
    );
  }

  private async _saveSeoReport(url: string, report: SEOResult): Promise<void> {
    const dir = path.join(process.cwd(), 'final_reports');
    await fs.mkdir(dir, { recursive: true });
    const clean = url
      .replace(/^https?:\/\//, '')
      .replace(/[<>:"/\\|?*]/g, '_')
      .substring(0, 100);
    const ts = new Date().toISOString().replace(/:/g, '-');
    await fs.writeFile(
      path.join(dir, `seo_report_${clean}__${ts}.json`),
      JSON.stringify(report, null, 2),
    );
  }

  private async _saveUxuiReport(url: string, report: UXUIResult): Promise<void> {
    const dir = path.join(process.cwd(), 'final_reports');
    await fs.mkdir(dir, { recursive: true });
    const clean = url
      .replace(/^https?:\/\//, '')
      .replace(/[<>:"/\\|?*]/g, '_')
      .substring(0, 100);
    const ts = new Date().toISOString().replace(/:/g, '-');
    await fs.writeFile(
      path.join(dir, `uxui_report_${clean}__${ts}.json`),
      JSON.stringify(report, null, 2),
    );
  }

  private sendEmailAsync(
    email: string,
    result: SEOResult | UXUIResult | AuditResult,
    url: string,
    mode: string = 'full',
    logPrefix: string = '',
  ): void {
    const seoResult = result as SEOResult;
    const uxuiResult = result as UXUIResult;
    const auditResult = result as unknown as {
      overallScore?: number;
      grade: string;
      label?: string;
      message: string;
      breakdown?: Record<string, { score: number; weight: number; contribution: number }>;
      quickWins?: Array<{ issue: string; impact: string }>;
      criticalIssueCount?: number;
      criticalIssues?: string[];
      metrics?: Record<string, string | number>;
      recommendations?: Recommendation[];
      timestamp?: string;
    };

    const score = auditResult?.overallScore || seoResult.seoScore || uxuiResult.uxuiScore || 0;
    const grade = result.grade;
    const label =
      seoResult.label ||
      uxuiResult.label ||
      (mode === 'seo' ? 'SEO' : mode === 'uxui' ? 'UX/UI' : 'Health');
    const message = result.message || '';

    const breakdown = auditResult?.breakdown || seoResult.breakdown || uxuiResult.breakdown;
    const metrics = auditResult?.metrics || seoResult.metrics || uxuiResult.metrics;

    const quickWins =
      auditResult?.quickWins ||
      (seoResult.quickWins as Array<{ issue: string; impact: string }>) ||
      (uxuiResult.quickWins as Array<{ issue: string; impact: string }>);

    const recommendations =
      auditResult?.recommendations || seoResult.recommendations || uxuiResult.recommendations || [];

    const criticalIssueCount =
      auditResult?.criticalIssueCount ||
      auditResult?.criticalIssues?.length ||
      seoResult.criticalIssueCount ||
      uxuiResult.criticalIssueCount ||
      quickWins?.length ||
      0;

    console.log(`${logPrefix}Preparing to send audit report email to:`, email);
    emailService
      .sendAuditReport(email, {
        url,
        mode: mode as 'seo' | 'uxui' | 'full',
        score,
        grade,
        label,
        breakdown: breakdown as Record<string, { score: number }>,
        metrics: metrics as Record<string, string | number>,
        quickWins: quickWins as Array<{ issue: string; impact: string }>,
        recommendations,
        criticalIssueCount,
        message,
        timestamp: auditResult?.timestamp || new Date().toISOString(),
      })
      .then(() => console.log(`${logPrefix}Audit report email sent to:`, email))
      .catch((err) => console.warn(`${logPrefix}Failed to send audit email:`, err));
  }

  private _calculateGrade(score: number): string {
    if (score >= 90) return 'A+';
    if (score >= 80) return 'A / A-';
    if (score >= 70) return 'B+ / B';
    if (score >= 60) return 'B- / C+';
    if (score >= 40) return 'C / D';
    return 'F';
  }
}
