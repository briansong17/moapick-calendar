import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { extract, validateInput } from '../lib/extraction.mjs';
// Explicit opt-in command: one paid request, using the locally generated test poster.
const path = new URL('../data/test-poster.png', import.meta.url);
try {
  const image = await readFile(path);
  const input = validateInput({ images: [`data:image/png;base64,${image.toString('base64')}`] });
  const output = await extract(input, { apiKey: process.env.OPENAI_API_KEY, model: process.env.OPENAI_MODEL || 'gpt-5.4-mini' });
  await mkdir(new URL('../data/', import.meta.url), { recursive: true });
  await writeFile(new URL('../data/live-check.json', import.meta.url), JSON.stringify(output, null, 2));
  const e = output.result.events.find(e => e.start_date === '2026-12-12');
  const passed = !!e && e.start_time === '18:00';
  console.log(JSON.stringify({ passed, event_count: output.result.events.length, usage: output.usage }));
  if (!passed) process.exitCode = 1;
} catch (error) { console.log(JSON.stringify({ passed: false, error: error.status ? error.message : '검증 실행 실패: 테스트 이미지 및 네트워크를 확인하세요.' })); process.exitCode = 1; }
