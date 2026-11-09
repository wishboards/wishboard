import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import MobileBottomBar from './MobileBottomBar';

describe('MobileBottomBar component', () => {
  it('renders all 5 thumb-zone tabs and omits Board tab', () => {
    render(<MobileBottomBar page="home" navigate={vi.fn()} />);

    expect(screen.getByText('Home')).toBeInTheDocument();
    expect(screen.getByText('Search')).toBeInTheDocument();
    expect(screen.getByText('Post')).toBeInTheDocument();
    expect(screen.getByText('Inbox')).toBeInTheDocument();
    expect(screen.getByText('Account')).toBeInTheDocument();

    // Board / Big Screen is omitted from mobile navigation
    expect(screen.queryByText(/Big Screen/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Board/i)).not.toBeInTheDocument();
  });

  it('marks active tab with active class and aria-current="page"', () => {
    const { rerender } = render(<MobileBottomBar page="home" navigate={vi.fn()} />);

    const homeBtn = screen.getByRole('button', { name: 'Home' });
    expect(homeBtn).toHaveClass('active');
    expect(homeBtn).toHaveAttribute('aria-current', 'page');

    const searchBtn = screen.getByRole('button', { name: 'Search' });
    expect(searchBtn).not.toHaveClass('active');
    expect(searchBtn).not.toHaveAttribute('aria-current');

    // Switch to search
    rerender(<MobileBottomBar page="search" navigate={vi.fn()} />);
    expect(searchBtn).toHaveClass('active');
    expect(searchBtn).toHaveAttribute('aria-current', 'page');
    expect(homeBtn).not.toHaveClass('active');
  });

  it('highlights Post tab with mobile-tab-post class', () => {
    render(<MobileBottomBar page="enter" navigate={vi.fn()} />);

    const postBtn = screen.getByRole('button', { name: 'Post' });
    expect(postBtn).toHaveClass('mobile-tab-post');
    expect(postBtn).toHaveClass('active');
  });

  it('activates Inbox tab when page is wishmail-dashboard', () => {
    render(<MobileBottomBar page="wishmail-dashboard" navigate={vi.fn()} />);

    const inboxBtn = screen.getByRole('button', { name: 'Inbox' });
    expect(inboxBtn).toHaveClass('active');
    expect(inboxBtn).toHaveAttribute('aria-current', 'page');
  });

  it('calls navigate with target page on tab click', () => {
    const handleNavigate = vi.fn();
    render(<MobileBottomBar page="home" navigate={handleNavigate} />);

    fireEvent.click(screen.getByText('Home'));
    expect(handleNavigate).toHaveBeenCalledWith('home');

    fireEvent.click(screen.getByText('Search'));
    expect(handleNavigate).toHaveBeenCalledWith('search');

    fireEvent.click(screen.getByText('Post'));
    expect(handleNavigate).toHaveBeenCalledWith('enter');

    fireEvent.click(screen.getByText('Inbox'));
    expect(handleNavigate).toHaveBeenCalledWith('wishmail-dashboard');

    fireEvent.click(screen.getByText('Account'));
    expect(handleNavigate).toHaveBeenCalledWith('account');
  });

  it('renders unread badge counter and accessible label when unreadCount > 0', () => {
    const { rerender } = render(<MobileBottomBar page="home" navigate={vi.fn()} unreadCount={3} />);

    const badge = screen.getByTestId('mobile-tab-unread-badge');
    expect(badge).toHaveTextContent('3');

    const inboxBtn = screen.getByRole('button', { name: 'Inbox, 3 unread messages' });
    expect(inboxBtn).toBeInTheDocument();

    // Single message singular grammar
    rerender(<MobileBottomBar page="home" navigate={vi.fn()} unreadCount={1} />);
    expect(screen.getByRole('button', { name: 'Inbox, 1 unread message' })).toBeInTheDocument();

    // 99+ display
    rerender(<MobileBottomBar page="home" navigate={vi.fn()} unreadCount={150} />);
    expect(screen.getByTestId('mobile-tab-unread-badge')).toHaveTextContent('99+');
  });

  it('does not render unread badge when unreadCount is 0 or undefined', () => {
    const { rerender } = render(<MobileBottomBar page="home" navigate={vi.fn()} unreadCount={0} />);

    expect(screen.queryByTestId('mobile-tab-unread-badge')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Inbox' })).toBeInTheDocument();

    rerender(<MobileBottomBar page="home" navigate={vi.fn()} />);
    expect(screen.queryByTestId('mobile-tab-unread-badge')).not.toBeInTheDocument();
  });
});
