import React from 'react';

export interface AiSuggestionBadgeProps {
  count?: number;
  onClick: () => void;
  className?: string;
  style?: React.CSSProperties;
}

export default function AiSuggestionBadge({
  count = 0,
  onClick,
  className = '',
  style,
}: Readonly<AiSuggestionBadgeProps>) {
  if (count <= 0) {
    return null;
  }

  return (
    <button
      type="button"
      className={`ai-suggestion-badge ${className}`.trim()}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        padding: '4px 10px',
        fontSize: '0.8rem',
        fontWeight: 600,
        borderRadius: '9999px',
        border: '1px solid #8b5cf6',
        backgroundColor: 'rgba(139, 92, 246, 0.1)',
        color: '#6d28d9',
        cursor: 'pointer',
        transition: 'all 0.15s ease',
        ...style,
      }}
      onClick={onClick}
      aria-label={`View ${count} AI suggestion${count === 1 ? '' : 's'}`}
      title={`${count} AI attribute suggestion${count === 1 ? '' : 's'} ready to review`}
    >
      <span aria-hidden="true" style={{ fontSize: '0.9rem' }}>
        ✨
      </span>
      <span>AI Suggestions</span>
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          minWidth: '18px',
          height: '18px',
          padding: '0 5px',
          borderRadius: '9999px',
          backgroundColor: '#8b5cf6',
          color: '#ffffff',
          fontSize: '0.75rem',
        }}
      >
        {count}
      </span>
    </button>
  );
}
