import {
  ScoreBreakdown,
  SEOResult,
  SEOQuickWin,
  UXUIResult,
  UXUIQuickWin,
  AIRatings,
  Recommendation,
  FullAuditResult,
} from '../types';
import { CombinedVisualResult } from '../../../utils/visual.utils';
import { AxeAuditResult } from '../engines/axe.engine';
import { DomAnalysisResult } from '../engines/dom.engine';

interface LighthouseResult {
  performance: number;
  lcp: number;
  cls: number;
  tti: number;
  mobilePerformance: number;
  accessibility: number;
}

export class ScoreCalculator {
  calculate(data: {
    mode?: 'seo' | 'uxui';
    lighthouse: LighthouseResult;
    axe: AxeAuditResult;
    dom: DomAnalysisResult;
    visual: CombinedVisualResult | null;
  }): SEOResult | UXUIResult | FullAuditResult {
    const { mode, lighthouse, axe, dom, visual } = data;

    if (mode === 'seo') {
      return this._calculateSeo({ lighthouse, axe, dom, visual });
    }

    if (mode === 'uxui') {
      return this._calculateUxui({ lighthouse, axe, dom, visual });
    }

    return this._calculateFull({ lighthouse, axe, dom, visual });
  }

  private _calculateSeo(data: {
    lighthouse: LighthouseResult;
    axe: AxeAuditResult;
    dom: DomAnalysisResult;
    visual: CombinedVisualResult | null;
  }): SEOResult {
    const { lighthouse, dom } = data;
    const performance = Math.round(lighthouse.performance);
    const lcp = lighthouse.lcp ?? 0;
    const cls = lighthouse.cls ?? 0;
    const tti = lighthouse.tti ?? 0;

    const lcpScore = lcp <= 2.5 ? 100 : (2.5 / lcp) * 100;
    const clsScore = cls <= 0.1 ? 100 : (0.1 / cls) * 100;
    const ttiScore = tti <= 3.5 ? 100 : (3.5 / tti) * 100;

    const performanceScore = Math.min(
      100,
      Math.max(
        0,
        Math.round(performance * 0.6 + lcpScore * 0.1333 + clsScore * 0.1333 + ttiScore * 0.1333),
      ),
    );

    const brokenLinks = dom?.links?.summary?.broken ?? 0;
    const menuItems = dom?.navLinks?.topLevelCount ?? 0;
    const avgClickDepth = dom?.links?.summary?.avgClickDepth ?? 0;
    const orphanPages = dom?.links?.summary?.orphanPages ?? 0;

    const seoNavigationScore = this._scoreSeoNavigation(
      dom,
      brokenLinks,
      menuItems,
      avgClickDepth,
      orphanPages,
    );

    const performanceContribution = performanceScore * 0.6;
    const navigationContribution = seoNavigationScore * 0.4;
    const overall = Math.min(
      100,
      Math.max(0, Math.round(performanceContribution + navigationContribution)),
    );

    const recommendations = this._generateSeoRecommendations(
      dom,
      lighthouse,
      brokenLinks,
      menuItems,
    );

    const quickWins: SEOQuickWin[] = recommendations
      .filter((r) => r.impact === 'High' || r.impact === 'Medium')
      .slice(0, 5)
      .map((r) => ({
        issue: r.issue,
        message: r.businessValue,
        fix: r.recommendation,
        source: r.category,
        impact: r.impact === 'High' ? 'high' : 'medium',
      }));

    const criticalIssueCount = recommendations.filter((r) => r.impact === 'High').length;

    const seoResult: SEOResult = {
      auditMode: 'seo',
      seoScore: overall,
      grade: this._calculateGrade(overall),
      label: this._getLabel(overall),
      message: this._getMessage(overall),
      breakdown: {
        performance: {
          score: performanceScore,
          weight: 0.6,
          contribution: Math.round(performanceContribution * 10) / 10,
        },
        navigation: {
          score: seoNavigationScore,
          weight: 0.4,
          contribution: Math.round(navigationContribution * 10) / 10,
        },
      },
      performanceDetail: {
        lighthouseScore: Math.round(lighthouse.performance),
        lcp: `${lcp.toFixed(1)}s`,
        cls: Math.round(cls * 100) / 100,
        tti: `${tti.toFixed(1)}s`,
      },
      navigationDetail: {
        brokenLinks,
        menuItems,
        avgClickDepth: Math.round(avgClickDepth * 10) / 10,
        orphanPages,
      },
      quickWins,
      criticalIssueCount,
      metrics: {
        bounceRate:
          performanceScore >= 80 ? 'Optimized' : performanceScore >= 50 ? 'Average' : 'At Risk',
        conversion:
          seoNavigationScore >= 80 ? 'Optimized' : seoNavigationScore >= 50 ? 'Average' : 'At Risk',
        engagement: 'Average',
      },
      recommendations,
    };

    return seoResult;
  }

