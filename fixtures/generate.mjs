// Generates self-made, license-free test media. Uses argument arrays only (no shell strings).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), 'generated');
fs.mkdirSync(out, { recursive: true });
const force = process.argv.includes('--force');
const need = (name) => force || !fs.existsSync(path.join(out, name));

async function makePdf(file, label) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.setTitle(`Learn fixture: ${label}`);
  for (let i = 1; i <= 3; i++) {
    const page = doc.addPage([595, 842]);
    page.drawText(`${label} - page ${i}`, { x: 56, y: 770, size: 22, font });
    page.drawText('A signaling cascade can amplify an initial molecular event.', { x: 56, y: 730, size: 12, font });
    page.drawRectangle({ x: 56, y: 560, width: 220, height: 120, borderColor: rgb(0.18, 0.5, 0.48), borderWidth: 3 });
    if (i === 2) page.setRotation(degrees(90));
  }
  fs.writeFileSync(file, await doc.save());
}

const ffmpeg = (args) => execFileSync('ffmpeg', ['-v', 'error', '-y', ...args], { stdio: 'inherit' });
const encoders = execFileSync('ffmpeg', ['-hide_banner', '-encoders'], { encoding: 'utf8' });
const has = (name) => new RegExp(`\\s${name}\\s`).test(encoders);

if (need('sample.pdf')) await makePdf(path.join(out, 'sample.pdf'), 'Sample PDF');
if (need('한글 경로 (테스트) #1.pdf')) await makePdf(path.join(out, '한글 경로 (테스트) #1.pdf'), 'Korean path PDF');

if (need('sample-h264-aac.mp4')) {
  ffmpeg([
    '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '10',
    '-c:v', 'libx264', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-g', '60', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart',
    path.join(out, 'sample-h264-aac.mp4'),
  ]);
}
if (need('sample-mpeg4part2.mp4')) {
  ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30', '-t', '3', '-c:v', 'mpeg4', path.join(out, 'sample-mpeg4part2.mp4')]);
}
if (!need('sample-hevc.mp4')) {
  // already present
} else if (has('libx265')) {
  ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30', '-t', '3', '-c:v', 'libx265', '-tag:v', 'hvc1', path.join(out, 'sample-hevc.mp4')]);
} else {
  console.warn('libx265 encoder not available — skipping sample-hevc.mp4');
}
console.log(`fixtures written to ${out}`);
