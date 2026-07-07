const puppeteer = require('puppeteer');
const cheerio = require('cheerio');

(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await page.goto('https://medgrowthengine.ai/', {waitUntil: 'domcontentloaded'});
  const html = await page.content();
  const $ = cheerio.load(html);
  
  let maxFields = 0;
  $('form').each((i, f) => {
    const count = $(f).find('input:not([type="hidden"]), textarea, select').length;
    console.log('Form ' + i + ' fields: ' + count);
    if(count > maxFields) maxFields = count;
  });
  console.log('Max fields: ' + maxFields);
  await browser.close();
})();