  private _calculateUxui(data: {
    lighthouse: LighthouseResult;
    axe: AxeAuditResult;
    dom: DomAnalysisResult;
    visual: CombinedVisualResult | null;
  }): UXUIResult {
    const { lighthouse, axe, dom, visual } = data;
    const desktopScores = visual?.desktop?.scores;

    const aiRatings: AIRatings = {
      value_proposition_clarity: desktopScores?.value_proposition_clarity ?? 7,
      cta_visibility: desktopScores?.cta_visibility ?? 7,
      above_fold_clarity: desktopScores?.above_fold_clarity ?? 7,
      whitespace_balance: desktopScores?.whitespace_balance ?? 7,
      design_consistency: desktopScores?.design_consistency ?? 7,
      typography_variation: desktopScores?.typography_variation ?? 7,
      cta_placement_quality: desktopScores?.cta_placement_quality ?? 7,
      trust_visual_signals: desktopScores?.trust_visual_signals ?? 7,
    };

    const visualClarity = this._scoreVisualClarity(dom, aiRatings);
    const conversionFlow = this._scoreConversionFlow(dom, aiRatings);
    const mobileExperience = this._scoreMobileExperience(lighthouse.performance, axe);
    const trustCredibility = this._scoreTrustCredibility(dom, aiRatings);
    const accessibilityScore = this._scoreAccessibility(lighthouse.accessibility, axe);

    const vcContribution = visualClarity * 0.2667;
    const cfContribution = conversionFlow * 0.2667;
    const meContribution = mobileExperience * 0.2;
    const tcContribution = trustCredibility * 0.1333;
    const a11yContribution = accessibilityScore * 0.1333;

    const overall = Math.min(
      100,
      Math.max(
        0,
        Math.round(
          vcContribution + cfContribution + meContribution + tcContribution + a11yContribution,
        ),
      ),
    );

    const recommendations = this._generateUxuiRecommendations(
      dom,
      lighthouse,
      aiRatings,
      accessibilityScore,
      mobileExperience,
    );

    const quickWins: UXUIQuickWin[] = recommendations
      .filter((r) => r.impact === 'High' || r.impact === 'Medium')
      .slice(0, 5)
      .map((r) => ({
        issue: r.issue,
        message: r.businessValue,
        fix: r.recommendation,
        source: r.category,
        impact: r.impact === 'High' ? 'high' : 'medium',
      }));

    const criticalIssueCount = recommendations.filter((r) => r.impact === 'High').length;

    const uxuiResult: UXUIResult = {
      auditMode: 'uxui',
      uxuiScore: overall,
      grade: this._calculateGrade(overall),
      label: this._getLabel(overall),
      message: this._getMessage(overall),
      breakdown: {
        visualClarity: {
          score: visualClarity,
          weight: 0.2667,
          contribution: Math.round(vcContribution * 100) / 100,
        },
        conversionFlow: {
          score: conversionFlow,
          weight: 0.2667,
          contribution: Math.round(cfContribution * 100) / 100,
        },
        mobileExperience: {
          score: mobileExperience,
          weight: 0.2,
          contribution: Math.round(meContribution * 100) / 100,
        },
        trustCredibility: {
          score: trustCredibility,
          weight: 0.1333,
          contribution: Math.round(tcContribution * 100) / 100,
        },
        accessibility: {
          score: accessibilityScore,
          weight: 0.1333,
          contribution: Math.round(a11yContribution * 100) / 100,
        },
      },
      aiRatings,
      quickWins,
      criticalIssueCount,
      metrics: {
        bounceRate: overall >= 80 ? 'Optimized' : overall >= 50 ? 'Average' : 'At Risk',
        conversion:
          conversionFlow >= 80 ? 'Optimized' : conversionFlow >= 50 ? 'Average' : 'At Risk',
        engagement: visualClarity >= 80 ? 'Optimized' : visualClarity >= 50 ? 'Average' : 'At Risk',
      },
      recommendations,
    };

    return uxuiResult;
  }

