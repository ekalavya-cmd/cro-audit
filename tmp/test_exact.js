const puppeteer = require('puppeteer');
const cheerio = require('cheerio');

(async () => {
  const browser = await puppeteer.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
  });
  const page = await browser.newPage();
  
  // Apply the same network interception as the app
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const type = req.resourceType();
    if (['image', 'stylesheet', 'font', 'media'].includes(type)) {
      req.abort();
    } else {
      req.continue();
    }
  });

  await page.goto('https://medgrowthengine.ai/', {waitUntil: 'domcontentloaded'});
  // App waits 2 seconds
  await new Promise((resolve) => setTimeout(resolve, 2000));
  const html = await page.content();
  const $ = cheerio.load(html);
  
  function isHidden(element) {
    let el = $(element);
    while (el.length) {
      const style = el.attr('style') || '';
      const ariaHidden = el.attr('aria-hidden');
      const hidden = el.attr('hidden');
      if (
        /display\s*:\s*none/i.test(style) ||
        /visibility\s*:\s*hidden/i.test(style) ||
        ariaHidden === 'true' ||
        hidden !== undefined
      ) {
        return true;
      }
      const parent = el.parent();
      if (!parent.length || parent.is('body') || parent.is('html')) break;
      el = parent;
    }
    return false;
  }

  let totalFields = 0;
  $('form').each((i, form) => {
    if (isHidden(form)) return;
    
    const fields = $(form).find("input:not([type='hidden']), textarea, select").filter((_, el) => {
      return !isHidden(el);
    });
    const fieldCount = fields.length;
    console.log('Form ' + i + ' field count: ' + fieldCount);
    
    if (fieldCount > totalFields) {
      totalFields = fieldCount;
    }
  });
  console.log('Final max totalFields: ' + totalFields);
  await browser.close();
})();
