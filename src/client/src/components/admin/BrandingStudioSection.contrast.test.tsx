import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import BrandingStudioSection from './BrandingStudioSection';

describe('BrandingStudioSection Contrast Warnings', () => {
  const mockAuthHeader = { Authorization: 'Bearer test-token' };

  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            profile: 'lifestyle',
            branding: {
              themePreset: 'midnight',
              primaryColor: '#f59e0b',
              accentColor: '#fbbf24',
              surfaceColor: '#1e293b',
              boardTitle: 'Test Board',
            },
          }),
      })
    );
  });

  it('renders without contrast warning when default colors meet contrast standards', async () => {
    render(
      <BrandingStudioSection
        authHeader={mockAuthHeader}
        setMessage={vi.fn()}
        setError={vi.fn()}
        refreshCounter={0}
      />
    );

    await waitFor(() => expect(screen.getByText('Live Interactive Preview')).toBeInTheDocument());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('surfaces a live contrast warning banner when low-contrast colors are entered', async () => {
    render(
      <BrandingStudioSection
        authHeader={mockAuthHeader}
        setMessage={vi.fn()}
        setError={vi.fn()}
        refreshCounter={0}
      />
    );

    await waitFor(() => expect(screen.getByText('Live Interactive Preview')).toBeInTheDocument());

    // Enter a dark primary color on dark surface #1e293b
    const primaryInput = screen.getByLabelText('Primary Brand Color Hex');
    fireEvent.change(primaryInput, { target: { value: '#222222' } });

    await waitFor(() => {
      const banner = screen.getByRole('alert');
      expect(banner).toBeInTheDocument();
      expect(banner).toHaveTextContent(/Accessibility & Contrast Warning/i);
      expect(banner).toHaveTextContent(/Primary brand color/i);
    });
  });
});
