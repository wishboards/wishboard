import { describe, expect, it } from 'vitest';
import { sanitizeStickerImageSrc, sanitizeSvg } from './svgSanitizer.js';

describe('sanitizeSvg', () => {
  it('allows valid geometric primitives and normalizes tag/attribute casing', () => {
    const input = `
      <?xml version="1.0" encoding="UTF-8"?>
      <!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">
      <!-- comment -->
      <SVG VIEWBOX="0, 0, 24, 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" opacity="0.9">
        <PATH d="M12 2L2 22h20z" fill="#ff00aa" transform="translate(1, 2) scale(1.5)" />
        <CIRCLE cx="12" cy="12" r="5" stroke="rgb(255, 0, 0)" />
        <RECT x="1" y="2" width="10" height="8" opacity="1" />
        <POLYGON points="0,0 10,0 5,10" fill="gold" />
        <LINE x1="0" y1="0" x2="24" y2="24" stroke="black" stroke-width="1.5px" />
      </SVG>
    `;
    const result = sanitizeSvg(input);
    expect(result).not.toBeNull();
    expect(result).toContain('<svg viewBox="0 0 24 24"');
    expect(result).toContain('<path d="M12 2L2 22h20z"');
    expect(result).toContain('<circle cx="12" cy="12" r="5"');
    expect(result).toContain('<rect x="1" y="2" width="10" height="8"');
    expect(result).toContain('<polygon points="0,0 10,0 5,10"');
    expect(result).toContain('<line x1="0" y1="0" x2="24" y2="24"');
    expect(result).not.toContain('<?xml');
    expect(result).not.toContain('<!DOCTYPE');
    expect(result).not.toContain('<!--');
  });

  it('decodes utf8 and base64 data:image/svg+xml URIs', () => {
    const svg = '<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="#123456" /></svg>';
    const utf8Uri = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
    const base64Uri = `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;

    expect(sanitizeSvg(utf8Uri)).toBe(
      '<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="#123456" /></svg>'
    );
    expect(sanitizeSvg(base64Uri)).toBe(
      '<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="#123456" /></svg>'
    );
  });

  it('strips <script>, <foreignObject>, <style>, <iframe>, <object>, <embed> along with their inner content', () => {
    const xssSvg = `
      <svg viewBox="0 0 24 24">
        <script>alert('xss')</script>
        <foreignObject width="24" height="24"><div><script>alert(2)</script>evil</div></foreignObject>
        <style>.a { background: url(javascript:alert(3)); }</style>
        <iframe src="https://evil.example">fallback</iframe>
        <object data="https://evil.example">obj</object>
        <embed src="https://evil.example" />
        <g><circle cx="12" cy="12" r="6" /></g>
        <path d="M0 0L10 10" />
      </svg>
    `;
    const result = sanitizeSvg(xssSvg);
    expect(result).toBe('<svg viewBox="0 0 24 24"><path d="M0 0L10 10" /></svg>');
    expect(result).not.toContain('alert');
    expect(result).not.toContain('foreignObject');
    expect(result).not.toContain('evil');
    expect(result).not.toContain('style');
  });

  it('strips on* event handlers, href, xlink:href, style, and unknown attributes', () => {
    const input = `
      <svg viewBox="0 0 24 24" onload="alert(1)" style="background:url(https://evil.com)" data-evil="1">
        <path d="M0 0h10v10z" ONCLICK="alert(2)" href="javascript:alert(3)" xlink:href="#bad" style="fill:url(#x)" />
      </svg>
    `;
    const result = sanitizeSvg(input);
    expect(result).toBe('<svg viewBox="0 0 24 24"><path d="M0 0h10v10z" /></svg>');
  });

  it('blocks entity-encoded javascript:, url(), http://, https://, //, data:, expression() in attribute values', () => {
    const entityBypass = `
      <svg viewBox="0 0 24 24">
        <path d="M0 0h10" fill="&#106;&#97;&#118;&#97;&#115;&#99;&#114;&#105;&#112;&#116;:alert(1)" />
        <circle cx="5" cy="5" r="4" stroke="url(&#x27;https://evil.com&#x27;)" />
        <rect x="0" y="0" width="5" height="5" fill="expression(alert(1))" />
      </svg>
    `;
    const result = sanitizeSvg(entityBypass);
    expect(result).toBe(
      '<svg viewBox="0 0 24 24"><path d="M0 0h10" /><circle cx="5" cy="5" r="4" /><rect x="0" y="0" width="5" height="5" /></svg>'
    );
  });

  it('rejects invalid transform, path d, points, and numeric values', () => {
    const input = `
      <svg viewBox="0 0 24 24" opacity="99">
        <path d="M0 0; alert(1)" transform="rotate(45) evil(1)" />
        <polygon points="0,0 javascript:1" />
        <circle cx="abc" cy="5" r="4" />
      </svg>
    `;
    const result = sanitizeSvg(input);
    expect(result).toBe(
      '<svg viewBox="0 0 24 24"><path /><polygon /><circle cy="5" r="4" /></svg>'
    );
  });

  it('returns null when root <svg>, valid viewBox, or valid child elements are missing', () => {
    expect(sanitizeSvg(null)).toBeNull();
    expect(sanitizeSvg('')).toBeNull();
    expect(sanitizeSvg('<div><path d="M0 0" /></div>')).toBeNull();
    expect(sanitizeSvg('<svg><path d="M0 0" /></svg>')).toBeNull(); // missing viewBox
    expect(sanitizeSvg('<svg viewBox="0 0 0 24"><path d="M0 0" /></svg>')).toBeNull(); // zero width
    expect(sanitizeSvg('<svg viewBox="0 0 24"><path d="M0 0" /></svg>')).toBeNull(); // 3 numbers
    expect(sanitizeSvg('<svg viewBox="0 0 24 24"><script>alert(1)</script></svg>')).toBeNull(); // no children left
    expect(sanitizeSvg('<svg viewBox="0 0 24 24" />')).toBeNull(); // self-closing svg
    expect(sanitizeSvg('<svg viewBox="0 0 24 24"><path d="M0 0"')).toBeNull(); // unclosed tag
    expect(sanitizeSvg('data:text/html,<script>alert(1)</script>')).toBeNull();
    expect(sanitizeSvg('data:image/svg+xml;utf8,%ZZ')).toBeNull();
  });
});

describe('sanitizeStickerImageSrc', () => {
  it('allows safe /assets/ and /images/ relative paths', () => {
    expect(sanitizeStickerImageSrc('/assets/presenter.png')).toBe('/assets/presenter.png');
    expect(sanitizeStickerImageSrc('  /images/stickers/star.webp  ')).toBe(
      '/images/stickers/star.webp'
    );
  });

  it('sanitizes and re-encodes data:image/svg+xml URIs', () => {
    const raw =
      'data:image/svg+xml;utf8,' +
      encodeURIComponent(
        '<svg viewBox="0 0 24 24" onload="alert(1)"><script>alert(1)</script><circle cx="12" cy="12" r="8" fill="#000" /></svg>'
      );
    const result = sanitizeStickerImageSrc(raw);
    expect(result).toMatch(/^data:image\/svg\+xml;utf8,/);
    const decoded = decodeURIComponent(result.replace('data:image/svg+xml;utf8,', ''));
    expect(decoded).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" fill="#000" /></svg>'
    );
  });

  it('supports unencoded data:image/svg+xml containing percentage attributes like width="100%"', () => {
    const raw =
      'data:image/svg+xml;utf8,<svg viewBox="0 0 24 24" width="100%" height="100%"><circle cx="12" cy="12" r="8" /></svg>';
    const result = sanitizeSvg(raw);
    expect(result).toBe(
      '<svg viewBox="0 0 24 24" width="100%" height="100%"><circle cx="12" cy="12" r="8" /></svg>'
    );
  });

  it('rejects unsafe URLs, traversal, protocol-relative URLs, and non-SVG data URIs', () => {
    expect(sanitizeStickerImageSrc(null)).toBeNull();
    expect(sanitizeStickerImageSrc('')).toBeNull();
    expect(sanitizeStickerImageSrc('javascript:alert(1)')).toBeNull();
    expect(sanitizeStickerImageSrc('vbscript:msgbox(1)')).toBeNull();
    expect(sanitizeStickerImageSrc('http://example.com/a.png')).toBeNull();
    expect(sanitizeStickerImageSrc('https://example.com/a.png')).toBeNull();
    expect(sanitizeStickerImageSrc('//evil.com/a.png')).toBeNull();
    expect(sanitizeStickerImageSrc('/assets/../secret.png')).toBeNull();
    expect(sanitizeStickerImageSrc('/assets/%2e%2e/secret.png')).toBeNull();
    expect(sanitizeStickerImageSrc('/assets/pride%00.svg')).toBeNull();
    expect(sanitizeStickerImageSrc('/images/foo\\bar.png')).toBeNull();
    expect(sanitizeStickerImageSrc('data:text/html,<script>alert(1)</script>')).toBeNull();
    expect(
      sanitizeStickerImageSrc('data:image/svg+xml;utf8,<svg><script>alert(1)</script></svg>')
    ).toBeNull();
    expect(sanitizeStickerImageSrc('data:image/svg+xml;utf8,%ZZ')).toBeNull();
  });

  it('handles non-self-closing child tags and rejects stray <! declarations', () => {
    const withClosing = sanitizeSvg('<svg viewBox="0 0 24 24"><path d="M0 0 L10 10"></path></svg>');
    expect(withClosing).toBe('<svg viewBox="0 0 24 24"><path d="M0 0 L10 10" /></svg>');
    expect(sanitizeSvg('<svg viewBox="0 0 24 24"><!DOCTYPE svg><path d="M0 0" /></svg>')).toBe(
      '<svg viewBox="0 0 24 24"><path d="M0 0" /></svg>'
    );
    expect(
      sanitizeSvg(
        '<!DOCTYPE svg [<!ENTITY xxe "test">]><svg viewBox="0 0 24 24"><path d="M0 0" /></svg>'
      )
    ).toBe('<svg viewBox="0 0 24 24"><path d="M0 0" /></svg>');
  });

  it('validates transform lists and functional colors without backtracking', () => {
    const valid = sanitizeSvg(
      '<svg viewBox="0 0 24 24"><rect x="0" y="0" width="10" height="10" fill="rgba(255, 0, 128, 0.5)" transform="translate(1, 2) rotate(45) scale(1.5)" /></svg>'
    );
    expect(valid).toContain('fill="rgba(255, 0, 128, 0.5)"');
    expect(valid).toContain('transform="translate(1, 2) rotate(45) scale(1.5)"');

    const malformed = sanitizeSvg(
      '<svg viewBox="0 0 24 24"><rect x="0" y="0" width="10" height="10" fill="rgb(1, 2)" transform="translate(1,,2)" /></svg>'
    );
    expect(malformed).toBe(
      '<svg viewBox="0 0 24 24"><rect x="0" y="0" width="10" height="10" /></svg>'
    );

    const longAdversarial = `translate(${'1 '.repeat(500)}a)`;
    const longResult = sanitizeSvg(
      `<svg viewBox="0 0 24 24"><path d="M0 0" transform="${longAdversarial}" /></svg>`
    );
    expect(longResult).toBe('<svg viewBox="0 0 24 24"><path d="M0 0" /></svg>');
  });
});
