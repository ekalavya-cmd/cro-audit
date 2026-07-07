import puppeteer, { Browser } from 'puppeteer';
import * as cheerio from 'cheerio';
import type { ExtractStructureResult } from '../types/extractStructure.types';

export async function extractStructure(url: string): Promise<ExtractStructureResult> {
  let browser: Browser | undefined;

  try {
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    });
    const page = await browser.newPage();

    await page.goto(url, { waitUntil: 'networkidle2' });
    const html = await page.content();

    const $ = cheerio.load(html);

    function findByKeywordsSections(selector: string, keywords: string[]): boolean {
      return (
        $(selector).filter((_, element) => {
          const text = $(element).text().toLowerCase();
          const id = $(element).attr('id')?.toLowerCase() || '';
          const className = $(element).attr('class')?.toLowerCase() || '';
          return keywords.some(
            (key) => text.includes(key) || id.includes(key) || className.includes(key),
          );
        }).length > 0
      );
    }

    function findByKeywordsImages(selector: string, keywords: string[]): boolean {
      return (
        $(selector).filter((_, element) => {
          const src = $(element).attr('src')?.toLowerCase() || '';
          const alt = $(element).attr('alt')?.toLowerCase() || '';
          const className = $(element).attr('class')?.toLowerCase() || '';
          return keywords.some(
            (key) => src.includes(key) || alt.includes(key) || className.includes(key),
          );
        }).length > 0
      );
    }

    const bodyText = $('body').text().toLowerCase();

    function findByBodyText(keywords: string[]) {
      return keywords.some((key) => {
        const regex = new RegExp(`\\b${key}\\b`, 'i');
        return regex.test(bodyText);
      });
    }

    //  Heading
    const h1 = $('h1').length > 0;

    //  Meta information
    const title = $('title').text().trim();
    const metaDescription = $("meta[name='description']").attr('content')?.trim() || '';

    // Navlinks
    const navLinks =
      $('nav > ul > li > a').length ||
      $('nav a').filter((_, element) => {
        return $(element).text().trim().length > 0;
      }).length;

    const topLevelNavLinks = navLinks;

    const aboutKeywords = ['about', 'about us', 'who we are', 'our story', 'company'];
    const hasAboutLink =
      $('body')
        .find('a')
        .filter((_, el) => {
          const text = $(el).text().toLowerCase().trim();
          const href = ($(el).attr('href') || '').toLowerCase();
          return aboutKeywords.some((kw) => text.includes(kw) || href.includes(kw));
        }).length > 0;

    //  Images
    const totalImages = $('img').length;
    const imagesWithAlt = $('img[alt]').filter((_, element) => {
      const alt = $(element).attr('alt');
      return typeof alt === 'string' && alt.trim() !== '';
    }).length;
    const altCoverage =
      totalImages > 0 ? Number(((imagesWithAlt / totalImages) * 100).toFixed(2)) : 0;

    //  CTA detection
    const ctakeywords = [
      'get started',
      'contact',
      'book',
      'try',
      'sign up',
      'start',
      'request',
      'demo',
    ];

    const ctaElements = $("a, button, input[type='submit'], input[type='button']").filter(
      (_, element) => {
        const text = $(element).text().toLowerCase();
        const rawValue = $(element).val();
        const value =
          typeof rawValue === 'string'
            ? rawValue.toLowerCase()
            : Array.isArray(rawValue)
              ? rawValue.join(' ').toLowerCase()
              : '';
        return ctakeywords.some((key) => text.includes(key) || value.includes(key));
      },
    ).length;

    //  Forms
    const forms = $('form');
    let totalFields = 0;
    let requiredFields = 0;

    forms.each((_, form) => {
      const fields = $(form).find("input:not([type='hidden']), textarea, select");
      totalFields += fields.length;
      requiredFields += fields.filter((_, element) => {
        // 1. Direct attributes
        const hasRequiredAttr = $(element).is('[required]');
        const hasAriaRequired = $(element).attr('aria-required') === 'true';

        // 2. Label linked via "for"
        const id = $(element).attr('id');
        let labelText = '';

        if (id) {
          labelText = $(`label[for='${id}']`).text().toLowerCase();
        }

        // 3. Closest container (not just parent)
        const containerText = $(element)
          .closest('div, section, form')
          .first()
          .text()
          .toLowerCase()
          .slice(0, 200);

        return (
          hasRequiredAttr ||
          hasAriaRequired ||
          labelText.includes('*') ||
          containerText.includes('*')
        );
      }).length;
    });
    const requiredRatio = totalFields > 0 ? Number((requiredFields / totalFields).toFixed(2)) : 0;

    // Testimonials / Reviews
    const testimonialKeywords = ['testimonial', 'review', 'what our clients say', 'case study'];
    const testimonialSection = findByKeywordsSections('section, div', testimonialKeywords);
    const testimonialText = findByBodyText(testimonialKeywords);
    const hasTestimonials = testimonialSection || testimonialText;

    // Client logos
    const logoImagesKeywords = ['client', 'logo', 'brand', 'partner'];
    const logoImages = findByKeywordsImages('img', logoImagesKeywords);

    // Security / Trust badges
    const trustBadgesKeywords = ['ssl', 'secure', 'trust', 'badge', 'verified'];
    const trustBadges = findByKeywordsImages('img, svg', trustBadgesKeywords);

    const isHttps = new URL(page.url()).protocol === 'https:';
    const hasPhone = /\+?\d[\d\s\-()]{8,}/.test(bodyText);
    const hasEmail = $("a[href^='mailto:']").length > 0;
    const hasAddress = $('address').length > 0 || /street|road|avenue|city|zip/i.test(bodyText);

    // Offers / Urgency
    const urgencyKeywords = ['limited', 'offer', 'hurry', 'discount', 'ends soon'];
    const urgencySignals = findByKeywordsSections('section, div', urgencyKeywords);
    const urgencyText = findByBodyText(urgencyKeywords);
    const hasUrgency = urgencySignals || urgencyText;

    // Free trial / Guarantee
    const incentivesKeywords = ['free trial', 'money back', 'guarantee', 'no risk'];
    const incentives = findByKeywordsSections('div, section', incentivesKeywords);
    const incentivesText = findByBodyText(incentivesKeywords);
    const hasIncentives = incentives || incentivesText;

    return {
      structure: {
        h1,
        meta: {
          title,
          description: metaDescription,
        },
      },

      navLinks: {
        totalCount: navLinks,
        topLevelCount: topLevelNavLinks,
        hasAboutLink,
      },

      images: {
        total: totalImages,
        altCoverage,
      },

      cta: {
        count: ctaElements,
      },

      forms: {
        formCount: forms.length,
        totalFields,
        requiredFields,
        requiredRatio,
      },

      trustSignals: {
        isHttps,
        testimonials: hasTestimonials,
        clientLogos: logoImages,
        trustBadges: trustBadges,
        contactInfo: {
          phone: hasPhone,
          email: hasEmail,
          address: hasAddress,
        },
      },

      conversionSignals: {
        urgency: hasUrgency,
        incentives: hasIncentives,
      },

      errorHandling: {
        hasErrorHandling: false,
      },
    };
  } catch {
    // Return fallback object
    return {
      structure: {
        h1: false,
        meta: { title: '', description: '' },
      },
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
      conversionSignals: {
        urgency: false,
        incentives: false,
      },
      errorHandling: {
        hasErrorHandling: false,
      },
    };
  } finally {
    await browser?.close();
  }
}