  private _calculateFull(data: {
    lighthouse: LighthouseResult;
    axe: AxeAuditResult;
    dom: DomAnalysisResult;
    visual: CombinedVisualResult | null;
  }): FullAuditResult {
    const { lighthouse, axe, dom, visual } = data;

    // 1. Prepare AI Ratings (shared)
    const desktopScores = visual?.desktop?.scores;
    const aiRatings: AIRatings = {
      value_proposition_clarity: desktopScores?.value_proposition_clarity ?? 7,
      cta_visibility: desktopScores?.cta_visibility ?? 7,
      above_fold_clarity: desktopScores?.above_fold_clarity ?? 7,
      whitespace_balance: desktopScores?.whitespace_balance ?? 7,
      design_consistency: desktopScores?.design_consistency ?? 7,
      typography_variation: desktopScores?.typography_variation ?? 7,
      cta_placement_quality: desktopScores?.cta_placement_quality ?? 7,
      trust_visual_signals: desktopScores?.trust_visual_signals ?? 7,
    };

    // 2. Calculate Score Breakdown using specialized helpers for consistency
    const visualClarity = this._scoreVisualClarity(dom, aiRatings);
    const mobileExperience = this._scoreMobileExperience(lighthouse.performance, axe);
    const performance = Math.round(lighthouse.performance);
    const accessibility = this._scoreAccessibility(lighthouse.accessibility, axe);
    const trust = this._scoreTrustCredibility(dom, aiRatings);
    const conversionOptimization = this._scoreConversionFlow(dom, aiRatings);

    // Navigation scoring (SEO version is more detailed)
    const brokenLinks = dom?.links?.summary?.broken ?? 0;
    const menuItems = dom?.navLinks?.topLevelCount ?? 0;
    const avgClickDepth = dom?.links?.summary?.avgClickDepth ?? 0;
    const orphanPages = dom?.links?.summary?.orphanPages ?? 0;
    const navigationIA = this._scoreSeoNavigation(
      dom,
      brokenLinks,
      menuItems,
      avgClickDepth,
      orphanPages,
    );

    const breakdown: ScoreBreakdown = {
      visualClarity,
      mobileExperience,
      performance,
      accessibility,
      navigationIA,
      conversionOptimization,
      trust,
    };

    // 3. Weighted Overall Score
    const overall = Math.min(
      100,
      Math.max(
        0,
        Math.round(
          breakdown.visualClarity * 0.2 +
            breakdown.mobileExperience * 0.15 +
            breakdown.performance * 0.15 +
            breakdown.accessibility * 0.15 +
            breakdown.navigationIA * 0.15 +
            breakdown.conversionOptimization * 0.1 +
            breakdown.trust * 0.1,
        ),
      ),
    );

    // 4. Combined Recommendations
    const seoRecs = this._generateSeoRecommendations(dom, lighthouse, brokenLinks, menuItems);
    const uxuiRecs = this._generateUxuiRecommendations(
      dom,
      lighthouse,
      aiRatings,
      accessibility,
      mobileExperience,
    );

    // Merge and deduplicate by issue
    const seenIssues = new Set<string>();
    const recommendations: Recommendation[] = [];

    [...seoRecs, ...uxuiRecs].forEach((rec) => {
      if (!seenIssues.has(rec.issue)) {
        seenIssues.add(rec.issue);
        recommendations.push(rec);
      }
    });

    // Re-sort by impact
    const impactOrder: Record<string, number> = { High: 0, Medium: 1, Low: 2 };
    recommendations.sort(
      (a, b) => impactOrder[a.impact as string] - impactOrder[b.impact as string],
    );

    // 5. Quick Wins & Critical Count
    const quickWins = recommendations
      .filter((r) => r.impact === 'High' || r.impact === 'Medium')
      .slice(0, 5)
      .map((r) => ({
        issue: r.issue,
        message: r.businessValue,
        fix: r.recommendation,
        source: r.category,
        impact: r.impact === 'High' ? 'high' : 'medium',
      }));

    const criticalIssueCount = recommendations.filter((r) => r.impact === 'High').length;

    // 6. Metrics Heuristics
    const getLevel = (score: number) => {
      if (score >= 80) return 'Optimized';
      if (score >= 50) return 'Average';
      return 'At Risk';
    };

    const bounceScore = performance * 0.6 + visualClarity * 0.4;
    const conversionScore = conversionOptimization * 0.6 + trust * 0.4;
    const engagementScore = navigationIA * 0.5 + visualClarity * 0.5;

    return {
      auditMode: 'full',
      overall,
      grade: this._calculateGrade(overall),
      label: this._getLabel(overall),
      message: this._getMessage(overall),
      breakdown,
      recommendations,
      quickWins,
      criticalIssueCount,
      metrics: {
        bounceRate: getLevel(bounceScore),
        conversion: getLevel(conversionScore),
        engagement: getLevel(engagementScore),
      },
    };
  }

