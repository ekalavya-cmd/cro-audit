import * as cheerio from 'cheerio';
import { AnyNode } from 'domhandler';
import type { CheckLinksResult, LinkResult } from '../modules/audit/types/checkLinks.types';

// ─── Constants ─────────────────────────────────────────────────────────────

const TIMEOUT_MS = 8000;
const MAX_REDIRECT_HOPS = 10;
const CONCURRENCY = 10; // max simultaneous HTTP checks

// File extensions that are valid checkable resources (not just HTML pages)
const CHECKABLE_EXTENSIONS = /\.(pdf|docx?|xlsx?|pptx?|zip|rar|tar|gz|csv|txt|xml|json)(\?|$)/i;

// Extensions to skip entirely (media / fonts that can't be "broken" in context)
const SKIP_EXTENSIONS =
  /\.(svg|png|jpe?g|webp|gif|avif|ico|bmp|woff2?|ttf|eot|mp4|mp3|avi|mov|ogg|ogv)(\?|$)/i;

// First-party CDN subdomain prefixes — treated as internal
const FIRST_PARTY_CDN = /^(cdn|assets|static|media|images?|img|files|downloads)\./i;

// ─── Utilities ──────────────────────────────────────────────────────────────

/** Strip www. for hostname comparison */
const stripWww = (host: string) => host.replace(/^www\./, '');

/** Strip fragment and normalise trailing slash from an absolute URL */
const normaliseUrl = (href: string): string => {
  try {
    const u = new URL(href);
    u.hash = '';
    u.pathname = u.pathname.replace(/\/$/, '') || '/';
    return u.href.toLowerCase();
  } catch {
    return href.toLowerCase();
  }
};

/** Determine whether a resolved href is internal to the base domain */
const isInternal = (href: string, baseDomain: string): boolean => {
  try {
    const u = new URL(href);
    const linkHost = u.hostname;
    const base = stripWww(baseDomain);
    const link = stripWww(linkHost);

    // Exact match or subdomain match
    if (link === base || link.endsWith(`.${base}`)) return true;

    // First-party CDN subdomains
    if (FIRST_PARTY_CDN.test(linkHost) && link.endsWith(`.${base}`)) return true;

    return false;
  } catch {
    return false;
  }
};

/** Jitter delay between concurrency batches */
const jitter = (min = 50, max = 200) =>
  new Promise((r) => setTimeout(r, min + Math.random() * (max - min)));

/** Run async tasks with a concurrency cap */
async function pMap<T>(
  items: T[],
  fn: (item: T) => Promise<void>,
  concurrency: number,
): Promise<void> {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length) {
      const item = queue.shift()!;
      await fn(item);
      if (queue.length) await jitter();
    }
  });
  await Promise.all(workers);
}

// ─── Main ───────────────────────────────────────────────────────────────────

