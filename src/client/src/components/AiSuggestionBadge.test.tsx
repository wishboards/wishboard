import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import AiSuggestionBadge from './AiSuggestionBadge';

describe('AiSuggestionBadge', () => {
  it('renders nothing when count is 0 or negative', () => {
    const { container: c0 } = render(<AiSuggestionBadge count={0} onClick={vi.fn()} />);
    expect(c0.firstChild).toBeNull();

    const { container: cNeg } = render(<AiSuggestionBadge count={-1} onClick={vi.fn()} />);
    expect(cNeg.firstChild).toBeNull();
  });

  it('renders badge with count and calls onClick when clicked', () => {
    const handleClick = vi.fn();
    render(<AiSuggestionBadge count={3} onClick={handleClick} />);

    const button = screen.getByRole('button');
    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute('aria-label', 'View 3 AI suggestions');
    expect(button).toHaveAttribute('title', '3 AI attribute suggestions ready to review');
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('AI Suggestions')).toBeInTheDocument();

    fireEvent.click(button);
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it('formats singular label when count is 1', () => {
    render(<AiSuggestionBadge count={1} onClick={vi.fn()} />);
    const button = screen.getByRole('button');
    expect(button).toHaveAttribute('aria-label', 'View 1 AI suggestion');
    expect(button).toHaveAttribute('title', '1 AI attribute suggestion ready to review');
  });
});
