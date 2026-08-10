import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import AboutPage from './AboutPage';
import React from 'react';

describe('AboutPage', () => {
  it('renders the About page with basic content', () => {
    render(<AboutPage />);

    expect(screen.getByRole('heading', { name: /About Wishboard/i })).toBeInTheDocument();
    expect(
      screen.getByText(/Wishboard is a privacy-first, offline-capable digital corkboard/i)
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /View Source on GitHub/i })).toHaveAttribute(
      'href',
      import.meta.env.VITE_GITHUB_REPO
    );
  });
});
