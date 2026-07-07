import { Page } from 'puppeteer';
import OpenAI from 'openai';

// ─── TYPES ───────────────────────────────────────────────────
export interface DeviceConfig {
  userAgent: string;
  viewport: {
    width: number;
    height: number;
    deviceScaleFactor: number;
    isMobile: boolean;
    hasTouch: boolean;
  };
}
export interface ScreenshotResult {
  desktop: { base64: string };
  mobile: { base64: string };
}
export interface RawVisualScores {
  value_proposition_clarity: number;
  cta_visibility: number;
  above_fold_clarity: number;
  whitespace_balance: number;
  design_consistency: number;
  typography_variation: number;
  cta_placement_quality: number;
  trust_visual_signals: number;
}
export interface VisualAnalysisResult {
  device: string;
  scores: RawVisualScores;
  overall_visual_score: number;
  ux_health_contribution: {
    raw_score: number;
    weighted_score: number;
    category: string;
    weight: string;
  };
}
export interface CombinedVisualResult {
  desktop: VisualAnalysisResult;
  mobile: VisualAnalysisResult;
  combined_ux_health: {
    visual_clarity_raw: number;
    weighted_contribution: number;
    note: string;
    desktop_score: number;
    mobile_score: number;
  };
}

// ─── CONFIGS ─────────────────────────────────────────────────
export const DESKTOP_CONFIG: DeviceConfig = {
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  viewport: { width: 1440, height: 900, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
};
export const MOBILE_CONFIG: DeviceConfig = {
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  viewport: { width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true },
};
export const BLOCKED_DOMAINS = [
  'google-analytics.com',
  'googletagmanager.com',
  'hotjar.com',
  'intercom.io',
  'crisp.chat',
  'tawk.to',
  'facebook.net',
  'doubleclick.net',
];
export const DIMENSION_KEYS: (keyof RawVisualScores)[] = [
  'value_proposition_clarity',
  'cta_visibility',
  'above_fold_clarity',
  'whitespace_balance',
  'design_consistency',
  'typography_variation',
  'cta_placement_quality',
  'trust_visual_signals',
];

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// ─── SAFE HELPERS ────────────────────────────────────────────
export const safeEvaluate = async <T>(
  page: Page,
  fn: () => T,
  retries = 3,
): Promise<T | undefined> => {
  for (let i = 0; i < retries; i++) {
    try {
      return await page.evaluate(fn);
    } catch {
      if (i < retries - 1) await sleep(800);
    }
  }
  return undefined;
};
export const safeAddStyleTag = async (page: Page, css: string, retries = 3): Promise<void> => {
  for (let i = 0; i < retries; i++) {
    try {
      await page.addStyleTag({ content: css });
      return;
    } catch {
      if (i < retries - 1) await sleep(800);
    }
  }
};

// ─── PAGE READY WAIT ─────────────────────────────────────────
// ✅ Removed hardcoded 3000ms sleep — adaptive SPA detection instead
export const waitForPageReady = async (page: Page): Promise<void> => {
  await page
    .waitForFunction(
      () => {
        const text = document.body?.innerText?.trim() || '';
        const hasMain = document.querySelector("main, #app, #root, [class*='hero'], h1") !== null;
        return text.length > 200 && hasMain;
      },
      { timeout: 10000 },
    )
    .catch(() => {});

  // Only add extra wait for SPA frameworks — saves ~2s on static sites
  const isSPA = await page
    .evaluate(
      () =>
        !!(
          document.getElementById('__NEXT_DATA__') ||
          document.getElementById('__nuxt') ||
          document.querySelector('[data-reactroot]') ||
          (window as any).__VUE__
        ),
    )
    .catch(() => false);

  if (isSPA) {
    await page.waitForNetworkIdle({ idleTime: 800, timeout: 8000 }).catch(() => {});
  }
};

// ─── COOKIE BANNER ───────────────────────────────────────────
export const dismissCookieBanner = async (page: Page): Promise<void> => {
  await safeEvaluate(page, () => {
    const selectors = [
      "[id*='cookie']",
      "[id*='consent']",
      "[id*='gdpr']",
      "[id*='banner']",
      "[id*='notice']",
      "[id*='notification']",
      "[id*='popup']",
      "[class*='cookie']",
      "[class*='consent']",
      "[class*='gdpr']",
      "[class*='banner']",
      "[class*='notice']",
      "[class*='notification']",
      "[class*='CookieBanner']",
      "[class*='cookie-bar']",
      '[data-cookie]',
      '[data-consent]',
    ];
    const banners: Element[] = [];
    selectors.forEach((sel) => {
      try {
        document.querySelectorAll(sel).forEach((el) => {
          const r = el.getBoundingClientRect();
          if (r.width > 50 && r.height > 20) banners.push(el);
        });
      } catch (error) {
        console.warn(`Failed to process selector "${sel}":`, error);
      }
    });
    document.querySelectorAll('*').forEach((el) => {
      try {
        const c = window.getComputedStyle(el);
        const fixed = c.position === 'fixed' || c.position === 'sticky';
        const edge =
          c.bottom === '0px' ||
          parseInt(c.bottom || '999') < 150 ||
          c.top === '0px' ||
          parseInt(c.top || '999') < 150;
        const cookieText = (el as HTMLElement).innerText
          ?.toLowerCase()
          .match(/cookie|privacy|consent|gdpr|we use|tracking/);
        if (fixed && edge && cookieText && el.getBoundingClientRect().height < 300)
          banners.push(el);
      } catch (error) {
        console.warn(`Failed to process selector`, error);
      }
    });
    if (!banners.length) return;
    let clicked = false;
    for (const banner of banners) {
      if (clicked) break;
      for (const pattern of [
        "[aria-label*='close' i]",
        "[aria-label*='dismiss' i]",
        "[class*='close']",
        "[class*='dismiss']",
        "[class*='reject']",
        'button',
        'a',
        "[role='button']",
      ]) {
        try {
          for (const btn of banner.querySelectorAll(pattern)) {
            const text = ((btn as HTMLElement).innerText || btn.getAttribute('aria-label') || '')
              .toLowerCase()
              .trim();
            const isClose =
              ['x', '×', '✕', '✖', 'close', 'dismiss', 'reject', 'reject all', 'deny'].includes(
                text,
              ) || text.length === 0;
            const isExternal =
              btn.tagName === 'A' &&
              btn.getAttribute('href') &&
              !btn.getAttribute('href')!.startsWith('#');
            if (isClose && !isExternal) {
              (btn as HTMLElement).click();
              clicked = true;
              break;
            }
          }
        } catch (error) {
          console.warn(`Failed to process selector:`, error);
        }
        if (clicked) break;
      }
    }
  });

  // ✅ 300ms instead of 600ms
  await sleep(300);

  await safeAddStyleTag(
    page,
    `
    [id*="cookie"],[id*="consent"],[id*="gdpr"],
    [class*="cookie"],[class*="consent"],[class*="gdpr"],
    [class*="cookie-banner"],[class*="cookie-bar"],[class*="cookie-notice"],
    [class*="cookie-popup"],[class*="CookieBanner"],[class*="privacy-banner"],
    [data-cookie],[data-consent]{display:none!important;}
  `,
  );

  await safeEvaluate(page, () => {
    document.querySelectorAll('*').forEach((el) => {
      try {
        const c = window.getComputedStyle(el);
        const fixed = c.position === 'fixed' || c.position === 'sticky';
        const edge =
          c.bottom === '0px' ||
          parseInt(c.bottom || '999') < 150 ||
          c.top === '0px' ||
          parseInt(c.top || '999') < 150;
        if (
          fixed &&
          edge &&
          (el as HTMLElement).innerText?.toLowerCase().match(/cookie|privacy|consent|gdpr/) &&
          el.getBoundingClientRect().height < 300
        ) {
          (el as HTMLElement).style.setProperty('display', 'none', 'important');
        }
      } catch (error) {
        console.warn(`Failed to process selector:`, error);
      }
    });
  });
};

// ─── FIX IMAGES ──────────────────────────────────────────────
// ✅ Conditional wait — only delays if HEIF images actually found
export const fixUnsupportedImages = async (page: Page): Promise<void> => {
  const hadHeif = await safeEvaluate(page, () => {
    let found = false;
    document.querySelectorAll('img').forEach((img) => {
      const src = img.src || img.getAttribute('src') || '';
      const srcToCheck = src || img.getAttribute('data-src') || '';
      if (srcToCheck.includes('.heif') || srcToCheck.includes('.heic')) {
        found = true;
        const fixed = srcToCheck
          .replace('.heif', '.jpg')
          .replace('.heic', '.jpg')
          .replace('fm=heif', 'fm=jpg')
          .replace('fm=heic', 'fm=jpg');
        img.src = srcToCheck.includes('_next/image') ? srcToCheck + '&fm=jpg' : fixed;
        if (img.getAttribute('data-src')) img.setAttribute('data-src', img.src);
      }
      const srcset = img.getAttribute('srcset') || '';
      if (srcset.includes('.heif') || srcset.includes('.heic'))
        img.setAttribute('srcset', srcset.replace(/\.heif/g, '.jpg').replace(/\.heic/g, '.jpg'));
    });
    return found;
  });
  // ✅ Skip 2000ms wait entirely on non-HEIF sites (the vast majority)
  if (hadHeif) await sleep(1200);
};

// ─── SCROLL ──────────────────────────────────────────────────
// ✅ 350ms per step (was 600ms), 800ms at top (was 2000ms)
export const slowScrollToLoad = async (page: Page): Promise<void> => {
  const vh = await page.evaluate(() => window.innerHeight);
  let total = await page.evaluate(() =>
    Math.max(document.documentElement.scrollHeight, document.body.scrollHeight),
  );
  let pos = 0;
  while (pos < total) {
    pos += vh * 0.8;
    await page.evaluate((y) => window.scrollTo(0, y), pos);
    await sleep(350);
    const newH = await page.evaluate(() =>
      Math.max(document.documentElement.scrollHeight, document.body.scrollHeight),
    );
    if (newH > total) total = newH;
  }
  // Wait only for lazy-loaded images specifically
  await page.evaluate(async () => {
    const imgs = [...document.querySelectorAll('img[loading="lazy"],img[data-src]')];
    await Promise.allSettled(
      imgs.map(
        (img) =>
          new Promise<void>((resolve) => {
            if ((img as HTMLImageElement).complete) return resolve();
            img.addEventListener('load', () => resolve(), { once: true });
            img.addEventListener('error', () => resolve(), { once: true });
            setTimeout(resolve, 2000);
          }),
      ),
    );
  });
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(800);
};

// ─── FIX WHITE GAPS ──────────────────────────────────────────
export const fixWhiteGaps = async (page: Page): Promise<void> => {
  await safeEvaluate(page, () => {
    document.querySelectorAll('div,span,section').forEach((el) => {
      const rect = el.getBoundingClientRect();
      const style = el.getAttribute('style') || '';
      const computed = window.getComputedStyle(el);
      const empty =
        (el as HTMLElement).innerText?.trim() === '' &&
        el.querySelectorAll('img,video,canvas,svg').length === 0;
      const transparent = ['rgba(0, 0, 0, 0)', 'transparent', 'rgb(255, 255, 255)'].includes(
        computed.backgroundColor,
      );
      if (empty && rect.height > 100 && style.includes('height') && transparent) {
        const s = (el as HTMLElement).style;
        s.setProperty('height', '0', 'important');
        s.setProperty('min-height', '0', 'important');
        s.setProperty('overflow', 'hidden', 'important');
        s.setProperty('padding', '0', 'important');
        s.setProperty('margin', '0', 'important');
      }
    });
  });
  await safeAddStyleTag(
    page,
    `header,nav,[class*="header"],[class*="navbar"]{position:relative!important;top:auto!important;}`,
  );
};

// ─── AI PROMPT ───────────────────────────────────────────────
// ✅ Condensed system prompt — same instructions, fewer tokens = lower cost + faster response
export const SYSTEM_PROMPT = `You are a strict UX/CRO auditor. Evaluate ONLY clearly visible elements. Do NOT assume missing elements exist.

RULES: If element NOT visible → score 1-4. Ignore banners/popups/overlays/artifacts. Be conservative.
SCORING: 1-3=Missing, 4-5=Weak, 6-7=Acceptable, 8-9=Strong, 10=Exceptional. High scores need evidence.

DIMENSIONS:
value_proposition_clarity: Clear headline? Vague/missing → ≤4
cta_visibility: Visible primary CTA button? Missing → ≤3
above_fold_clarity: Purpose clear without scrolling? Confusing → ≤5
whitespace_balance: Elements spaced properly? Cluttered → ≤5
design_consistency: Buttons/colors/fonts consistent? Inconsistent → ≤5
typography_variation: Font readable and consistent? Chaotic → ≤5
cta_placement_quality: CTA in logical position? Missing/poor → ≤4
trust_visual_signals: Testimonials/logos/badges visible? None visible → MUST be ≤3

Return ONLY valid JSON, no markdown:
{"value_proposition_clarity":<1-10>,"cta_visibility":<1-10>,"above_fold_clarity":<1-10>,"whitespace_balance":<1-10>,"design_consistency":<1-10>,"typography_variation":<1-10>,"cta_placement_quality":<1-10>,"trust_visual_signals":<1-10>}`;

export const safeParse = <T>(text: string): T | null => {
  try {
    return JSON.parse(text) as T;
  } catch {
    try {
      return JSON.parse(text.replace(/```json|```/gi, '').trim()) as T;
    } catch {
      return null;
    }
  }
};

export const validateRawScores = (obj: unknown): obj is RawVisualScores => {
  if (!obj || typeof obj !== 'object') return false;
  return DIMENSION_KEYS.every(
    (key) =>
      key in (obj as Record<string, unknown>) &&
      typeof (obj as Record<string, number>)[key] === 'number' &&
      (obj as Record<string, number>)[key] >= 1 &&
      (obj as Record<string, number>)[key] <= 10,
  );
};

export const buildAnalysisResult = (
  scores: RawVisualScores,
  device: 'desktop' | 'mobile',
): VisualAnalysisResult => {
  const avg =
    DIMENSION_KEYS.map((k) => scores[k]).reduce((a, b) => a + b, 0) / DIMENSION_KEYS.length;
  const overall = parseFloat(avg.toFixed(1));
  const raw = parseFloat((overall * 10).toFixed(1));
  return {
    device,
    scores,
    overall_visual_score: overall,
    ux_health_contribution: {
      raw_score: raw,
      weighted_score: parseFloat((raw * 0.2).toFixed(1)),
      category: 'Visual Clarity',
      weight: '20%',
    },
  };
};

export const analyzeScreenshot = async (
  openai: OpenAI,
  base64Image: string,
  device: 'desktop' | 'mobile',
): Promise<VisualAnalysisResult> => {
  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    max_tokens: 200, // ✅ reduced from 300 — we only need 8 numbers
    temperature: 0.2,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: { url: `data:image/jpeg;base64,${base64Image}`, detail: 'high' },
          },
        ],
      },
    ],
  });
  const rawText = response.choices?.[0]?.message?.content ?? '';
  const parsed = safeParse<RawVisualScores>(rawText);
  if (!parsed || !validateRawScores(parsed))
    throw new Error(`AI response invalid for ${device}. Raw: ${rawText.slice(0, 200)}`);
  return buildAnalysisResult(parsed, device);
};
