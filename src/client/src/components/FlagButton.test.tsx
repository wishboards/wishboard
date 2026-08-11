import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import FlagButton from './FlagButton';
import React from 'react';

describe('FlagButton', () => {
  it('renders with default title', () => {
    const onFlag = vi.fn();
    render(<FlagButton onFlag={onFlag} />);

    const button = screen.getByRole('button');
    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute('title', 'Flag as inappropriate');
  });

  it('renders with custom title', () => {
    const onFlag = vi.fn();
    render(<FlagButton onFlag={onFlag} title="Custom Flag Title" />);

    const button = screen.getByRole('button');
    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute('title', 'Custom Flag Title');
  });

  it('calls onFlag when clicked', () => {
    const onFlag = vi.fn();
    render(<FlagButton onFlag={onFlag} />);

    const button = screen.getByRole('button');
    fireEvent.click(button);

    expect(onFlag).toHaveBeenCalledTimes(1);
  });

  it('has the correct button type', () => {
    const onFlag = vi.fn();
    render(<FlagButton onFlag={onFlag} />);

    const button = screen.getByRole('button');
    expect(button).toHaveAttribute('type', 'button');
  });

  it('has the correct CSS classes', () => {
    const onFlag = vi.fn();
    render(<FlagButton onFlag={onFlag} />);

    const button = screen.getByRole('button');
    expect(button).toHaveClass('flag-wish-btn');

    // Query for the span containing the emoji inside the button
    const span = button.querySelector('span');
    expect(span).toHaveClass('emoji-icon');
  });

  it('sets aria-hidden on the emoji icon span', () => {
    const onFlag = vi.fn();
    render(<FlagButton onFlag={onFlag} />);

    const button = screen.getByRole('button');
    const span = button.querySelector('span');
    expect(span).toHaveAttribute('aria-hidden', 'true');
  });
});