  private _scoreSeoNavigation(
    dom: DomAnalysisResult,
    brokenCount: number,
    navItems: number,
    avgClickDepth: number,
    orphanPages: number,
  ): number {
    let score = 100;

    const brokenLinkPenalty = Math.min(brokenCount * 5, 30);
    score -= brokenLinkPenalty;

    const menuPenalty = navItems > 7 ? 5 : 0;
    score -= menuPenalty;

    const depthPenalty = avgClickDepth > 3 ? 10 : 0;
    score -= depthPenalty;

    const orphanPenalty = orphanPages > 0 ? 5 : 0;
    score -= orphanPenalty;

    return Math.min(100, Math.max(0, Math.round(score)));
  }

  private _generateSeoRecommendations(
    dom: DomAnalysisResult,
    lighthouse: LighthouseResult,
    brokenLinks: number,
    menuItems: number,
  ): Recommendation[] {
    const recs: Recommendation[] = [];
    const lcp = lighthouse.lcp ?? 0;
    const cls = lighthouse.cls ?? 0;
    const performance = lighthouse.performance ?? 0;
    const isHttps = dom?.trustSignals?.isHttps ?? false;
    const avgClickDepth = dom?.links?.summary?.avgClickDepth ?? 0;
    const orphanPages = dom?.links?.summary?.orphanPages ?? 0;

    // LCP > 4.0s - High priority
    if (lcp > 4.0) {
      recs.push({
        category: 'performance',
        issue: 'Your page takes too long to load its main content.',
        recommendation:
          'Compress hero images, implement lazy loading, serve images via a CDN, and defer render-blocking JavaScript.',
        businessValue:
          'Research shows pages with LCP above 4s lose up to 40% of visitors before they engage.',
        impact: 'High',
      });
    }
    // LCP 2.5s - 4.0s - Medium priority
    else if (lcp > 2.5) {
      recs.push({
        category: 'performance',
        issue:
          'Your page load speed is in the "needs improvement" range for Google\'s Core Web Vitals.',
        recommendation:
          'Optimise image formats (WebP), reduce server response time (TTFB < 200ms), and enable browser caching.',
        businessValue: 'This may suppress your search rankings.',
        impact: 'Medium',
      });
    }

    // CLS > 0.25 - High priority
    if (cls > 0.25) {
      recs.push({
        category: 'performance',
        issue: 'Your pages experience significant visual instability as they load.',
        recommendation:
          'Set explicit width/height on images and embeds. Avoid inserting dynamic content above existing content.',
        businessValue: "This is penalised by Google's Core Web Vitals and frustrates users.",
        impact: 'High',
      });
    }

    // Performance Score < 50 - High priority
    if (performance < 50) {
      recs.push({
        category: 'performance',
        issue: 'Your overall site performance score is critically low.',
        recommendation:
          'Audit and remove unused JavaScript/CSS, enable GZIP compression, and review server infrastructure.',
        businessValue: 'This directly impacts both user experience and search engine rankings.',
        impact: 'High',
      });
    }

    // No HTTPS - High priority
    if (!isHttps) {
      recs.push({
        category: 'trust',
        issue: 'Your site does not use HTTPS.',
        recommendation:
          "Install an SSL/TLS certificate via your hosting provider. Most hosts offer free Let's Encrypt SSL.",
        businessValue:
          'Browsers mark it as "Not Secure", and Google uses HTTPS as a ranking signal — this is costing you trust and visibility.',
        impact: 'High',
      });
    }

    // 3+ broken links - Medium priority
    if (brokenLinks >= 3) {
      recs.push({
        category: 'navigationIA',
        issue: 'Your site has broken links that waste search engine crawl budget.',
        recommendation:
          'Fix or redirect the specific broken URLs. Set up 301 redirects for permanently moved pages.',
        businessValue: 'This signals poor site maintenance to both users and Google.',
        impact: 'Medium',
      });
    }
    // 1-2 broken links - Low priority
    else if (brokenLinks > 0) {
      recs.push({
        category: 'navigationIA',
        issue: `${brokenLinks} broken link${brokenLinks > 1 ? 's' : ''} detected on the page.`,
        recommendation: 'Audit and fix all broken links — use redirects or remove dead links.',
        businessValue: 'Broken links harm SEO and user experience.',
        impact: 'Low',
      });
    }

    // Avg click depth > 3 - Medium priority
    if (avgClickDepth > 3) {
      recs.push({
        category: 'navigationIA',
        issue: 'Key pages on your site require more than 3 clicks to reach.',
        recommendation:
          'Flatten site architecture by adding these pages to your main navigation or creating hub/category pages linking to them.',
        businessValue:
          'Search engines give lower priority to deep pages, reducing their chance of ranking.',
        impact: 'Medium',
      });
    }

    // Orphan pages found - Medium priority
    if (orphanPages > 0) {
      recs.push({
        category: 'navigationIA',
        issue: 'Some pages on your site have no internal links pointing to them.',
        recommendation:
          'Add internal links to orphan pages from relevant high-traffic pages or your sitemap.',
        businessValue: 'Search engines may never discover or index these pages.',
        impact: 'Medium',
      });
    }

    // Menu > 7 items - Low priority
    if (menuItems > 7) {
      recs.push({
        category: 'navigationIA',
        issue: 'Your navigation menu has too many items.',
        recommendation:
          'Consolidate navigation to 5–7 primary items. Move secondary items to footer or dropdown sub-menus.',
        businessValue:
          "This can dilute crawl signals and make it harder for search engines to understand your site's priority pages.",
        impact: 'Low',
      });
    }

    // Redirect chains > 2 - Low priority (wastes crawl budget)
    const redirectChainCount = dom?.links?.summary?.redirectChain ?? 0;
    if (redirectChainCount > 2) {
      recs.push({
        category: 'navigationIA',
        issue: `${redirectChainCount} URLs on your site have multi-hop redirect chains.`,
        recommendation:
          'Update all links to point directly to the final destination URL, removing intermediate redirects.',
        businessValue:
          'Redirect chains slow page load times and waste crawl budget — search engines may stop following them before reaching your content.',
        impact: 'Low',
      });
    }

    const order: Record<string, number> = { High: 0, Medium: 1, Low: 2 };
    return recs.sort((a, b) => order[a.impact as string] - order[b.impact as string]);
  }

