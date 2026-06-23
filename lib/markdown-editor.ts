import { marked } from 'marked';
import TurndownService from 'turndown';
import { ensureBlankLineAfterSections } from '@/lib/summary-format';

const HEADING_NAMES = [
  'Ringkasan Eksekutif',
  'Rangkuman',
  'Insight tambahan',
  'Kesimpulan',
  'Tindak Lanjut',
  'Peserta Rapat',
  'Jalannya Rapat',
  'Metadata',
  'Acara',
  'Penandatangan',
];

export function markdownToHtml(markdown: string): string {
  const processed = ensureBlankLineAfterSections(markdown);
  const html = marked.parse(processed, { async: false }) as string;
  let result = html;

  // Fix <li><p>text</p></li> → <li>text</li>
  result = result.replace(/<li><p>([\s\S]*?)<\/p><\/li>/g, '<li>$1</li>');

  for (const heading of HEADING_NAMES) {
    const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    result = result.replace(
      new RegExp(`<p><strong>${escaped}[^<]*<\\/strong><\\/p>`, 'g'),
      `<h3>${heading}</h3>`
    );
    result = result.replace(
      new RegExp(`<p><strong>(${escaped}[^<]*)<\\/strong>[\\s]+([\\s\\S]*?)<\\/p>`, 'g'),
      `<h3>$1</h3><p>$2</p>`
    );
  }

  return result;
}

export function htmlToMarkdown(html: string): string {
  const turndown = new TurndownService({
    strongDelimiter: '**',
    bulletListMarker: '-',
  });
  turndown.addRule('h3ToBold', {
    filter: 'h3',
    replacement: (content) => `\n\n**${content}**\n\n`,
  });
  return turndown.turndown(html);
}
