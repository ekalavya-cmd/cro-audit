import * as cheerio from 'cheerio';
import { AnyNode, Element } from 'domhandler';
import { Page } from 'puppeteer';
import type { ExtractStructureResult } from '../modules/audit/types/extractStructure.types';

export async function extractStructure(html: string, page: Page): Promise<ExtractStructureResult> {
  try {
    const $ = cheerio.load(html);
    const bodyText = $('body').text().toLowerCase();

    // ─── Utilities ────────────────────────────────────────────────────────────

    /** Match id/class against keywords */
    const attrContains = (el: AnyNode, keywords: string[]): boolean => {
      const id = $(el).attr('id')?.toLowerCase() || '';
      const cls = $(el).attr('class')?.toLowerCase() || '';
      return keywords.some((k) => id.includes(k) || cls.includes(k));
    };

    /** Case-insensitive whole-word body text check */
    const bodyHas = (keywords: string[]): boolean =>
      keywords.some((k) =>
        new RegExp(`\\b${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(bodyText),
      );

    /** Check class/id of a set of elements */
    const sectionHasClass = (selector: string, keywords: string[]): boolean =>
      $(selector).filter((_, el) => attrContains(el, keywords)).length > 0;

    /** Parse all JSON-LD blocks, return merged array of objects */
    const jsonLdObjects = (): Record<string, unknown>[] => {
      const results: Record<string, unknown>[] = [];
      $('script[type="application/ld+json"]').each((_, el) => {
        try {
          const parsed = JSON.parse($(el).html() || '{}');
          if (Array.isArray(parsed)) results.push(...parsed);
          else results.push(parsed);
        } catch {
          /* ignore malformed */
        }
      });
      return results;
    };

    const ldObjects = jsonLdObjects();
    const ldHasType = (...types: string[]): boolean =>
      ldObjects.some((o) =>
        types.some((t) =>
          String(o['@type'] || '')
            .toLowerCase()
            .includes(t.toLowerCase()),
        ),
      );

    // ─── 1. STRUCTURE ─────────────────────────────────────────────────────────

    // h1: standard + role="heading" aria-level="1" (custom CMS / legacy)
    const h1 = $('h1').length > 0 || $('[role="heading"][aria-level="1"]').length > 0;

    const title =
      $('title').text().trim() || $('meta[property="og:title"]').attr('content')?.trim() || '';

    const metaDescription =
      $('meta[name="description"]').attr('content')?.trim() ||
      $('meta[property="og:description"]').attr('content')?.trim() ||
      $('meta[name="twitter:description"]').attr('content')?.trim() ||
      '';

    // ─── 2. NAVIGATION ────────────────────────────────────────────────────────

    // Helper: normalise href for deduplication
    const normaliseHref = (href: string, text: string): string => {
      if (!href || href === '#') return text.toLowerCase().trim();
      return href.replace(/\/$/, '').replace(/#.*$/, '').toLowerCase();
    };

    // Build a prioritised list of nav candidate containers
    type NavCandidate = { el: cheerio.Cheerio<AnyNode>; score: number };
    const candidates: NavCandidate[] = [];

    const addCandidate = (el: cheerio.Cheerio<AnyNode>, score: number) => {
      if (el.length) candidates.push({ el, score });
    };

    // Tier 1: Explicit main navigation by aria-label
    $('nav, [role="navigation"]').each((_, el) => {
      const label = ($(el).attr('aria-label') || $(el).attr('aria-labelledby') || '').toLowerCase();
      const id = $(el).attr('id')?.toLowerCase() || '';
      const cls = $(el).attr('class')?.toLowerCase() || '';
      let score = 50;
      if (/\b(main|primary|site|global|top)\b/.test(label)) score += 60;
      if (/\b(main|primary|site|global|top|navbar|header)\b/.test(id + ' ' + cls)) score += 30;
      if ($(el).closest('header, [role="banner"]').length) score += 40;
      addCandidate($(el), score);
    });

    // Tier 2: Header-level link containers (React/Tailwind no-list pattern)
    $('header').each((_, el) => {
      const directAnchors = $(el).find('a').not('footer a').length;
      if (directAnchors >= 2) addCandidate($(el), 30);
    });

    // Tier 3: Scored ul/ol approach (legacy / WordPress)
    $('ul, ol')
      .filter((_, el) => {
        if ($(el).closest('footer, [role="contentinfo"], .footer, #footer').length) return false;
        if ($(el).closest('main, [role="main"], aside, article').length) return false;
        return $(el).children('li').children('a').length >= 2;
      })
      .each((_, el) => {
        const inHeader =
          $(el).closest('header, nav, [role="navigation"], [role="banner"]').length > 0;
        const directLinks = $(el).children('li').children('a').length;
        addCandidate($(el), (inHeader ? 80 : 10) + directLinks);
      });

    // Tier 4: Legacy — table in header region
    $('header table, .header table, #header table').each((_, el) => {
      const anchors = $(el).find('a').length;
      if (anchors >= 2) addCandidate($(el), 15);
    });

    // Pick the highest scoring candidate
    candidates.sort((a, b) => b.score - a.score);
    const primaryNav = candidates[0]?.el ?? $();

    // Collect all anchors from primaryNav, supporting both list and direct patterns
    const navAnchors = primaryNav.find('a').filter((_, el) => {
      const text = $(el).text().trim();
      const href = $(el).attr('href') || '';
      // Skip empty, pure hash, mailto, tel links
      return text.length > 0 && !/^(mailto:|tel:|javascript:)/i.test(href);
    });

    const uniqueNavHrefs = new Set(
      navAnchors.toArray().map((el) => normaliseHref($(el).attr('href') || '', $(el).text())),
    );
    const navLinks = uniqueNavHrefs.size;

    // Top-level: direct children anchors (li > a) or direct nav > a
    const topLevelAnchors = primaryNav.find('> a, > ul > li > a, > ol > li > a, li:not(li li) > a');
    const uniqueTopLevel = new Set(
      topLevelAnchors
        .filter((_, el) => $(el).text().trim().length > 0)
        .toArray()
        .map((el) => normaliseHref($(el).attr('href') || '', $(el).text())),
    );
    const topLevelNavLinks = uniqueTopLevel.size;

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

    // ─── 3. IMAGES ────────────────────────────────────────────────────────────

    // Exclude tracking pixels (1×1 or 0-dimension images)
    const allImgs = $('img').filter((_, el) => {
      const w = parseInt($(el).attr('width') || '99', 10);
      const h = parseInt($(el).attr('height') || '99', 10);
      return !(w <= 1 || h <= 1);
    });

    const totalImages = allImgs.length + $('picture').length;

    const imagesWithAlt =
      allImgs.filter((_, el) => {
        const alt = $(el).attr('alt');
        // Deliberately empty alt = decorative = OK (counts as covered)
        return typeof alt === 'string';
      }).length + $('picture img').filter((_, el) => typeof $(el).attr('alt') === 'string').length;

    // Inline SVG with role="img" must have <title>
    const svgImgs = $('svg[role="img"]').length;
    const svgWithTitle = $('svg[role="img"]').filter(
      (_, el) => $(el).find('title').length > 0,
    ).length;

    const effectiveTotal = totalImages + svgImgs;
    const effectiveCovered = imagesWithAlt + svgWithTitle;

    const altCoverage =
      effectiveTotal > 0 ? Number(((effectiveCovered / effectiveTotal) * 100).toFixed(2)) : 0;

    // ─── 4. CTAs ──────────────────────────────────────────────────────────────

    const ctaExact = [
      'get started',
      'sign up',
      'contact us',
      'book a demo',
      'request a demo',
      'free trial',
      'start free',
      'start now',
      'try for free',
      'buy now',
      'shop now',
      'add to cart',
      'subscribe',
      'download',
      'claim now',
      'apply now',
      'schedule a call',
      'book a call',
      'learn more',
      'get a quote',
      'request a quote',
      'see pricing',
      'view demo',
      'watch demo',
      'get demo',
    ];
    const ctaWord = ['contact', 'book', 'request', 'demo', 'schedule', 'explore', 'claim', 'apply'];
    const ctaShort = ['try', 'start', 'buy', 'subscribe'];
    const ctaClasses = [
      'cta',
      'btn-primary',
      'btn-cta',
      'hero-cta',
      'action-btn',
      'primary-btn',
      'call-to-action',
    ];

    const isCta = (el: AnyNode): boolean => {
      const tag = (el as Element).tagName?.toLowerCase() || '';
      const text = $(el).text().toLowerCase().trim();
      const ariaLabel = ($(el).attr('aria-label') || '').toLowerCase();
      const val = (() => {
        const v = $(el).val();
        return typeof v === 'string' ? v.toLowerCase() : '';
      })();
      const haystack = text || val || ariaLabel;
      const cls = $(el).attr('class')?.toLowerCase() || '';
      const dataCta =
        $(el).attr('data-cta') || $(el).attr('data-action') || $(el).attr('data-track');

      if (!haystack && !dataCta && !ctaClasses.some((c) => cls.includes(c))) return false;

      // class pattern match (even if no text, e.g. icon-only buttons)
      if (ctaClasses.some((c) => cls.includes(c))) return true;
      if (dataCta) return true;
      if (haystack && ctaExact.some((kw) => haystack.includes(kw))) return true;
      if (haystack && ctaWord.some((kw) => new RegExp(`\\b${kw}\\b`).test(haystack))) return true;
      if (haystack && ctaShort.some((kw) => haystack === kw)) return true;

      // aria-label on icon buttons
      if (ariaLabel && ctaExact.some((kw) => ariaLabel.includes(kw))) return true;

      // input[type=image] is always a CTA
      if (tag === 'input' && $(el).attr('type') === 'image') return true;

      return false;
    };

    const ctaElements = $(
      "a, button, input[type='submit'], input[type='button'], input[type='image'], [role='button']",
    ).filter((_, el) => isCta(el)).length;

    // ─── 5. FORMS ─────────────────────────────────────────────────────────────

    // Filter out search-only forms and cookie/consent popups
    const contactForms = $('form').filter((_, form) => {
      const action = ($(form).attr('action') || '').toLowerCase();
      const cls = $(form).attr('class')?.toLowerCase() || '';
      const id = $(form).attr('id')?.toLowerCase() || '';

      // Exclude search forms
      if (/search/.test(action) || /search/.test(cls + id)) return false;
      if ($(form).find('input[type="search"]').length > 0) return false;
      // Exclude cookie/consent overlays
      if (/cookie|consent|gdpr/.test(cls + id)) return false;

      // Must have at least 1 non-hidden, non-honeypot visible input
      const visibleInputs = $(form)
        .find("input:not([type='hidden']), textarea, select")
        .filter((_, el) => {
          const style = $(el).attr('style') || '';
          const tabindex = $(el).attr('tabindex') || '';
          // Skip likely honeypot fields
          if (/display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0/i.test(style))
            return false;
          if (tabindex === '-1') return false;
          return true;
        });

      return visibleInputs.length >= 1;
    });

    let totalFields = 0;
    let requiredFields = 0;

    contactForms.each((_, form) => {
      const visibleFields = $(form)
        .find("input:not([type='hidden']), textarea, select")
        .filter((_, el) => {
          const style = $(el).attr('style') || '';
          const tabindex = $(el).attr('tabindex') || '';
          if (/display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0/i.test(style))
            return false;
          if (tabindex === '-1') return false;
          if ($(el).attr('type') === 'search') return false;
          return true;
        });

      totalFields += visibleFields.length;

      requiredFields += visibleFields.filter((_, el) => {
        if ($(el).is('[required]') || $(el).attr('aria-required') === 'true') return true;
        const id = $(el).attr('id');
        if (id) {
          const labelText = $(`label[for="${id}"]`).text();
          if (/\*/.test(labelText)) return true;
        }
        return false;
      }).length;
    });

    const requiredRatio = totalFields > 0 ? Number((requiredFields / totalFields).toFixed(2)) : 0;

    // ─── 6. TRUST SIGNALS ─────────────────────────────────────────────────────

    // Testimonials: class/id, blockquote, schema.org, stars, body text
    const testimonialClassKeywords = [
      'testimonial',
      'review',
      'reviews',
      'feedback',
      'quote',
      'client-say',
      'what-our',
      'case-study',
      'case_study',
      'success-story',
      'customer-story',
      'rating',
      'stars',
      'star-rating',
    ];
    const hasTestimonialClasses = sectionHasClass(
      'section, div, article, aside',
      testimonialClassKeywords,
    );
    const hasBlockquoteTestimonial = $('blockquote').length > 0;
    const hasStarRating =
      $('[class*="star"], [class*="rating"], [class*="stars"]').length > 0 ||
      /[★☆✩✭]/.test($('body').text());
    const hasSchemaReview = ldHasType('Review', 'AggregateRating');
    const hasMicrodataReview =
      $('[itemtype*="schema.org/Review"], [itemtype*="schema.org/AggregateRating"]').length > 0;
    const testimonialBodyKeywords = [
      'testimonial',
      'review',
      'what our clients say',
      'case study',
      'happy customer',
    ];
    const hasTestimonials =
      hasTestimonialClasses ||
      hasBlockquoteTestimonial ||
      hasStarRating ||
      hasSchemaReview ||
      hasMicrodataReview ||
      bodyHas(testimonialBodyKeywords);

    // Client logos
    const logoClassKeywords = [
      'client',
      'logo',
      'brand',
      'partner',
      'sponsor',
      'trusted-by',
      'as-seen',
      'featured',
    ];
    const hasLogoImgs =
      $('img').filter((_, el) => {
        const src = $(el).attr('src')?.toLowerCase() || '';
        const alt = $(el).attr('alt')?.toLowerCase() || '';
        const cls = $(el).attr('class')?.toLowerCase() || '';
        return logoClassKeywords.some((k) => src.includes(k) || alt.includes(k) || cls.includes(k));
      }).length > 0;
    const hasLogoSection = sectionHasClass('section, div', logoClassKeywords);
    const clientLogos = hasLogoImgs || hasLogoSection;

    // Trust badges
    const badgeImgKeywords = [
      'ssl',
      'trust-badge',
      'trustbadge',
      'badge',
      'verified',
      'security',
      'secure',
      'certified',
      'mcafee',
      'norton',
      'bbb',
      'iso',
    ];
    const hasBadgeImgs =
      $('img, svg').filter((_, el) => {
        const src = $(el).attr('src')?.toLowerCase() || '';
        const alt = $(el).attr('alt')?.toLowerCase() || '';
        const cls = $(el).attr('class')?.toLowerCase() || '';
        return badgeImgKeywords.some((k) => src.includes(k) || alt.includes(k) || cls.includes(k));
      }).length > 0;
    const badgeTextKeywords = [
      '30-day guarantee',
      'money-back',
      'secure checkout',
      'ssl secured',
      'verified by',
      'certified',
      'iso 27001',
      'bbb accredited',
    ];
    const trustBadges = hasBadgeImgs || bodyHas(badgeTextKeywords);

    // HTTPS
    const isHttps = new URL(page.url()).protocol === 'https:';

    // Email
    const hasEmail =
      $("a[href^='mailto:']").length > 0 ||
      /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(
        $('footer, address, [class*="contact"]').text(),
      );

    // Phone: tel: links + regex on contact areas
    const hasTelLink = $("a[href^='tel:']").length > 0;
    const phoneAreaText = $(
      'address, [class*="contact"], [class*="phone"], [id*="contact"], [id*="phone"], footer',
    ).text();
    const hasPhoneText = /(\+?[\d][\d\s\-().]{6,}\d)/.test(phoneAreaText);
    const hasPhone = hasTelLink || hasPhoneText;

    // Address: <address> tag, microdata, regex
    const hasAddressTag = $('address').length > 0;
    const hasAddressMicrodata = $('[itemtype*="PostalAddress"]').length > 0;
    const addressRx = [
      /\d+\s+\w+\s+(street|st|road|rd|avenue|ave|boulevard|blvd|lane|ln|drive|dr)/i,
      /(city|town|state|province|zip|postal code)/i,
    ];
    const addressRxMatches = addressRx.filter((rx) => rx.test(bodyText)).length;
    const hasAddress = hasAddressTag || hasAddressMicrodata || addressRxMatches >= 2;

    // ─── 7. CONVERSION SIGNALS ────────────────────────────────────────────────

    // Urgency: countdown timers, stock/scarcity, text patterns
    const countdownEl =
      $('[class*="countdown"], [class*="timer"], [id*="countdown"], [id*="timer"]').length > 0;
    const saleBadgeEl =
      $('[class*="sale"], [class*="discount"], [class*="promo"], [class*="offer"]').length > 0;
    const urgencyKeywords = [
      'limited time',
      'limited offer',
      'hurry',
      'discount',
      'ends soon',
      'today only',
      'flash sale',
      'act now',
      'expires',
      'last chance',
      'selling fast',
      'only .+ left',
      'almost gone',
      'low stock',
    ];
    const hasUrgency =
      countdownEl || saleBadgeEl || urgencyKeywords.some((k) => new RegExp(k, 'i').test(bodyText));

    // Incentives: guarantees, free trials, free shipping, etc.
    const incentivesKeywords = [
      'free trial',
      'money back',
      'guarantee',
      'no risk',
      'no credit card',
      'cashback',
      'free shipping',
      'no setup fee',
      'cancel anytime',
      '30-day',
      '14-day free',
      'risk-free',
      'try free',
      'refund policy',
    ];
    const hasIncentives =
      sectionHasClass('div, section', incentivesKeywords) || bodyHas(incentivesKeywords);

    // ─── 8. ERROR HANDLING ────────────────────────────────────────────────────

    // ARIA live regions and alert roles
    const hasAriaAlert =
      $('[role="alert"], [role="status"], [aria-live="assertive"], [aria-live="polite"]').length >
      0;

    // Form field-level ARIA error patterns
    const hasFormFieldErrors =
      $('input[aria-invalid], select[aria-invalid], textarea[aria-invalid]').length > 0 ||
      $('[aria-describedby]').filter((_, el) => {
        const ids = ($(el).attr('aria-describedby') || '').split(' ');
        return ids.some((id) => {
          // Escape CSS ID: in node, we replace colons/dots/etc manually
          const escapedId = id.replace(/[!"#$%&'()*+,./:;<=>?@[\\\]^`{|}~]/g, '\\$&');
          const ref = $(`#${escapedId}`);
          return (
            ref.length > 0 && /error|invalid|required|warning/i.test(ref.text() + ref.attr('class'))
          );
        });
      }).length > 0;

    // Error class/id patterns
    const errorClassRx =
      /\b(error|errors|is-error|has-error|field-error|input-error|form-error|alert-error|alert-danger|invalid|is-invalid|validation-error|warning)\b/i;
    const hasErrorClasses =
      $('div, span, p, input, form, section, ul, li').filter((_, el) => {
        const cls = $(el).attr('class') || '';
        const id = $(el).attr('id') || '';
        return errorClassRx.test(cls) || errorClassRx.test(id);
      }).length > 0;

    // Inline error text in leaf nodes
    const errorTextRx =
      /\b(this field is required|please enter|invalid|must be|cannot be empty|is not valid|error|something went wrong|try again)\b/i;
    const hasInlineErrorText =
      $('span, p, small').filter((_, el) => {
        if ($(el).children().length > 0) return false;
        return errorTextRx.test($(el).text().trim());
      }).length > 0;

    // 404 / error page detection
    const pageTitle404 = $('title').text().toLowerCase();
    const h1Text404 = $('h1').first().text().toLowerCase();
    const isErrorPage =
      /\b(404|not found|page not found|something went wrong|error occurred|server error|403|forbidden|500)\b/.test(
        pageTitle404 + ' ' + h1Text404,
      );

    // Empty/no-results states
    const hasEmptyState =
      $('[class*="empty-state"], [class*="no-results"], [class*="zero-state"], [id*="empty-state"]')
        .length > 0 ||
      $('p, span').filter((_, el) => {
        if ($(el).children().length > 0) return false;
        return /\b(no results|nothing found|no items|no data|no records found|empty)\b/.test(
          $(el).text().toLowerCase(),
        );
      }).length > 0;

    // form[novalidate] signals custom JS validation
    const hasNovalidateForm = $('form[novalidate]').length > 0;

    // <dialog> elements for modal confirmations/errors
    const hasDialog = $('dialog').length > 0;

    // Toast / notification library class patterns
    const hasToast =
      $(
        '[class*="toast"], [class*="snackbar"], [class*="notification"], [class*="noty"], [class*="sweet-alert"], [class*="swal"]',
      ).length > 0;

    // Native HTML5 required fields (basic validation)
    const hasNativeRequired = $('input[required], select[required], textarea[required]').length > 0;

    const hasErrorHandling =
      hasAriaAlert ||
      hasFormFieldErrors ||
      hasErrorClasses ||
      hasInlineErrorText ||
      isErrorPage ||
      hasEmptyState ||
      hasNovalidateForm ||
      hasDialog ||
      hasToast ||
      hasNativeRequired;

    // ─── Return ───────────────────────────────────────────────────────────────

    return {
      structure: { h1, meta: { title, description: metaDescription } },
      navLinks: { totalCount: navLinks, topLevelCount: topLevelNavLinks, hasAboutLink },
      images: { total: effectiveTotal, altCoverage },
      cta: { count: ctaElements },
      forms: { formCount: contactForms.length, totalFields, requiredFields, requiredRatio },
      trustSignals: {
        isHttps,
        testimonials: hasTestimonials,
        clientLogos,
        trustBadges,
        contactInfo: { phone: hasPhone, email: hasEmail, address: hasAddress },
      },
      conversionSignals: { urgency: hasUrgency, incentives: hasIncentives },
      errorHandling: { hasErrorHandling },
    };
  } catch (err) {
    console.error('Extraction failed:', err);
    return {
      structure: { h1: false, meta: { title: '', description: '' } },
      navLinks: { totalCount: 0, topLevelCount: 0, hasAboutLink: false },
      images: { total: 0, altCoverage: 0 },
      cta: { count: 0 },
      forms: { formCount: 0, totalFields: 0, requiredFields: 0, requiredRatio: 0 },
      trustSignals: {
        isHttps: false,
        testimonials: false,
        clientLogos: false,
        trustBadges: false,
        contactInfo: { phone: false, email: false, address: false },
      },
      conversionSignals: { urgency: false, incentives: false },
      errorHandling: { hasErrorHandling: false },
    };
  }
}
