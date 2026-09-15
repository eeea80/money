import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const ICON_ID = 'kLkU4c9YfQNM';
const targets = [
  { size: 16,  url: `https://img.icons8.com/?id=${ICON_ID}&format=png&size=16`,  out: 'icons/icon16.png' },
  { size: 32,  url: `https://img.icons8.com/?id=${ICON_ID}&format=png&size=32`,  out: 'icons/icon32.png' },
  { size: 48,  url: `https://img.icons8.com/?id=${ICON_ID}&format=png&size=48`,  out: 'icons/icon48.png' },
  { size: 128, url: `https://img.icons8.com/?id=${ICON_ID}&format=png&size=128`, out: 'icons/icon128.png' },
];

async function downloadToFile(url, outPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed ${res.status} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, buf);
  process.stdout.write(`Saved ${outPath} (${buf.length} bytes)\n`);
}

async function main() {
  for (const t of targets) {
    const outAbs = resolve(process.cwd(), t.out);
    await downloadToFile(t.url, outAbs);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});


