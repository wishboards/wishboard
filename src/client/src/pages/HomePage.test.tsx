import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import HomePage from './HomePage';

describe('HomePage', () => {
  it('renders the main navigation and invokes onNavigate when buttons are clicked', () => {
    const onNavigate = vi.fn();
    render(<HomePage onNavigate={onNavigate} />);

    fireEvent.click(screen.getByRole('button', { name: /Admin/i }));
    expect(onNavigate).toHaveBeenCalledWith('admin');

    fireEvent.click(screen.getByRole('button', { name: /Enter a Wish/i }));
    expect(onNavigate).toHaveBeenCalledWith('enter');

    fireEvent.click(screen.getByRole('button', { name: /Search Wishes/i }));
    expect(onNavigate).toHaveBeenCalledWith('search');

    fireEvent.click(screen.getByRole('button', { name: /Big Screen Display/i }));
    expect(onNavigate).toHaveBeenCalledWith('display');

    fireEvent.click(screen.getByRole('button', { name: /My Account/i }));
    expect(onNavigate).toHaveBeenCalledWith('account');

    fireEvent.click(screen.getByRole('button', { name: /About Wishboard/i }));
    expect(onNavigate).toHaveBeenCalledWith('about');
  });
});