  private _scoreVisualClarity(dom: DomAnalysisResult, aiRatings: AIRatings): number {
    const valuePropScore = aiRatings.value_proposition_clarity * 10;
    const ctaVisibilityScore = aiRatings.cta_visibility * 10;
    const aboveFoldScore = aiRatings.above_fold_clarity * 10;
    const whitespaceScore = aiRatings.whitespace_balance * 10;
    const designConsistencyScore = aiRatings.design_consistency * 10;
    const typographyScore = aiRatings.typography_variation * 10;

    let aiScore =
      valuePropScore * 0.2 +
      ctaVisibilityScore * 0.2 +
      aboveFoldScore * 0.2 +
      whitespaceScore * 0.15 +
      designConsistencyScore * 0.15 +
      typographyScore * 0.1;

    // H1 presence signal
    const hasH1 = dom?.structure?.h1 ?? false;
    if (!hasH1) {
      aiScore -= 10;
    }

    // Image alt coverage — penalise poor accessibility/SEO signal
    // altCoverage is 0–100; deduct up to 10 points when below 70%
    const altCoverage = dom?.images?.altCoverage ?? 100;
    if (altCoverage < 70) {
      aiScore -= Math.round((70 - altCoverage) / 7); // max ~10 pts deduction
    }

    return Math.min(100, Math.max(0, Math.round(aiScore)));
  }

