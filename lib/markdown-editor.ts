import { marked } from 'marked';
import TurndownService from 'turndown';

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
  // Configure marked to NOT wrap list items in <p> tags
  marked.use({
    gfm: true,
    breaks: false,
  });

  const html = marked.parse(markdown, { async: false }) as string;
  let result = html;

  // Fix <li><p>text</p></li> → <li>text</li>
  result = result.replace(/<li><p>([\s\S]*?)<\/p><\/li>/g, '<li>$1</li>');

  for (const heading of HEADING_NAMES) {
    const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Case 1: standalone bold paragraph → heading
    result = result.replace(
      new RegExp(`<p><strong>${escaped}[^<]*<\\/strong><\\/p>`, 'g'),
      `<h3>${heading}</h3>`
    );
    // Case 2: bold heading + space + content in same paragraph → split into heading + paragraph
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
  return turndown.turndown(html);
}
