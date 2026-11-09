import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { useState } from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';

// Mock contexts
const useAuthMock = vi.fn();
const useExcludedWishesMock = vi.fn();

vi.mock('./AuthContext', () => ({
  useAuth: () => useAuthMock(),
}));

vi.mock('./hooks/useExcludedWishes', () => ({
  useExcludedWishes: () => useExcludedWishesMock(),
}));

vi.mock('./EventProfileContext', () => ({
  useEventProfile: () => ({
    categories: [
      { id: 'gender', label: 'Gender', suggestions: ['woman', 'man', 'nonbinary'] },
      { id: 'orientation', label: 'Orientation', suggestions: ['queer', 'lesbian', 'pan'] },
      { id: 'role', label: 'Role', suggestions: ['switch', 'top', 'bottom'] },
    ],
  }),
}));

vi.mock('./components/WishScanner', () => ({
  default: () => <div data-testid="mock-scanner" />,
}));

vi.mock('./cardProcessor', () => ({
  processCardImage: vi.fn(),
}));

import BottomSheet from './components/common/BottomSheet';
import EnterWishPage from './pages/EnterWishPage';
import SearchPage from './pages/SearchPage';
import AccountPage from './AccountPage';

describe('Adversarial Stress Suite — Rank 2 Phase 3', () => {
  let originalMatchMedia: typeof globalThis.matchMedia;

  beforeEach(() => {
    document.body.style.overflow = '';
    originalMatchMedia = globalThis.matchMedia;
    useAuthMock.mockReset();
    useExcludedWishesMock.mockReset();

    useExcludedWishesMock.mockReturnValue({
      excludedIds: [],
      excludeWish: vi.fn(),
      unexcludeWish: vi.fn(),
      loading: false,
    });

    useAuthMock.mockReturnValue({
      user: null,
      token: null,
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
      refreshUser: vi.fn(),
    });

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [],
      })
    );
  });

  afterEach(() => {
    globalThis.matchMedia = originalMatchMedia;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.style.overflow = '';
  });

  // =========================================================================
  // 1. BottomSheet Stress & Edge Cases
  // =========================================================================
  describe('BottomSheet Adversarial Tests', () => {
    it('survives rapid opening and closing cycles without leaking body scroll lock', () => {
      function RapidToggle() {
        const [open, setOpen] = useState(false);
        return (
          <div>
            <button data-testid="toggle-btn" onClick={() => setOpen((prev) => !prev)}>
              Toggle
            </button>
            <BottomSheet isOpen={open} onClose={() => setOpen(false)}>
              <div data-testid="drawer-content">Content</div>
            </BottomSheet>
          </div>
        );
      }

      render(<RapidToggle />);
      const btn = screen.getByTestId('toggle-btn');

      // Rapidly toggle 50 times
      for (let i = 0; i < 50; i++) {
        fireEvent.click(btn);
      }

      // Final state: 50 toggles from false -> false (closed)
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(document.body.style.overflow).toBe('');

      // Open one more time
      fireEvent.click(btn);
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(document.body.style.overflow).toBe('hidden');

      // Close it
      fireEvent.click(btn);
      expect(document.body.style.overflow).toBe('');
    });

    it('safely handles multi-touch gestures without throwing or dismissing', () => {
      const handleClose = vi.fn();
      render(
        <BottomSheet isOpen={true} onClose={handleClose}>
          <div>Multi-touch body</div>
        </BottomSheet>
      );

      const dialog = screen.getByRole('dialog');

      // Simulate pinch / 2-finger touch
      fireEvent.touchStart(dialog, {
        touches: [
          { clientY: 100, clientX: 100 },
          { clientY: 120, clientX: 150 },
        ],
      });

      fireEvent.touchMove(dialog, {
        touches: [
          { clientY: 250, clientX: 100 },
          { clientY: 270, clientX: 150 },
        ],
      });

      fireEvent.touchEnd(dialog);
      expect(handleClose).not.toHaveBeenCalled();
      expect(dialog.style.transform).toBe('');
    });

    it('clamps upward drag to 0 and resets smoothly on touch cancel', () => {
      const handleClose = vi.fn();
      render(
        <BottomSheet isOpen={true} onClose={handleClose}>
          <div>Drag test</div>
        </BottomSheet>
      );

      const dialog = screen.getByRole('dialog');

      fireEvent.touchStart(dialog, {
        touches: [{ clientY: 300, clientX: 100 }],
      });

      // Drag up by 150px
      fireEvent.touchMove(dialog, {
        touches: [{ clientY: 150, clientX: 100 }],
      });

      expect(dialog.style.transform).toBe('');

      // Drag down by 50px
      fireEvent.touchMove(dialog, {
        touches: [{ clientY: 350, clientX: 100 }],
      });
      expect(dialog.style.transform).toBe('translateY(50px)');

      // Cancel touch
      fireEvent.touchCancel(dialog);
      expect(dialog.style.transform).toBe('');
      expect(handleClose).not.toHaveBeenCalled();
    });

    it('does not initiate drag dismissal when inner body is scrolled down', () => {
      const handleClose = vi.fn();
      render(
        <BottomSheet isOpen={true} onClose={handleClose}>
          <div style={{ height: '1000px' }}>Tall scrollable content</div>
        </BottomSheet>
      );

      const dialog = screen.getByRole('dialog');
      const body = dialog.querySelector('.bottom-sheet-body') as HTMLDivElement;
      expect(body).toBeInTheDocument();

      // Simulate body scrolled down by 100px
      Object.defineProperty(body, 'scrollTop', { value: 100, writable: true });

      fireEvent.touchStart(dialog, {
        touches: [{ clientY: 200, clientX: 100 }],
      });

      fireEvent.touchMove(dialog, {
        touches: [{ clientY: 350, clientX: 100 }],
      });

      fireEvent.touchEnd(dialog);
      // Because body was scrolled down, drag dismissal is ineligible
      expect(handleClose).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // 2. Active Count Derivation Stress (EnterWishPage & SearchPage)
  // =========================================================================
  describe('Active Count Derivation Stress', () => {
    beforeEach(() => {
      // Simulate mobile viewport < 768px
      Object.defineProperty(globalThis, 'matchMedia', {
        writable: true,
        value: vi.fn().mockImplementation((query: string) => ({
          matches: query === '(max-width: 767px)',
          media: query,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        })),
      });
    });

    it('derives accurate counts with empty strings, whitespace, duplicate commas, and unicode', () => {
      render(<EnterWishPage />);

      const creatorPill = screen.getByRole('button', { name: /Creator Attributes/i });
      expect(creatorPill).toHaveTextContent('0 selected');

      // Open creator sheet
      fireEvent.click(creatorPill);
      const genderInput = screen.getByLabelText(/Creator Genders/i);
      const orientInput = screen.getByLabelText(/Creator Orientations/i);
      const roleInput = screen.getByLabelText(/Creator Roles/i);

      // Case 1: Pure whitespace & duplicate commas -> 0 count
      fireEvent.change(genderInput, { target: { value: '   , , , \t\n , ' } });
      expect(screen.getByText('Creator Attributes (0)')).toBeInTheDocument();

      // Case 2: Commas with whitespace around items
      fireEvent.change(genderInput, { target: { value: ' , , woman , , nonbinary , , ' } });
      expect(screen.getByText('Creator Attributes (2)')).toBeInTheDocument();

      // Case 3: Multiple categories with special characters & emojis
      fireEvent.change(orientInput, { target: { value: 'queer 🌈, pan✨' } });
      fireEvent.change(roleInput, { target: { value: 'switch/flexible, top#1' } });

      // Total count across 3 categories: 2 + 2 + 2 = 6
      expect(screen.getByText('Creator Attributes (6)')).toBeInTheDocument();

      // Close sheet and verify summary pill label
      const doneBtn = screen.getAllByRole('button', { name: 'Done' })[0];
      fireEvent.click(doneBtn);
      expect(creatorPill).toHaveTextContent('6 selected');
    });

    it('SearchPage filter count derives correctly under adversarial input', () => {
      render(<SearchPage />);

      const filterPill = screen.getByRole('button', { name: /Filter Attributes/i });
      expect(filterPill).toHaveTextContent('All');

      // Open filter sheet
      fireEvent.click(filterPill);
      const genderInput = screen.getByLabelText(/Your Gender\(s\)/i);
      const orientInput = screen.getByLabelText(/Your Orientation\(s\)/i);

      // Whitespace and duplicate commas
      fireEvent.change(genderInput, { target: { value: ',,,,   ,,,, ' } });
      expect(screen.getByText('Filter Attributes (0)')).toBeInTheDocument();

      // Valid items with noisy separators
      fireEvent.change(genderInput, { target: { value: ' , man, , , trans-masc , ' } });
      fireEvent.change(orientInput, { target: { value: 'ace, demi' } });
      expect(screen.getByText('Filter Attributes (4)')).toBeInTheDocument();

      // Click Apply Filters
      fireEvent.click(screen.getByRole('button', { name: 'Apply Filters' }));
      expect(filterPill).toHaveTextContent('4 selected');
    });
  });

  // =========================================================================
  // 3. Viewport Transitions (Mobile <-> Desktop)
  // =========================================================================
  describe('Viewport Transitions', () => {
    it('preserves attribute values when transitioning between mobile and desktop', () => {
      let isMobileMatch = true;
      const listeners: Array<(e: { matches: boolean }) => void> = [];

      Object.defineProperty(globalThis, 'matchMedia', {
        writable: true,
        value: vi.fn().mockImplementation((query: string) => ({
          matches: query === '(max-width: 767px)' ? isMobileMatch : !isMobileMatch,
          media: query,
          addEventListener: (_event: string, cb: (e: { matches: boolean }) => void) => {
            listeners.push(cb);
          },
          removeEventListener: vi.fn(),
        })),
      });

      render(<EnterWishPage />);

      // On mobile: open drawer and enter attributes
      const creatorPill = screen.getByRole('button', { name: /Creator Attributes/i });
      fireEvent.click(creatorPill);

      const mobileGenderInput = screen.getByLabelText(/Creator Genders/i);
      fireEvent.change(mobileGenderInput, { target: { value: 'woman, queer' } });

      // Close mobile sheet
      const doneBtn = screen.getAllByRole('button', { name: 'Done' })[0];
      fireEvent.click(doneBtn);
      expect(creatorPill).toHaveTextContent('2 selected');

      // Transition to Desktop viewport (>= 768px)
      act(() => {
        isMobileMatch = false;
        listeners.forEach((l) => l({ matches: false }));
      });

      // In desktop mode, desktop controls are rendered with the same values
      const desktopGenderInput = screen.getByLabelText(/Creator Genders \(anonymous only\)/i);
      expect(desktopGenderInput).toBeInTheDocument();
      expect(desktopGenderInput).toHaveValue('woman, queer');

      // Edit on desktop
      fireEvent.change(desktopGenderInput, { target: { value: 'woman, queer, nonbinary' } });

      // Transition back to Mobile viewport (< 768px)
      act(() => {
        isMobileMatch = true;
        listeners.forEach((l) => l({ matches: true }));
      });

      // Mobile summary pill should now reflect 3 selected!
      const mobilePillAfter = screen.getByRole('button', { name: /Creator Attributes/i });
      expect(mobilePillAfter).toHaveTextContent('3 selected');
    });
  });

  // =========================================================================
  // 4. AccountPage Segmented Tabs Stress
  // =========================================================================
  describe('AccountPage Segmented Tabs Stress', () => {
    beforeEach(() => {
      useAuthMock.mockReturnValue({
        user: {
          id: 'user-stress-1',
          username: 'stress_tester',
          role: 'user',
          contacts: [{ type: 'FetLife', value: 'initial_handle' }],
          attributes: { gender: ['nonbinary'] },
        },
        token: 'stress-token',
        login: vi.fn(),
        register: vi.fn(),
        logout: vi.fn(),
        refreshUser: vi.fn(),
      });
    });

    it('survives rapid tab switching without losing uncommitted input drafts', async () => {
      render(<AccountPage />);
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });

      const tabWishes = screen.getByRole('tab', { name: /My Wishes/i });
      const tabIdentity = screen.getByRole('tab', { name: /Identity & Match/i });
      const tabAppearance = screen.getByRole('tab', { name: /Appearance & Security/i });

      const panelWishes = document.getElementById('panel-wishes');
      const panelIdentity = document.getElementById('panel-identity');
      const panelAppearance = document.getElementById('panel-appearance');

      // Initial state: Wishes tab visible
      expect(panelWishes).not.toHaveAttribute('hidden');
      expect(panelIdentity).toHaveAttribute('hidden');
      expect(panelAppearance).toHaveAttribute('hidden');

      // Switch to Identity & Match tab
      act(() => {
        fireEvent.click(tabIdentity);
      });
      expect(panelIdentity).not.toHaveAttribute('hidden');
      expect(panelWishes).toHaveAttribute('hidden');

      // Enter uncommitted draft into Identity attributes and contact input
      const gendersInput = screen.getByLabelText('Genders');
      act(() => {
        fireEvent.change(gendersInput, { target: { value: 'agender, two-spirit, genderqueer' } });
      });

      const contactInputs = screen.getAllByPlaceholderText('Username, number, etc.');
      act(() => {
        fireEvent.change(contactInputs[0], { target: { value: 'uncommitted_draft_handle' } });
      });

      // Rapidly switch between all 3 tabs 60 times
      const tabs = [tabWishes, tabAppearance, tabIdentity];
      act(() => {
        for (let i = 0; i < 60; i++) {
          fireEvent.click(tabs[i % 3]);
        }
      });

      // Finally switch back to Identity & Match tab
      act(() => {
        fireEvent.click(tabIdentity);
      });

      // Verify uncommitted drafts were completely preserved!
      expect(gendersInput).toHaveValue('agender, two-spirit, genderqueer');
      expect(contactInputs[0]).toHaveValue('uncommitted_draft_handle');
    });

    it('WAI-ARIA circular wrap-around keyboard navigation handles ArrowLeft, ArrowRight, Home, End', async () => {
      render(<AccountPage />);
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });

      const tablist = screen.getByRole('tablist');
      const tabWishes = screen.getByRole('tab', { name: /My Wishes/i });
      const tabIdentity = screen.getByRole('tab', { name: /Identity & Match/i });
      const tabAppearance = screen.getByRole('tab', { name: /Appearance & Security/i });

      // Initial: Wishes (0)
      expect(tabWishes).toHaveAttribute('aria-selected', 'true');

      // ArrowRight -> Identity (1)
      act(() => {
        fireEvent.keyDown(tablist, { key: 'ArrowRight' });
      });
      expect(tabIdentity).toHaveAttribute('aria-selected', 'true');

      // ArrowRight -> Appearance (2)
      act(() => {
        fireEvent.keyDown(tablist, { key: 'ArrowRight' });
      });
      expect(tabAppearance).toHaveAttribute('aria-selected', 'true');

      // ArrowRight -> Circular wrap-around back to Wishes (0)!
      act(() => {
        fireEvent.keyDown(tablist, { key: 'ArrowRight' });
      });
      expect(tabWishes).toHaveAttribute('aria-selected', 'true');

      // ArrowLeft -> Circular wrap-around backwards to Appearance (2)!
      act(() => {
        fireEvent.keyDown(tablist, { key: 'ArrowLeft' });
      });
      expect(tabAppearance).toHaveAttribute('aria-selected', 'true');

      // ArrowLeft -> Identity (1)
      act(() => {
        fireEvent.keyDown(tablist, { key: 'ArrowLeft' });
      });
      expect(tabIdentity).toHaveAttribute('aria-selected', 'true');

      // ArrowLeft -> Wishes (0)
      act(() => {
        fireEvent.keyDown(tablist, { key: 'ArrowLeft' });
      });
      expect(tabWishes).toHaveAttribute('aria-selected', 'true');

      // End key -> Jumps directly to last tab (Appearance)
      act(() => {
        fireEvent.keyDown(tablist, { key: 'End' });
      });
      expect(tabAppearance).toHaveAttribute('aria-selected', 'true');

      // Home key -> Jumps directly to first tab (Wishes)
      act(() => {
        fireEvent.keyDown(tablist, { key: 'Home' });
      });
      expect(tabWishes).toHaveAttribute('aria-selected', 'true');

      // Non-navigation keys (e.g. 'Tab', 'Space', 'Enter', 'a') do not alter active tab
      act(() => {
        fireEvent.keyDown(tablist, { key: 'Enter' });
      });
      expect(tabWishes).toHaveAttribute('aria-selected', 'true');
    });

    it('robustly falls back to Wishes tab when URL hash contains malformed or unknown tab parameters', () => {
      // Test invalid tab parameter in hash
      globalThis.location.hash = '#account?tab=nonexistent_junk_tab';
      const { unmount } = render(<AccountPage />);
      expect(screen.getByRole('tab', { name: /My Wishes/i })).toHaveAttribute(
        'aria-selected',
        'true'
      );
      unmount();

      // Test valid hash
      globalThis.location.hash = '#account?tab=appearance';
      const { unmount: unmount2 } = render(<AccountPage />);
      expect(screen.getByRole('tab', { name: /Appearance & Security/i })).toHaveAttribute(
        'aria-selected',
        'true'
      );
      unmount2();

      globalThis.location.hash = '';
    });
  });
});
