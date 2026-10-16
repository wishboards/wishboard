import React from 'react';
import { useEventProfile } from '../EventProfileContext';

interface AttributeInputProps {
  id?: string;
  category?: string;
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  suggestions: string[];
  warning?: string;
}

type StickerRule = {
  type?: string;
  iconType?: string;
  unicode?: string;
  color?: string;
  class?: string;
  src?: string;
};
type StickerMap = Record<string, Record<string, StickerRule>>;

function findStickerMatch(stickerMap: Record<string, StickerRule>, optLower: string) {
  return Object.keys(stickerMap).find((k) => {
    const escapedKey = k.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
    const regex = new RegExp(String.raw`\b${escapedKey}\b`);
    return regex.test(optLower);
  });
}

function resolveStickerRule(opt: string, category: string | undefined, stickersMap: StickerMap) {
  const optLower = opt.toLowerCase();
  if (category && stickersMap[category]) {
    const matchKey = findStickerMatch(stickersMap[category], optLower);
    if (matchKey) return stickersMap[category][matchKey];
  } else {
    for (const cat of Object.keys(stickersMap)) {
      const matchKey = findStickerMatch(stickersMap[cat], optLower);
      if (matchKey) {
        return stickersMap[cat][matchKey];
      }
    }
  }
  return null;
}

export default function AttributeInput({
  id,
  category,
  value,
  onChange,
  placeholder,
  suggestions,
  warning,
}: Readonly<AttributeInputProps>) {
  const { stickers = {} } = useEventProfile();

  const currentItems = value
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s !== '');

  const getDynamicPillIcon = (opt: string, cat?: string, stickersMap?: StickerMap) => {
    const rule = resolveStickerRule(opt, cat, stickersMap || {});

    if (rule?.type === 'icon') {
      if (rule.iconType === 'female') {
        return (
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            width="12"
            height="12"
            stroke="#d81b60"
            strokeWidth="2.5"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="pill-svg-icon"
          >
            <circle cx="12" cy="10" r="6" />
            <line x1="12" y1="16" x2="12" y2="22" />
            <line x1="9" y1="19" x2="15" y2="19" />
          </svg>
        );
      }
      if (rule.iconType === 'male') {
        return (
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            width="12"
            height="12"
            stroke="#1565c0"
            strokeWidth="2.5"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="pill-svg-icon"
          >
            <circle cx="10" cy="14" r="6" />
            <line x1="14.24" y1="9.76" x2="20" y2="4" />
            <line x1="16" y1="4" x2="20" y2="4" />
            <line x1="20" y1="8" x2="20" y2="4" />
          </svg>
        );
      }
    }
    if (rule?.type === 'flag') {
      return <span className={`pill-flag ${rule.class}`} title={opt} />;
    }
    if (rule?.type === 'heart') {
      return <span className={`pill-flag-heart ${rule.class}`} title={opt} />;
    }
    if (rule?.type === 'image') {
      return (
        <img
          src={rule.src}
          alt={opt}
          style={{ width: '1.2em', height: '1.2em', objectFit: 'contain', borderRadius: '4px' }}
        />
      );
    }
    return null;
  };

  const handleToggle = (option: string) => {
    const optionLower = option.toLowerCase();
    const isSelected = currentItems.includes(optionLower);

    let newItems;
    if (isSelected) {
      newItems = currentItems.filter((i) => i !== optionLower);
    } else {
      newItems = [...currentItems, optionLower];
    }
    onChange(newItems.join(', '));
  };

  return (
    <div className="attribute-input-container">
      <input
        id={id}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={
          warning
            ? { borderColor: '#e53935', boxShadow: '0 0 4px rgba(229, 57, 53, 0.4)' }
            : undefined
        }
      />
      {warning && (
        <div
          className="attribute-input-warning"
          style={{
            color: '#e53935',
            fontSize: '13px',
            marginTop: '4px',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            fontWeight: 'bold',
          }}
        >
          <span>⚠️</span>
          <span>{warning}</span>
        </div>
      )}
      <div className="suggestion-pills">
        {suggestions.map((opt) => {
          const isSelected = currentItems.includes(opt.toLowerCase());
          return (
            <button
              key={opt}
              type="button"
              className={`pill-btn ${isSelected ? 'selected' : ''}`}
              onClick={() => handleToggle(opt)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
            >
              <span>{isSelected ? '✓ ' : '+ '}</span>
              {getDynamicPillIcon(opt, category, stickers)}
              <span>{opt}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
