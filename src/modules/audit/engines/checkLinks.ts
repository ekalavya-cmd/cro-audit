import puppeteer, { Browser } from 'puppeteer';
import blc from 'broken-link-checker';
import type { Link } from 'broken-link-checker';
import { CheckLinksResult, LinkResult } from '../types/checkLinks.types';

const { HtmlChecker } = blc;

export async function checkLinks(url: string): Promise<CheckLinksResult> {
  let browser: Browser | null = null;

  try {
    browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();

    await page.goto(url, { waitUntil: 'networkidle2' });
    const html = await page.content();

    const baseDomain = new URL(url).hostname;

    const normalize = (host: string) => host.replace(/^www\./, '');

    const getHostname = (link: string): string | null => {
      try {
        return new URL(link).hostname;
      } catch {
        return null;
      }
    };

    const isInternal = (linkHost: string, baseHost: string): boolean => {
      const a = normalize(linkHost);
      const b = normalize(baseHost);

      return a === b || a.endsWith(`.${b}`);
    };

    return await new Promise<CheckLinksResult>((resolve, reject) => {
      const brokenLinks: LinkResult[] = [];
      const errorLinks: LinkResult[] = [];
      const redirectChains: LinkResult[] = [];
      const singleRedirects: LinkResult[] = [];

      let validCount = 0;
      let internal = 0;
      let external = 0;
      const depth = 1;

      const checker = new HtmlChecker(
        {
          maxSockets: 5,
          maxSocketsPerHost: 2,
          requestMethod: 'get',
          userAgent:
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
          retry405Head: true,
          retryHeadFail: true,
          timeout: 15000,
        },
        {
          link: (result: Link) => {
            const resolvedUrl = result.url?.resolved;
            const status = result.http?.statusCode;
            const redirects = result.http?.redirects ?? [];
            const redirectsCount = redirects.length;

            if (
              !resolvedUrl ||
              resolvedUrl.startsWith('mailto:') ||
              resolvedUrl.startsWith('tel:') ||
              resolvedUrl.startsWith('javascript:') ||
              /\.(svg|png|jpg|jpeg|webp|gif)(\?|$)/i.test(resolvedUrl)
            ) {
              return;
            }

            const linkHost = getHostname(resolvedUrl);
            if (!linkHost) return;

            if (isInternal(linkHost, baseDomain)) {
              internal++;
            } else {
              external++;
            }

            let finalStatus: number | 'error' = 'error';
            if (typeof status === 'number') {
              finalStatus = status;
            }

            const redirectChain = [
              ...redirects
                .map((r) => (r.url ? r.url.toString() : null))
                .filter((url): url is string => Boolean(url)),
              resolvedUrl,
            ];

            const linkData: LinkResult = {
              url: resolvedUrl,
              status: finalStatus,
              redirects: redirectsCount,
              redirectChain,
            };

            if (result.broken) {
              if (status === undefined) {
                errorLinks.push(linkData);
              } else if (status >= 400) {
                brokenLinks.push(linkData);
              } else {
                validCount++;
              }
            } else if (redirectsCount > 1) {
              redirectChains.push(linkData);
            } else if (redirectsCount === 1) {
              singleRedirects.push(linkData);
            } else {
              validCount++;
            }
          },

          complete: () => {
            const total =
              brokenLinks.length +
              errorLinks.length +
              redirectChains.length +
              singleRedirects.length +
              validCount;

            resolve({
              brokenLinks,
              navigation: {
                internal,
                external,
              },
              navLinks: {
                totalCount: 0,
                topLevelCount: 0,
                hasAboutLink: false,
              },
              summary: {
                total,
                valid: validCount,
                broken: brokenLinks.length,
                error: errorLinks.length,
                avgClickDepth: depth,
                orphanPages: 0,
                redirects: singleRedirects.length,
                redirectChain: redirectChains.length,
              },
            });
          },

          error: (err: Error) => {
            reject(err);
          },
        },
      );

      checker.scan(html, url);
    });
  } catch {
    return {
      brokenLinks: [],
      navigation: {
        internal: 0,
        external: 0,
      },
      navLinks: {
        totalCount: 0,
        topLevelCount: 0,
        hasAboutLink: false,
      },
      summary: {
        total: 0,
        valid: 0,
        broken: 0,
        error: 0,
        avgClickDepth: 1,
        orphanPages: 0,
        redirects: 0,
        redirectChain: 0,
      },
    };
  } finally {
    await browser?.close();
  }
}