export async function checkLinks(url: string, html: string): Promise<CheckLinksResult> {
  const baseUrl = new URL(url);
  const baseDomain = baseUrl.hostname;
  const $ = cheerio.load(html);

  // ─── 1. Link Extraction ─────────────────────────────────────────────────

  const rawHrefs = new Set<string>();

  /**
   * Resolve and add a raw href string.
   * Skips: mailto, tel, javascript, data URIs, pure fragments, media files.
   * Includes: HTML pages, file downloads, data-href SPA links, area maps.
   */
  const addHref = (raw: string | undefined) => {
    if (!raw) return;
    const trimmed = raw.trim();
    if (!trimmed) return;
    if (/^(mailto:|tel:|javascript:|data:|#)/i.test(trimmed)) return;
    if (SKIP_EXTENSIONS.test(trimmed)) return;

    try {
      // Strip fragment before resolving to avoid duplicate same-page links
      const withoutFragment = trimmed.replace(/#[^?]*$/, '');
      const absolute = new URL(withoutFragment || '/', url).href;
      rawHrefs.add(normaliseUrl(absolute));
    } catch {
      // Skip malformed
    }
  };

  // Standard <a href>
  $('a[href]').each((_, el) => addHref($(el).attr('href')));

  // <area href> — image maps (legacy enterprise/government sites)
  $('area[href]').each((_, el) => addHref($(el).attr('href')));

  // [data-href] — SPA navigation (React/Angular router link components)
  $('[data-href]').each((_, el) => addHref($(el).attr('data-href')));

  // Downloadable file links that might otherwise be stripped
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') || '';
    if (CHECKABLE_EXTENSIONS.test(href)) addHref(href);
  });

  // <link rel="canonical"> — count towards internal, but don't HTTP-check
  const canonicalHref = $('link[rel="canonical"]').attr('href');
  let canonicalIsInternal = false;
  if (canonicalHref) {
    try {
      const abs = new URL(canonicalHref, url).href;
      canonicalIsInternal = isInternal(abs, baseDomain);
    } catch {
      /* ignore */
    }
  }

  const uniqueHrefs = [...rawHrefs];

  // ─── 2. Internal / External Classification ──────────────────────────────

  // Click-depth zone detection for avgClickDepth calculation
  // Zone 1 = nav/header, Zone 2 = main/article, Zone 3 = footer
  const depthMap = new Map<string, number>(); // href → min zone

  const zoneLinks = (selector: string, zone: number) => {
    $(selector)
      .find('a[href]')
      .each((_, el) => {
        const raw = $(el).attr('href') || '';
        if (/^(mailto:|tel:|javascript:|data:|#)/i.test(raw)) return;
        try {
          const abs = normaliseUrl(new URL(raw.replace(/#[^?]*$/, '') || '/', url).href);
          if (!depthMap.has(abs) || depthMap.get(abs)! > zone) {
            depthMap.set(abs, zone);
          }
        } catch {
          /* skip */
        }
      });
  };

  zoneLinks('header, nav, [role="navigation"], [role="banner"]', 1);
  zoneLinks('main, [role="main"], article, section', 2);
  zoneLinks('footer, [role="contentinfo"]', 3);

  let internal = canonicalIsInternal ? 1 : 0;
  let external = 0;
  const externalLinks: string[] = [];
  const internalHrefs = new Set<string>();

  for (const href of uniqueHrefs) {
    if (isInternal(href, baseDomain)) {
      internal++;
      internalHrefs.add(href);
    } else {
      external++;
      externalLinks.push(href);
    }
  }

  // ─── 3. Navigation Link Extraction (4-tier scoring) ─────────────────────

  type NavCandidate = { el: cheerio.Cheerio<AnyNode>; score: number };
  const candidates: NavCandidate[] = [];

  const addCandidate = (el: cheerio.Cheerio<AnyNode>, score: number) => {
    if (el.length) candidates.push({ el, score });
  };

  // Tier 1: <nav> / [role="navigation"] — scored by aria-label, id/class, position
  $('nav, [role="navigation"]').each((_, el) => {
    const label = ($(el).attr('aria-label') || $(el).attr('aria-labelledby') || '').toLowerCase();
    const id = $(el).attr('id')?.toLowerCase() || '';
    const cls = $(el).attr('class')?.toLowerCase() || '';
    let score = 50;
    if (/\b(main|primary|site|global|top)\b/.test(label)) score += 60;
    if (/\b(main|primary|site|global|top|navbar|header)\b/.test(`${id} ${cls}`)) score += 30;
    if ($(el).closest('header, [role="banner"]').length) score += 40;
    addCandidate($(el), score);
  });

  // Tier 2: <header> with direct anchor links (React/Tailwind no-list pattern)
  $('header').each((_, el) => {
    if ($(el).find('a').length >= 2) addCandidate($(el), 30);
  });

  // Tier 3: Scored ul/ol lists outside footer/main/aside (legacy / WordPress)
  $('ul, ol')
    .filter((_, el) => {
      if ($(el).closest('footer, [role="contentinfo"], .footer, #footer').length) return false;
      if ($(el).closest('main, [role="main"], aside, article').length) return false;
      return $(el).children('li').children('a').length >= 2;
    })
    .each((_, el) => {
      const inNav = $(el).closest('header, nav, [role="navigation"], [role="banner"]').length > 0;
      const directLinks = $(el).children('li').children('a').length;
      addCandidate($(el), (inNav ? 80 : 10) + directLinks);
    });

  // Tier 4: Legacy — table inside header region
  $('header table, .header table, #header table').each((_, el) => {
    if ($(el).find('a').length >= 2) addCandidate($(el), 15);
  });

  candidates.sort((a, b) => b.score - a.score);
  const primaryNav = candidates[0]?.el ?? $();

  const normaliseNavHref = (raw: string, fallback: string): string => {
    if (!raw || raw === '#') return fallback.toLowerCase().trim();
    return raw.replace(/\/$/, '').replace(/#.*$/, '').toLowerCase();
  };

  // All nav anchors (supports mega menus via .find)
  const navAnchors = primaryNav.find('a').filter((_, el) => {
    const text = $(el).text().trim();
    const href = $(el).attr('href') || '';
    return text.length > 0 && !/^(mailto:|tel:|javascript:)/i.test(href);
  });

  const uniqueNavHrefs = new Set(
    navAnchors.toArray().map((el) => normaliseNavHref($(el).attr('href') || '', $(el).text())),
  );
  const navTotalCount = uniqueNavHrefs.size;

  // Top-level: direct children (supports `nav > a` and `li:not(li li) > a`)
  const topLevelAnchors = primaryNav.find('> a, > ul > li > a, > ol > li > a, li:not(li li) > a');
  const uniqueTopLevel = new Set(
    topLevelAnchors
      .filter((_, el) => $(el).text().trim().length > 0)
      .toArray()
      .map((el) => normaliseNavHref($(el).attr('href') || '', $(el).text())),
  );
  const navTopLevelCount = uniqueTopLevel.size;

  const aboutKeywords = [
    'about',
    'about us',
    'about-us',
    'who we are',
    'our story',
    'our team',
    'company',
  ];
  const hasAboutLink =
    $('body')
      .find('a')
      .filter((_, el) => {
        const text = $(el).text().toLowerCase().trim();
        const href = ($(el).attr('href') || '').toLowerCase();
        return aboutKeywords.some((kw) => text.includes(kw) || href.includes(kw));
      }).length > 0;

  // ─── 4. HTTP Link Validation ─────────────────────────────────────────────

  const brokenLinks: LinkResult[] = [];
  const errorLinks: LinkResult[] = [];
  const singleRedirects: LinkResult[] = [];
  const redirectChains: LinkResult[] = [];
  let validCount = internal; // all internal links assumed valid (not crawled)

  /**
   * Follow redirects manually, returning each hop's URL, final status, and
   * whether we detected an http→https-only upgrade (not a real redirect).
   */
  const followRedirects = async (
    href: string,
  ): Promise<{ finalUrl: string; hops: number; finalStatus: number; chain: string[] }> => {
    let current = href;
    const chain: string[] = [href];
    const seen = new Set<string>([href]);
    let lastStatus = 0;

    for (let hop = 0; hop < MAX_REDIRECT_HOPS; hop++) {
      try {
        const res = await fetch(current, {
          method: 'GET',
          redirect: 'manual',
          signal: AbortSignal.timeout(TIMEOUT_MS),
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
            Accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
          },
        });
        lastStatus = res.status;

        if (res.status >= 300 && res.status < 400) {
          const location = res.headers.get('location');
          if (!location) break;

          const next = new URL(location, current).href;

          // Detect http→https-only upgrade (same host, path, query — just protocol)
          const cur = new URL(current);
          const nxt = new URL(next);
          const isProtocolUpgradeOnly =
            cur.protocol === 'http:' &&
            nxt.protocol === 'https:' &&
            cur.hostname === nxt.hostname &&
            cur.pathname === nxt.pathname &&
            cur.search === nxt.search;

          if (isProtocolUpgradeOnly) {
            // Don't count as a real hop
            current = next;
            continue;
          }

          // Detect redirect loops
          if (seen.has(next)) break;
          seen.add(next);
          chain.push(next);
          current = next;
        } else {
          break;
        }
      } catch {
        break;
      }
    }

    // Exclude the starting URL from hop count
    const realHops = chain.length - 1;
    return { finalUrl: current, hops: realHops, finalStatus: lastStatus, chain };
  };

  const browserHeaders = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    Connection: 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    'Cache-Control': 'max-age=0',
  };

  const checkOne = async (href: string): Promise<void> => {
    // ── Step 1: HEAD request ──────────────────────────────────────
    let status: number | null = null;
    let usedGet = false;

    try {
      const headRes = await fetch(href, {
        method: 'HEAD',
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: browserHeaders,
      });
      status = headRes.status;

      // HEAD blocked by server — fall through to GET
      if (status === 405 || status === 501) {
        status = null;
      }
    } catch {
      // Network failure on HEAD — try GET
    }

    // ── Step 2: GET fallback (if HEAD failed / blocked) ───────────
    if (status === null) {
      usedGet = true;
      try {
        const getRes = await fetch(href, {
          method: 'GET',
          redirect: 'manual',
          signal: AbortSignal.timeout(TIMEOUT_MS),
          headers: browserHeaders,
        });
        status = getRes.status;
      } catch {
        errorLinks.push({ url: href, status: 'error', redirects: 0, redirectChain: [] });
        return;
      }
    }

    if (status === null) {
      errorLinks.push({ url: href, status: 'error', redirects: 0, redirectChain: [] });
      return;
    }

    // ── Step 3: Classify status ───────────────────────────────────

    // Redirect — follow chain
    if (status >= 300 && status < 400) {
      try {
        const { hops, finalStatus, chain } = await followRedirects(href);
        const linkData: LinkResult = {
          url: href,
          status: finalStatus,
          redirects: hops,
          redirectChain: chain,
        };
        if (hops > 1) redirectChains.push(linkData);
        else if (hops === 1) singleRedirects.push(linkData);
        else validCount++;
      } catch {
        validCount++;
      }
      return;
    }

    // 2xx — valid
    if (status >= 200 && status < 300) {
      validCount++;
      return;
    }

    // Anti-bot / auth barriers — not genuinely broken
    if ([400, 401, 403, 406, 429].includes(status)) {
      validCount++;
      return;
    }

    // Transient server errors — retry once with GET if we used HEAD
    if ((status === 502 || status === 503 || status === 504) && !usedGet) {
      try {
        const retryRes = await fetch(href, {
          method: 'GET',
          redirect: 'manual',
          signal: AbortSignal.timeout(TIMEOUT_MS),
          headers: browserHeaders,
        });
        if (retryRes.status >= 200 && retryRes.status < 300) {
          validCount++;
          return;
        }
      } catch {
        /* fall through to error */
      }
    }

    // Genuinely gone
    if (status === 410) {
      brokenLinks.push({ url: href, status, redirects: 0, redirectChain: [] });
      return;
    }

    // Other 4xx/5xx
    if (status >= 400) {
      brokenLinks.push({ url: href, status, redirects: 0, redirectChain: [] });
      return;
    }

    // Anything else (1xx, etc.) — treat as valid
    validCount++;
  };

  // Run with concurrency cap + jitter
  await pMap(externalLinks, checkOne, CONCURRENCY);

  // ─── 5. Summary Metrics ──────────────────────────────────────────────────

  const total =
    validCount +
    brokenLinks.length +
    errorLinks.length +
    singleRedirects.length +
    redirectChains.length;

  // avgClickDepth: weighted average of zone depth for all internal links
  let depthSum = 0;
  let depthCount = 0;
  for (const href of internalHrefs) {
    const zone = depthMap.get(href);
    if (zone !== undefined) {
      depthSum += zone;
      depthCount++;
    }
  }
  // Default to 1.0 if no depth info available
  const avgClickDepth = depthCount > 0 ? Number((depthSum / depthCount).toFixed(2)) : 1;

  // orphanPages: internal links found ONLY in footer (zone 3), not in nav/header (zone 1) or main (zone 2)
  const navMainHrefs = new Set<string>();
  zoneLinks(
    'header, nav, [role="navigation"], [role="banner"], main, [role="main"], article, section',
    1,
  );

  $('header, nav, [role="navigation"], [role="banner"], main, [role="main"], article, section')
    .find('a[href]')
    .each((_, el) => {
      const raw = $(el).attr('href') || '';
      if (/^(mailto:|tel:|javascript:|data:|#)/i.test(raw)) return;
      try {
        const abs = normaliseUrl(new URL(raw.replace(/#[^?]*$/, '') || '/', url).href);
        if (isInternal(abs, baseDomain)) navMainHrefs.add(abs);
      } catch {
        /* skip */
      }
    });

  let orphanPages = 0;
  for (const href of internalHrefs) {
    if (!navMainHrefs.has(href) && depthMap.get(href) === 3) {
      orphanPages++;
    }
  }

  // ─── Return ───────────────────────────────────────────────────────────────

  return {
    brokenLinks: [...brokenLinks, ...errorLinks],
    navigation: { internal, external },
    navLinks: {
      totalCount: navTotalCount,
      topLevelCount: navTopLevelCount,
      hasAboutLink,
    },
    summary: {
      total,
      valid: validCount,
      broken: brokenLinks.length,
      error: errorLinks.length,
      avgClickDepth,
      orphanPages,
      redirects: singleRedirects.length,
      redirectChain: redirectChains.length,
    },
  };
}