  private _scoreConversionFlow(dom: any, aiRatings: AIRatings): number {
    const ctaCount = dom?.cta?.count ?? 0;
    let ctaCountScore: number;
    if (ctaCount >= 1 && ctaCount <= 3) ctaCountScore = 100;
    else if (ctaCount === 4) ctaCountScore = 80;
    else if (ctaCount >= 5) ctaCountScore = 60;
    else ctaCountScore = 0;

    const ctaPlacementScore = aiRatings.cta_placement_quality * 10;

    const totalFields = dom?.forms?.totalFields ?? 0;
    let formFieldScore: number;
    if (totalFields === 0) formFieldScore = 80;
    else if (totalFields <= 4) formFieldScore = 100;
    else if (totalFields <= 7) formFieldScore = 75;
    else formFieldScore = 40;

    const requiredRatio = dom?.forms?.requiredRatio ?? 0;
    let requiredRatioScore: number;
    if (requiredRatio < 0.5) requiredRatioScore = 100;
    else if (requiredRatio <= 0.8) requiredRatioScore = 75;
    else requiredRatioScore = 60;

    const errorHandlingBonus = dom?.errorHandling?.hasErrorHandling ? 10 : 0;

    // Urgency signals (countdown timers, flash sale banners, scarcity text)
    const urgencyBonus = dom?.conversionSignals?.urgency ? 5 : 0;

    // Incentive signals (money-back guarantee, free trial, free shipping)
    const incentivesBonus = dom?.conversionSignals?.incentives ? 10 : 0;

    const score =
      ctaCountScore * 0.25 +
      ctaPlacementScore * 0.25 +
      formFieldScore * 0.2 +
      requiredRatioScore * 0.15 +
      errorHandlingBonus * 0.1 +
      urgencyBonus * 0.025 +
      incentivesBonus * 0.025;

    return Math.min(100, Math.max(0, Math.round(score)));
  }

  // ─── UPDATED MOBILE SCORING ──────────────────────────────────
  private _scoreMobileExperience(lighthouseMobileScore: number, axe: any): number {
    console.log('Mobile Experience Data:', { lighthouseMobileScore, axe });

    const tapScore = axe?.tapTargetScore ?? 80; // fallback if missing
    const overflowScore = axe?.overflowScore ?? 80;
    const textScore = axe?.textScore ?? 80;

    // ✅ Lighthouse = 70% weight — it already covers real mobile performance
    // Tap/overflow/text = 30% combined — supplementary signals only
    const score =
      lighthouseMobileScore * 0.7 + tapScore * 0.15 + overflowScore * 0.1 + textScore * 0.05;

    return Math.min(100, Math.max(0, Math.round(score)));
  }

