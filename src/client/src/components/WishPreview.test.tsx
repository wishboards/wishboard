import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import WishPreview from './WishPreview';
import { useTextFit } from '../hooks/useTextFit';

vi.mock('../hooks/useTextFit', () => ({
  useTextFit: vi.fn(() => ({
    containerRef: { current: null },
    contentRef: { current: null },
    isOverflowing: false,
  })),
}));

describe('WishPreview', () => {
  it('renders correctly with given wish', () => {
    const wish = { id: 'w1', content: 'Test preview content' };
    const onOverflowChange = vi.fn();
    render(<WishPreview wish={wish} onOverflowChange={onOverflowChange} />);

    expect(screen.getByText('Card Preview')).toBeInTheDocument();
    expect(screen.getByText('Test preview content')).toBeInTheDocument();
  });

  it('handles InfoToggle interaction', () => {
    const wish = { id: 'w2', content: 'Info toggle test' };
    const onOverflowChange = vi.fn();
    render(<WishPreview wish={wish} onOverflowChange={onOverflowChange} />);

    const infoButton = screen.getByRole('button', { name: 'More information' });
    expect(infoButton).toBeInTheDocument();

    const infoText =
      "Watch your card scale automatically! If text turns red, it won't fit on the board.";
    expect(screen.queryByText(infoText)).not.toBeInTheDocument();

    fireEvent.click(infoButton);
    expect(screen.getByText(infoText)).toBeInTheDocument();

    fireEvent.click(infoButton);
    expect(screen.queryByText(infoText)).not.toBeInTheDocument();
  });

  it('passes onOverflowChange to WishCard which calls it', () => {
    vi.mocked(useTextFit).mockReturnValueOnce({
      containerRef: { current: null },
      contentRef: { current: null },
      isOverflowing: true,
    } as unknown as ReturnType<typeof useTextFit>);

    const wish = { id: 'w3', content: 'Overflowing content' };
    const onOverflowChange = vi.fn();
    render(<WishPreview wish={wish} onOverflowChange={onOverflowChange} />);

    expect(onOverflowChange).toHaveBeenCalledWith(true);
  });

  it('renders WishCard with isEditorPreview=true and showFlag=false', () => {
    vi.mocked(useTextFit).mockReturnValueOnce({
      containerRef: { current: null },
      contentRef: { current: null },
      isOverflowing: true,
    } as unknown as ReturnType<typeof useTextFit>);

    const wish = { id: 'w4', content: 'Editor preview test' };
    const onOverflowChange = vi.fn();
    render(<WishPreview wish={wish} onOverflowChange={onOverflowChange} />);

    // Since isEditorPreview is true and isOverflowing is mocked to true, the article should have 'text-overflow-hint' class
    const article = screen.getByRole('article');
    expect(article).toHaveClass('text-overflow-hint');

    // Since showFlag is false, top left actions should not be rendered
    const topActions = document.querySelector('.card-top-left-actions');
    expect(topActions).not.toBeInTheDocument();
  });
});
