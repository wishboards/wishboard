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
});
