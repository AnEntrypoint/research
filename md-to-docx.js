#!/usr/bin/env node
// Validate each rewrite output and convert to .docx, styled to match Toronto_Notes_Rewritten.docx.
// Style targets (from reference):
//   Title:    bold, color #1F4E78, size 28 half-pt = 14pt, centered
//   Subtitle: bold, size 24 (12pt), centered
//   Tagline:  size 22 (11pt), centered
//   Heading 1: color #2E74B5, size 32 (16pt)
//   Heading 2: color #2E74B5, size 26 (13pt)
//   Heading 3: color #1F4D78, size 24 (12pt)
//   Body:     default

const fs = require('fs');
const path = require('path');
const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, LevelFormat } = require('docx');

const OUT_DIR = path.join(__dirname, 'rewrite-out');
const DOCX_DIR = path.join(__dirname, 'rewrite-docx');
if (!fs.existsSync(DOCX_DIR)) fs.mkdirSync(DOCX_DIR, { recursive: true });

const STUB_PATTERNS = [
  /^This block is not supported/i,
  /^\(no text response/i,
];

function validate(text) {
  const trimmed = text.trim();
  if (trimmed.length < 800) return { ok: false, reason: `too short (${trimmed.length} bytes)` };
  for (const p of STUB_PATTERNS) if (p.test(trimmed)) return { ok: false, reason: 'stub/placeholder content' };
  const words = (trimmed.match(/[A-Za-z]{3,}/g) || []).length;
  if (words < 100) return { ok: false, reason: `only ${words} words` };
  return { ok: true, words, bytes: trimmed.length };
}

function parseInline(text) {
  const runs = [];
  const re = /(\*\*[^*\n]+\*\*|\*[^*\n]+\*|`[^`\n]+`)/g;
  let last = 0; let m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) runs.push(new TextRun(text.slice(last, m.index)));
    const t = m[0];
    if (t.startsWith('**')) runs.push(new TextRun({ text: t.slice(2, -2), bold: true }));
    else if (t.startsWith('`')) runs.push(new TextRun({ text: t.slice(1, -1), font: 'Consolas' }));
    else runs.push(new TextRun({ text: t.slice(1, -1), italics: true }));
    last = m.index + t.length;
  }
  if (last < text.length) runs.push(new TextRun(text.slice(last)));
  return runs.length ? runs : [new TextRun(text)];
}

function mdToParagraphs(md) {
  const paras = [];
  const lines = md.split('\n');
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) continue;
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const level = h[1].length;
      const lvl = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6][level - 1];
      paras.push(new Paragraph({
        heading: lvl,
        spacing: { before: level === 1 ? 360 : 240, after: 120 },
        children: parseInline(h[2]),
      }));
      continue;
    }
    const b = line.match(/^(\s*)[-*+]\s+(.*)$/);
    if (b) {
      const indent = Math.min(Math.floor(b[1].length / 2), 1);
      paras.push(new Paragraph({
        numbering: { reference: 'bulletList', level: indent },
        children: parseInline(b[2]),
      }));
      continue;
    }
    const n = line.match(/^(\s*)\d+\.\s+(.*)$/);
    if (n) {
      const indent = Math.min(Math.floor(n[1].length / 2), 1);
      paras.push(new Paragraph({
        numbering: { reference: 'numList', level: indent },
        children: parseInline(n[2]),
      }));
      continue;
    }
    paras.push(new Paragraph({
      spacing: { after: 120 },
      children: parseInline(line),
    }));
  }
  return paras;
}

function buildHeader(label, range) {
  return [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 240 },
      children: [new TextRun({ text: 'COMPREHENSIVE MEDICAL REFERENCE AND REVIEW', bold: true, color: '1F4E78', size: 28 })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 240 },
      children: [new TextRun({ text: 'Toronto Notes 2025 — 41st Edition', bold: true, size: 24 })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 480 },
      children: [new TextRun({ text: `Rewritten Section: ${range}`, size: 22 })],
    }),
  ];
}

async function buildDocx(md, label, range, outPath) {
  const doc = new Document({
    creator: 'rewrite.js',
    title: label,
    styles: {
      paragraphStyles: [
        { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { color: '2E74B5', size: 32 } },
        { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { color: '2E74B5', size: 26 } },
        { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { color: '1F4D78', size: 24 } },
      ],
    },
    numbering: {
      config: [
        {
          reference: 'bulletList',
          levels: [
            { level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 360, hanging: 360 } } } },
            { level: 1, format: LevelFormat.BULLET, text: '◦', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } },
          ],
        },
        {
          reference: 'numList',
          levels: [
            { level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 360, hanging: 360 } } } },
            { level: 1, format: LevelFormat.LOWER_LETTER, text: '%2.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } },
          ],
        },
      ],
    },
    sections: [{ children: [...buildHeader(label, range), ...mdToParagraphs(md)] }],
  });
  const buf = await Packer.toBuffer(doc);
  fs.writeFileSync(outPath, buf);
}

(async () => {
  const files = fs.readdirSync(OUT_DIR)
    .filter(f => /^pages_\d+-\d+\.rewrite\.txt$/.test(f))
    .sort();
  console.log(`Found ${files.length} rewrite files`);
  const results = [];
  for (const f of files) {
    const label = f.replace('.rewrite.txt', '');
    const range = label.replace('pages_', 'pp ');
    const txt = fs.readFileSync(path.join(OUT_DIR, f), 'utf8');
    const v = validate(txt);
    if (!v.ok) {
      console.log(`  [FAIL] ${label}: ${v.reason}`);
      results.push({ label, ok: false, reason: v.reason });
      continue;
    }
    const docxPath = path.join(DOCX_DIR, `${label}.docx`);
    await buildDocx(txt, label, range, docxPath);
    const sz = fs.statSync(docxPath).size;
    console.log(`  [OK]   ${label}: ${v.words} words -> ${sz} bytes`);
    results.push({ label, ok: true, words: v.words, bytes: v.bytes, docxBytes: sz });
  }
  fs.writeFileSync(path.join(DOCX_DIR, 'validation.json'), JSON.stringify(results, null, 2));
  const okCount = results.filter(r => r.ok).length;
  console.log(`\n${okCount}/${results.length} valid -> ${DOCX_DIR}`);
})();
