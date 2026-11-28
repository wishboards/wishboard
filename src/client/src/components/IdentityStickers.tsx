import React from 'react';
import { useEventProfile } from '../EventProfileContext';
import { findMatchingStickerKey } from '../utils/stickers';
import { sanitizeStickerImageSrc, sanitizeSvg } from '../../../shared/svgSanitizer';

interface Props {
  attributes?: Record<string, string[]>;
}

const renderIconSticker = (
  cat: string,
  val: string,
  index: number,
  rule: { iconType?: string; class?: string }
) => {
  if (rule.iconType === 'female') {
    return (
      <div key={`${cat}-${index}`} className={`sticker sticker-icon ${rule.class}`} title={val}>
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="10" r="6" />
          <line x1="12" y1="16" x2="12" y2="22" />
          <line x1="9" y1="19" x2="15" y2="19" />
        </svg>
      </div>
    );
  }
  if (rule.iconType === 'male') {
    return (
      <div key={`${cat}-${index}`} className={`sticker sticker-icon ${rule.class}`} title={val}>
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="10" cy="14" r="6" />
          <line x1="14.24" y1="9.76" x2="20" y2="4" />
          <line x1="16" y1="4" x2="20" y2="4" />
          <line x1="20" y1="8" x2="20" y2="4" />
        </svg>
      </div>
    );
  }
  return null;
};

export default function IdentityStickers({ attributes }: Readonly<Props>) {
  const { stickers = {} } = useEventProfile();

  const attrs = attributes || {};

  const renderSticker = (cat: string, val: string, index: number) => {
    const valLower = val.toLowerCase();
    const catStickers = stickers[cat] || {};

    // Find the first matching sticker rule
    const matchKey = findMatchingStickerKey(catStickers, valLower);
    if (!matchKey) return null;

    const rule = catStickers[matchKey];
    if (!rule || typeof rule !== 'object') return null;

    if (rule.type === 'heart') {
      return (
        <div key={`${cat}-${index}`} className="sticker-heart-shadow" title={val}>
          <div className={`sticker-heart ${rule.class}`}></div>
        </div>
      );
    }
    if (rule.type === 'flag') {
      return (
        <div
          key={`${cat}-${index}`}
          className={`sticker sticker-flag ${rule.class}`}
          title={val}
        ></div>
      );
    }
    if (rule.type === 'icon') {
      return renderIconSticker(cat, val, index, rule);
    }
    if (rule.type === 'svg') {
      const sanitized = rule.svg ? sanitizeSvg(rule.svg) : null;
      if (!sanitized) return null;
      return (
        <div
          key={`${cat}-${index}`}
          className="sticker sticker-svg"
          title={val}
          aria-label={val}
          // eslint-disable-next-line @eslint-react/dom-no-dangerously-set-innerhtml -- Sanitized via strict allowlist sanitizeSvg()
          dangerouslySetInnerHTML={{ __html: sanitized }}
        />
      );
    }
    if (rule.type === 'image') {
      const safeSrc = rule.src ? sanitizeStickerImageSrc(rule.src) : null;
      if (!safeSrc) return null;
      return (
        <div key={`${cat}-${index}`} className="sticker sticker-image" title={val}>
          <img
            src={safeSrc}
            alt={val}
            style={{ width: '100%', height: '100%', objectFit: 'contain' }}
          />
        </div>
      );
    }

    return null;
  };

  const rendered: React.ReactNode[] = [];
  for (const [cat, vals] of Object.entries(attrs)) {
    if (Array.isArray(vals)) {
      vals.forEach((val, i) => {
        const el = renderSticker(cat, val, i);
        if (el) rendered.push(el);
      });
    }
  }

  if (rendered.length === 0) return null;

  return <div className="identity-stickers">{rendered}</div>;
}