  private _scoreTrustCredibility(dom: DomAnalysisResult, aiRatings: AIRatings): number {
    let baseScore = 0;

    // HTTPS — use the actual detected boolean (was broken: used empty string before)
    if (dom?.trustSignals?.isHttps) baseScore += 20;

    // Testimonials / reviews / star ratings (schema.org, blockquote, class-based)
    if (dom?.trustSignals?.testimonials) baseScore += 20;

    // Visible contact information (phone, email, or address)
    const hasContact =
      dom?.trustSignals?.contactInfo?.phone ||
      dom?.trustSignals?.contactInfo?.email ||
      dom?.trustSignals?.contactInfo?.address;
    if (hasContact) baseScore += 20;

    // Security/trust badges (SSL, BBB, ISO, money-back text)
    if (dom?.trustSignals?.trustBadges) baseScore += 20;

    // About page link signals transparency and legitimacy
    if (dom?.navLinks?.hasAboutLink) baseScore += 10;

    // Client/partner logo section (social proof via brand association)
    if (dom?.trustSignals?.clientLogos) baseScore += 10;

    const aiBonus = aiRatings.trust_visual_signals >= 7 ? 10 : 0;

    return Math.min(100, Math.max(0, baseScore + aiBonus));
  }

  private _scoreAccessibility(lighthouseAccessibility: number, axe: AxeAuditResult): number {
    let axeScore = 100;
    axeScore -= (axe?.critical ?? 0) * 10;
    axeScore -= (axe?.serious ?? 0) * 5;
    axeScore -= (axe?.moderate ?? 0) * 3;
    axeScore -= (axe?.minor ?? 0) * 1;
    axeScore = Math.min(100, Math.max(0, axeScore));

    const accessibility = Math.round(lighthouseAccessibility * 0.5 + axeScore * 0.5);

    return accessibility;
  }

