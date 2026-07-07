import { DomEngine } from './modules/audit/engines/dom.engine';

async function main() {
  const engine = new DomEngine();

  const startTime = Date.now();

  // Choose one depending on which mode you want to test:
  // const result = await engine.analyzeSEO('https://github.com/');
  const result = await engine.analyzeUXUI('https://github.com/');

  const endTime = Date.now();
  const durationMs = endTime - startTime;
  const durationSec = (durationMs / 1000).toFixed(2);

  console.log(JSON.stringify(result, null, 2));
  console.log(`Total time: ${durationSec}s`);
}

main().catch(console.error);