  private _generateUxuiRecommendations(
    dom: DomAnalysisResult,
    lighthouse: LighthouseResult,
    aiRatings: AIRatings,
    accessibilityScore: number,
    mobileExperience: number,
  ): Recommendation[] {
    const recs: Recommendation[] = [];
    const hasH1 = dom?.structure?.h1 ?? false;
    const totalFields = dom?.forms?.totalFields ?? 0;
    const isHttps = dom?.trustSignals?.isHttps ?? false;
    const hasAboutLink = dom?.navLinks?.hasAboutLink ?? false;
    const hasErrorHandling = dom?.errorHandling?.hasErrorHandling ?? false;
    const tapTargetIssues = false; // LighthouseResult doesn't have tapTargetAudit
    const criticalViolations = 0; // LighthouseResult doesn't have axe property

    // No H1 tag - High priority
    if (!hasH1) {
      recs.push({
        category: 'visualClarity',
        issue: 'Your homepage is missing a primary headline.',
        recommendation:
          'Add an H1 tag with your value proposition in the hero section. Example: &lt;h1&gt;We help [audience] achieve [outcome]&lt;h1&gt;',
        businessValue:
          "Visitors can't immediately understand your core offering, increasing bounce rate.",
        impact: 'High',
      });
    }

    // CTA visibility AI < 5 - High priority
    if (aiRatings.cta_visibility < 5) {
      recs.push({
        category: 'visualClarity',
        issue: "Your primary call-to-action isn't prominent enough.",
        recommendation:
          'Make CTA button larger (min 44px height), use a high-contrast colour not used elsewhere on the page, and place it above the fold.',
        businessValue: 'Visitors may not know what action to take, directly reducing enquiries.',
        impact: 'High',
      });
    }

    // Form fields ≥ 8 - High priority (only when a contact form actually exists)
    const formCount = dom?.forms?.formCount ?? 0;
    if (formCount > 0 && totalFields >= 8) {
      recs.push({
        category: 'conversionOptimization',
        issue: 'Your contact form has too many fields.',
        recommendation:
          'Reduce to 3–4 essential fields (Name, Email, Phone, Message). Move optional fields to a secondary step post-submission.',
        businessValue:
          'Research shows forms with 8+ fields reduce completions by 30–50% compared to forms with 3–4 fields.',
        impact: 'High',
      });
    }

    // Mobile score < 60 - High priority
    if (mobileExperience < 60) {
      recs.push({
        category: 'mobileExperience',
        issue: 'Your mobile experience has significant usability issues.',
        recommendation:
          'Fix tap target sizes (minimum 44×44px), resolve horizontal overflow, and ensure text is readable without pinching.',
        businessValue:
          'With the majority of your visitors likely on mobile, this is suppressing conversions across your site.',
        impact: 'High',
      });
    }

    // Tap target issues - Medium priority
    if (tapTargetIssues) {
      recs.push({
        category: 'accessibility',
        issue: 'Buttons and links on your mobile site are too small or too close together.',
        recommendation:
          'Increase tap target sizes to at least 44×44px and add 8px spacing between interactive elements.',
        businessValue: 'Visitors are likely mis-tapping, causing frustration and drop-off.',
        impact: 'Medium',
      });
    }

    // No HTTPS - High priority
    if (!isHttps) {
      recs.push({
        category: 'trust',
        issue: 'Your site does not use HTTPS.',
        recommendation:
          "Install an SSL/TLS certificate via your hosting provider. Most offer free Let's Encrypt SSL.",
        businessValue:
          'Browsers display a "Not Secure" warning, which immediately damages visitor trust before they\'ve read a word.',
        impact: 'High',
      });
    }

    // No testimonials - High priority
    if (!dom?.trustSignals?.testimonials) {
      recs.push({
        category: 'trust',
        issue: 'Your site has no visible customer testimonials or reviews.',
        recommendation:
          'Add 3–5 specific, named testimonials with outcomes to your homepage. Include a photo where possible.',
        businessValue:
          'Social proof is the #1 trust driver — its absence makes visitors hesitant to enquire.',
        impact: 'High',
      });
    }

    // No about page - Medium priority
    if (!hasAboutLink) {
      recs.push({
        category: 'trust',
        issue: "Your site doesn't have an About page.",
        recommendation:
          'Create an About page describing your team, story and credentials. Link it from the main navigation.',
        businessValue:
          'Visitors frequently look for this before deciding to contact a business — its absence raises uncertainty.',
        impact: 'Medium',
      });
    }

    // axe critical violations - High priority
    if (criticalViolations > 0) {
      recs.push({
        category: 'accessibility',
        issue:
          'Your site has critical accessibility barriers that prevent some visitors from using it.',
        recommendation: `Fix the specific WCAG violations identified: ${criticalViolations} critical violation(s) found.`,
        businessValue: 'This also indicates broader usability issues affecting all users.',
        impact: 'High',
      });
    }

    // Design consistency AI < 5 - Medium priority
    if (aiRatings.design_consistency < 5) {
      recs.push({
        category: 'visualClarity',
        issue: "Your site's visual design appears inconsistent.",
        recommendation:
          'Establish a design system with 2 brand colours, 1 CTA colour, and consistent button styles. Apply across all pages.',
        businessValue:
          'Inconsistent colours and button styles erode professionalism and reduce user confidence.',
        impact: 'Medium',
      });
    }
    // Only flag error handling absence if a contact form actually exists
    if (!hasErrorHandling && (dom?.forms?.formCount ?? 0) > 0) {
      recs.push({
        category: 'conversionOptimization',
        issue: "Your contact form doesn't show errors when fields are filled incorrectly.",
        recommendation:
          'Add inline validation that highlights errors in real-time as users type, with specific messages per field.',
        businessValue: 'Users who hit submit and get no feedback often abandon the form entirely.',
        impact: 'Medium',
      });
    }

    const order: Record<string, number> = { High: 0, Medium: 1, Low: 2 };
    return recs.sort((a, b) => order[a.impact as string] - order[b.impact as string]);
  }

  private _calculateGrade(score: number): string {
    if (score >= 90) return 'A+';
    if (score >= 80) return 'A';
    if (score >= 70) return 'B+';
    if (score >= 60) return 'B-';
    if (score >= 40) return 'C';
    return 'F';
  }

  private _getLabel(score: number): string {
    if (score >= 90) return 'Excellent';
    if (score >= 80) return 'Good';
    if (score >= 60) return 'Average';
    if (score >= 40) return 'Below Average';
    return 'Poor';
  }

  private _getMessage(score: number): string {
    if (score >= 90) return 'Outstanding performance. Your site is well-optimized.';
    if (score >= 80) return 'Solid foundation with some technical gaps worth addressing.';
    if (score >= 60) return 'Room for improvement. Key areas need attention.';
    if (score >= 40) return 'Significant issues detected. Focus on critical fixes first.';
    return 'Critical issues require immediate attention.';
  }
}
