import React, { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import BottomSheet from './BottomSheet';
import MobileBottomBar from '../MobileBottomBar';

describe('Rank 2 Phase 3 Empirical Stress Testing: BottomSheet & MobileBottomBar', () => {
  beforeEach(() => {
    document.body.style.overflow = '';
  });

  describe('1. Touch Gesture Delta Thresholds', () => {
    it('snaps back when downward drag is exactly 99px (under 100px threshold with low velocity)', () => {
      const handleClose = vi.fn();
      render(
        <BottomSheet isOpen={true} onClose={handleClose}>
          <div>Drawer Content</div>
        </BottomSheet>
      );

      const dialog = screen.getByRole('dialog');

      // Start touch at t=0
      const startTime = 1000;
      const dateSpy = vi.spyOn(Date, 'now').mockReturnValue(startTime);

      fireEvent.touchStart(dialog, {
        touches: [{ clientY: 100, clientX: 100 }],
      });

      // Move down 99px over 500ms (velocity = 99/500 = 0.198 < 0.5)
      dateSpy.mockReturnValue(startTime + 500);
      fireEvent.touchMove(dialog, {
        touches: [{ clientY: 199, clientX: 100 }],
      });

      expect(dialog.style.transform).toBe('translateY(99px)');

      fireEvent.touchEnd(dialog);
      expect(handleClose).not.toHaveBeenCalled();
      expect(dialog.style.transform).toBe('');

      dateSpy.mockRestore();
    });

    it('dismisses when downward drag exceeds 100px threshold (e.g. 101px)', () => {
      const handleClose = vi.fn();
      render(
        <BottomSheet isOpen={true} onClose={handleClose}>
          <div>Drawer Content</div>
        </BottomSheet>
      );

      const dialog = screen.getByRole('dialog');
      const startTime = 1000;
      const dateSpy = vi.spyOn(Date, 'now').mockReturnValue(startTime);

      fireEvent.touchStart(dialog, {
        touches: [{ clientY: 100, clientX: 100 }],
      });

      // Move down 101px slowly over 1000ms (velocity = 0.101 < 0.5, but distance > 100)
      dateSpy.mockReturnValue(startTime + 1000);
      fireEvent.touchMove(dialog, {
        touches: [{ clientY: 201, clientX: 100 }],
      });

      expect(dialog.style.transform).toBe('translateY(101px)');

      fireEvent.touchEnd(dialog);
      expect(handleClose).toHaveBeenCalledTimes(1);

      dateSpy.mockRestore();
    });

    it('handles large drag deltas (500px) cleanly without overflow or arithmetic errors', () => {
      const handleClose = vi.fn();
      render(
        <BottomSheet isOpen={true} onClose={handleClose}>
          <div>Drawer Content</div>
        </BottomSheet>
      );

      const dialog = screen.getByRole('dialog');

      fireEvent.touchStart(dialog, {
        touches: [{ clientY: 50, clientX: 50 }],
      });

      fireEvent.touchMove(dialog, {
        touches: [{ clientY: 550, clientX: 50 }],
      });

      expect(dialog.style.transform).toBe('translateY(500px)');

      fireEvent.touchEnd(dialog);
      expect(handleClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('2. Velocity Flick Dismissal vs Accidental Twitch', () => {
    it('dismisses on fast flick when distance > 30px and velocity > 0.5px/ms', () => {
      const handleClose = vi.fn();
      render(
        <BottomSheet isOpen={true} onClose={handleClose}>
          <div>Drawer Content</div>
        </BottomSheet>
      );

      const dialog = screen.getByRole('dialog');
      const startTime = 1000;
      const dateSpy = vi.spyOn(Date, 'now').mockReturnValue(startTime);

      fireEvent.touchStart(dialog, {
        touches: [{ clientY: 100, clientX: 100 }],
      });

      // Drag 35px in 20ms -> velocity = 1.75 px/ms (> 0.5)
      dateSpy.mockReturnValue(startTime + 20);
      fireEvent.touchMove(dialog, {
        touches: [{ clientY: 135, clientX: 100 }],
      });

      fireEvent.touchEnd(dialog);
      expect(handleClose).toHaveBeenCalledTimes(1);

      dateSpy.mockRestore();
    });

    it('rejects twitch: high velocity but distance <= 30px (e.g. 25px in 10ms = 2.5px/ms) does NOT dismiss', () => {
      const handleClose = vi.fn();
      render(
        <BottomSheet isOpen={true} onClose={handleClose}>
          <div>Drawer Content</div>
        </BottomSheet>
      );

      const dialog = screen.getByRole('dialog');
      const startTime = 1000;
      const dateSpy = vi.spyOn(Date, 'now').mockReturnValue(startTime);

      fireEvent.touchStart(dialog, {
        touches: [{ clientY: 100, clientX: 100 }],
      });

      // Quick twitch: 25px in 10ms
      dateSpy.mockReturnValue(startTime + 10);
      fireEvent.touchMove(dialog, {
        touches: [{ clientY: 125, clientX: 100 }],
      });

      fireEvent.touchEnd(dialog);
      expect(handleClose).not.toHaveBeenCalled();

      dateSpy.mockRestore();
    });

    it('handles same-millisecond touchEnd without division by zero NaN crash', () => {
      const handleClose = vi.fn();
      render(
        <BottomSheet isOpen={true} onClose={handleClose}>
          <div>Drawer Content</div>
        </BottomSheet>
      );

      const dialog = screen.getByRole('dialog');
      const startTime = 1000;
      const dateSpy = vi.spyOn(Date, 'now').mockReturnValue(startTime);

      fireEvent.touchStart(dialog, {
        touches: [{ clientY: 100, clientX: 100 }],
      });

      // Same millisecond move and end: duration = Math.max(1, 0) = 1
      fireEvent.touchMove(dialog, {
        touches: [{ clientY: 150, clientX: 100 }],
      });

      fireEvent.touchEnd(dialog);
      // 50px / 1ms = 50px/ms > 0.5 and distance > 30 -> dismisses cleanly
      expect(handleClose).toHaveBeenCalledTimes(1);

      dateSpy.mockRestore();
    });
  });

  describe('3. Axis Dominance (Vertical vs Horizontal)', () => {
    it('ignores predominantly horizontal gestures (|deltaY| < |deltaX|)', () => {
      render(
        <BottomSheet isOpen={true} onClose={vi.fn()}>
          <div>Drawer Content</div>
        </BottomSheet>
      );

      const dialog = screen.getByRole('dialog');

      fireEvent.touchStart(dialog, {
        touches: [{ clientY: 100, clientX: 100 }],
      });

      // deltaX = 120, deltaY = 40 (|deltaY| < |deltaX|)
      fireEvent.touchMove(dialog, {
        touches: [{ clientY: 140, clientX: 220 }],
      });

      expect(dialog.style.transform).toBe('');
    });

    it('accepts gesture when vertical movement equals or exceeds horizontal movement (|deltaY| >= |deltaX|)', () => {
      render(
        <BottomSheet isOpen={true} onClose={vi.fn()}>
          <div>Drawer Content</div>
        </BottomSheet>
      );

      const dialog = screen.getByRole('dialog');

      fireEvent.touchStart(dialog, {
        touches: [{ clientY: 100, clientX: 100 }],
      });

      // Exactly diagonal 45 degrees: deltaY = 60, deltaX = 60
      fireEvent.touchMove(dialog, {
        touches: [{ clientY: 160, clientX: 160 }],
      });

      expect(dialog.style.transform).toBe('translateY(60px)');
    });
  });

  describe('4. Upward Touch Drag Clamping', () => {
    it('clamps translateY to 0 during upward drag (deltaY < 0)', () => {
      render(
        <BottomSheet isOpen={true} onClose={vi.fn()}>
          <div>Drawer Content</div>
        </BottomSheet>
      );

      const dialog = screen.getByRole('dialog');

      fireEvent.touchStart(dialog, {
        touches: [{ clientY: 200, clientX: 100 }],
      });

      // Drag up by 150px
      fireEvent.touchMove(dialog, {
        touches: [{ clientY: 50, clientX: 100 }],
      });

      expect(dialog.style.transform).toBe('');
    });

    it('correctly transitions from upward drag to downward drag', () => {
      render(
        <BottomSheet isOpen={true} onClose={vi.fn()}>
          <div>Drawer Content</div>
        </BottomSheet>
      );

      const dialog = screen.getByRole('dialog');

      fireEvent.touchStart(dialog, {
        touches: [{ clientY: 200, clientX: 100 }],
      });

      // First drag upward -> clamped
      fireEvent.touchMove(dialog, {
        touches: [{ clientY: 150, clientX: 100 }],
      });
      expect(dialog.style.transform).toBe('');

      // Then reverse downward past start point -> tracked
      fireEvent.touchMove(dialog, {
        touches: [{ clientY: 270, clientX: 100 }],
      });
      expect(dialog.style.transform).toBe('translateY(70px)');
    });
  });

  describe('5. Touch Cancellation Handling (touchcancel)', () => {
    it('resets dragging state and transform without triggering onClose when touchcancel fires', () => {
      const handleClose = vi.fn();
      render(
        <BottomSheet isOpen={true} onClose={handleClose}>
          <div>Drawer Content</div>
        </BottomSheet>
      );

      const dialog = screen.getByRole('dialog');

      fireEvent.touchStart(dialog, {
        touches: [{ clientY: 100, clientX: 100 }],
      });

      fireEvent.touchMove(dialog, {
        touches: [{ clientY: 250, clientX: 100 }],
      });

      expect(dialog.style.transform).toBe('translateY(150px)');

      // OS interrupt (e.g. phone call, gesture bar) triggers touchcancel
      fireEvent.touchCancel(dialog);

      expect(dialog.style.transform).toBe('');
      expect(handleClose).not.toHaveBeenCalled();

      // Subsequent touch start operates cleanly
      fireEvent.touchStart(dialog, {
        touches: [{ clientY: 100, clientX: 100 }],
      });
      fireEvent.touchMove(dialog, {
        touches: [{ clientY: 140, clientX: 100 }],
      });
      expect(dialog.style.transform).toBe('translateY(40px)');
    });
  });

  describe('6. Multi-Touch Gesture Rejection', () => {
    it('ignores multi-finger gestures (> 1 touch)', () => {
      render(
        <BottomSheet isOpen={true} onClose={vi.fn()}>
          <div>Drawer Content</div>
        </BottomSheet>
      );

      const dialog = screen.getByRole('dialog');

      // Pinch or two-finger gesture
      fireEvent.touchStart(dialog, {
        touches: [
          { clientY: 100, clientX: 100 },
          { clientY: 150, clientX: 150 },
        ],
      });

      fireEvent.touchMove(dialog, {
        touches: [
          { clientY: 200, clientX: 100 },
          { clientY: 250, clientX: 150 },
        ],
      });

      expect(dialog.style.transform).toBe('');
    });
  });

  describe('7. Body Scroll Collision', () => {
    it('disallows drag when bodyRef is scrolled down (scrollTop > 0)', () => {
      const handleClose = vi.fn();
      render(
        <BottomSheet isOpen={true} onClose={handleClose}>
          <div style={{ height: '1000px' }}>Long scrollable content</div>
        </BottomSheet>
      );

      const dialog = screen.getByRole('dialog');
      const body = dialog.querySelector('.bottom-sheet-body') as HTMLDivElement;
      expect(body).toBeInTheDocument();

      // Simulate user scrolled down inside drawer body
      Object.defineProperty(body, 'scrollTop', { value: 75, writable: true, configurable: true });

      fireEvent.touchStart(dialog, {
        touches: [{ clientY: 100, clientX: 100 }],
      });

      // Attempt downward drag
      fireEvent.touchMove(dialog, {
        touches: [{ clientY: 250, clientX: 100 }],
      });

      // Sheet should NOT move because scrollTop > 0
      expect(dialog.style.transform).toBe('');

      fireEvent.touchEnd(dialog);
      expect(handleClose).not.toHaveBeenCalled();

      // Now simulate user scrolled back to top
      body.scrollTop = 0;

      fireEvent.touchStart(dialog, {
        touches: [{ clientY: 100, clientX: 100 }],
      });

      fireEvent.touchMove(dialog, {
        touches: [{ clientY: 220, clientX: 100 }],
      });

      // Now sheet drags downward!
      expect(dialog.style.transform).toBe('translateY(120px)');

      fireEvent.touchEnd(dialog);
      expect(handleClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('8. Focus Trapping & ActiveElement Restoration Edge Cases', () => {
    it('handles zero focusable elements: focuses dialog root and traps Tab', () => {
      render(
        <BottomSheet isOpen={true} onClose={vi.fn()} showCloseButton={false} showHandle={false}>
          <p>Read-only notice</p>
        </BottomSheet>
      );

      const dialog = screen.getByRole('dialog');
      expect(document.activeElement).toBe(dialog);

      // Tab key pressed
      const tabEvent = new KeyboardEvent('keydown', {
        key: 'Tab',
        bubbles: true,
        cancelable: true,
      });
      document.dispatchEvent(tabEvent);
      expect(tabEvent.defaultPrevented).toBe(true);

      // Shift+Tab key pressed
      const shiftTabEvent = new KeyboardEvent('keydown', {
        key: 'Tab',
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      });
      document.dispatchEvent(shiftTabEvent);
      expect(shiftTabEvent.defaultPrevented).toBe(true);
    });

    it('handles single focusable element: maintains focus on it for both Tab and Shift+Tab', () => {
      render(
        <BottomSheet isOpen={true} onClose={vi.fn()} showCloseButton={false}>
          <button data-testid="only-btn">Only Action</button>
        </BottomSheet>
      );

      const onlyBtn = screen.getByTestId('only-btn');
      expect(document.activeElement).toBe(onlyBtn);

      // Tab key
      const tabEvent = new KeyboardEvent('keydown', {
        key: 'Tab',
        bubbles: true,
        cancelable: true,
      });
      document.dispatchEvent(tabEvent);
      expect(tabEvent.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(onlyBtn);

      // Shift+Tab key
      const shiftTabEvent = new KeyboardEvent('keydown', {
        key: 'Tab',
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      });
      document.dispatchEvent(shiftTabEvent);
      expect(shiftTabEvent.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(onlyBtn);
    });

    it('traps focus across deeply nested elements in document order', () => {
      render(
        <BottomSheet isOpen={true} onClose={vi.fn()} showCloseButton={true}>
          <form>
            <div>
              <fieldset>
                <legend>Details</legend>
                <input data-testid="nested-input" type="text" />
                <div>
                  <select data-testid="nested-select">
                    <option>Option 1</option>
                  </select>
                </div>
              </fieldset>
            </div>
            <footer>
              <button data-testid="nested-submit" type="submit">
                Submit
              </button>
            </footer>
          </form>
        </BottomSheet>
      );

      const closeBtn = screen.getByTestId('bottom-sheet-close-button');
      const input = screen.getByTestId('nested-input');
      const select = screen.getByTestId('nested-select');
      const submit = screen.getByTestId('nested-submit');

      expect(document.activeElement).toBe(closeBtn);

      // Cycle forward from last element (submit)
      submit.focus();
      expect(document.activeElement).toBe(submit);
      fireEvent.keyDown(document, { key: 'Tab' });
      expect(document.activeElement).toBe(closeBtn);

      // Cycle backward from first element (closeBtn)
      closeBtn.focus();
      expect(document.activeElement).toBe(closeBtn);
      fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
      expect(document.activeElement).toBe(submit);

      // Navigate inside nested controls
      input.focus();
      expect(document.activeElement).toBe(input);
      select.focus();
      expect(document.activeElement).toBe(select);
    });

    it('filters out disabled, hidden, and display:none elements from focus order', () => {
      render(
        <BottomSheet isOpen={true} onClose={vi.fn()} showCloseButton={false}>
          <button data-testid="enabled-btn">Enabled</button>
          <button disabled data-testid="disabled-btn">
            Disabled
          </button>
          <button hidden data-testid="hidden-btn">
            Hidden
          </button>
          <button style={{ display: 'none' }} data-testid="display-none-btn">
            Display None
          </button>
          <button style={{ visibility: 'hidden' }} data-testid="visibility-hidden-btn">
            Visibility Hidden
          </button>
          <button tabIndex={-1} data-testid="tabindex-minus-1-btn">
            Tabindex Minus 1
          </button>
          <input data-testid="second-enabled" />
        </BottomSheet>
      );

      const enabled1 = screen.getByTestId('enabled-btn');
      const enabled2 = screen.getByTestId('second-enabled');

      expect(document.activeElement).toBe(enabled1);

      // Tab from enabled2 (the last valid element) should wrap back to enabled1
      enabled2.focus();
      fireEvent.keyDown(document, { key: 'Tab' });
      expect(document.activeElement).toBe(enabled1);
    });

    it('gracefully handles unmounted trigger element on close without error', () => {
      function TriggerUnmountHarness() {
        const [isOpen, setIsOpen] = useState(false);
        const [triggerExists, setTriggerExists] = useState(true);

        return (
          <div>
            {triggerExists && (
              <button
                data-testid="temporary-trigger"
                onClick={() => {
                  setIsOpen(true);
                  // Remove trigger while sheet is open
                  setTriggerExists(false);
                }}
              >
                Open and Remove Trigger
              </button>
            )}
            <BottomSheet isOpen={isOpen} onClose={() => setIsOpen(false)}>
              <button data-testid="sheet-btn">Inside</button>
            </BottomSheet>
          </div>
        );
      }

      render(<TriggerUnmountHarness />);
      const trigger = screen.getByTestId('temporary-trigger');
      trigger.focus();
      expect(document.activeElement).toBe(trigger);

      fireEvent.click(trigger);
      expect(screen.queryByTestId('temporary-trigger')).not.toBeInTheDocument();

      // Close sheet -> activeElement cleanup must not crash trying to focus detached node
      expect(() => {
        fireEvent.click(screen.getByTestId('bottom-sheet-backdrop'));
      }).not.toThrow();
    });
  });

  describe('9. Escape Key and Backdrop Dismissal Configuration', () => {
    it('does not dismiss when closeOnEscape is false', () => {
      const handleClose = vi.fn();
      render(
        <BottomSheet isOpen={true} onClose={handleClose} closeOnEscape={false}>
          <div>Content</div>
        </BottomSheet>
      );

      fireEvent.keyDown(document, { key: 'Escape' });
      expect(handleClose).not.toHaveBeenCalled();
    });

    it('does not dismiss when closeOnBackdropClick is false', () => {
      const handleClose = vi.fn();
      render(
        <BottomSheet isOpen={true} onClose={handleClose} closeOnBackdropClick={false}>
          <div>Content</div>
        </BottomSheet>
      );

      fireEvent.click(screen.getByTestId('bottom-sheet-backdrop'));
      expect(handleClose).not.toHaveBeenCalled();
    });

    it('stops event propagation when clicking inside drawer container', () => {
      const handleClose = vi.fn();
      render(
        <BottomSheet isOpen={true} onClose={handleClose}>
          <div data-testid="inner-card">Inner Card</div>
        </BottomSheet>
      );

      const inner = screen.getByTestId('inner-card');
      const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
      const stopPropSpy = vi.spyOn(clickEvent, 'stopPropagation');

      inner.dispatchEvent(clickEvent);
      expect(handleClose).not.toHaveBeenCalled();
      expect(stopPropSpy).toHaveBeenCalled();
    });
  });

  describe('10. MobileBottomBar 5-Tab Navigation & Unread Badges', () => {
    it('renders exactly 5 mobile thumb tabs and no Board / Big Screen button', () => {
      render(<MobileBottomBar page="home" navigate={vi.fn()} />);

      const buttons = screen.getAllByRole('button');
      expect(buttons).toHaveLength(5);

      const buttonLabels = buttons.map((b) => b.textContent?.trim());
      expect(buttonLabels).toEqual(['Home', 'Search', 'Post', 'Inbox', 'Account']);

      expect(screen.queryByText(/Board/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/Big Screen/i)).not.toBeInTheDocument();
    });

    it('evaluates unread badge thresholds correctly (0, negative, 1, 99, 100, 9999)', () => {
      const { rerender } = render(
        <MobileBottomBar page="home" navigate={vi.fn()} unreadCount={0} />
      );

      // unreadCount = 0 -> no badge
      expect(screen.queryByTestId('mobile-tab-unread-badge')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Inbox' })).toBeInTheDocument();

      // unreadCount = -3 -> no badge
      rerender(<MobileBottomBar page="home" navigate={vi.fn()} unreadCount={-3} />);
      expect(screen.queryByTestId('mobile-tab-unread-badge')).not.toBeInTheDocument();

      // unreadCount = 1 -> '1', singular grammar
      rerender(<MobileBottomBar page="home" navigate={vi.fn()} unreadCount={1} />);
      expect(screen.getByTestId('mobile-tab-unread-badge')).toHaveTextContent('1');
      expect(screen.getByRole('button', { name: 'Inbox, 1 unread message' })).toBeInTheDocument();

      // unreadCount = 99 -> '99', plural grammar
      rerender(<MobileBottomBar page="home" navigate={vi.fn()} unreadCount={99} />);
      expect(screen.getByTestId('mobile-tab-unread-badge')).toHaveTextContent('99');
      expect(screen.getByRole('button', { name: 'Inbox, 99 unread messages' })).toBeInTheDocument();

      // unreadCount = 100 -> '99+', plural grammar with exact count in aria-label
      rerender(<MobileBottomBar page="home" navigate={vi.fn()} unreadCount={100} />);
      expect(screen.getByTestId('mobile-tab-unread-badge')).toHaveTextContent('99+');
      expect(
        screen.getByRole('button', { name: 'Inbox, 100 unread messages' })
      ).toBeInTheDocument();

      // unreadCount = 9999 -> '99+'
      rerender(<MobileBottomBar page="home" navigate={vi.fn()} unreadCount={9999} />);
      expect(screen.getByTestId('mobile-tab-unread-badge')).toHaveTextContent('99+');
      expect(
        screen.getByRole('button', { name: 'Inbox, 9999 unread messages' })
      ).toBeInTheDocument();
    });

    it('navigates to the correct target page for all 5 tabs', () => {
      const navigateMock = vi.fn();
      render(<MobileBottomBar page="home" navigate={navigateMock} />);

      fireEvent.click(screen.getByRole('button', { name: 'Home' }));
      expect(navigateMock).toHaveBeenLastCalledWith('home');

      fireEvent.click(screen.getByRole('button', { name: 'Search' }));
      expect(navigateMock).toHaveBeenLastCalledWith('search');

      fireEvent.click(screen.getByRole('button', { name: 'Post' }));
      expect(navigateMock).toHaveBeenLastCalledWith('enter');

      fireEvent.click(screen.getByRole('button', { name: 'Inbox' }));
      expect(navigateMock).toHaveBeenLastCalledWith('wishmail-dashboard');

      fireEvent.click(screen.getByRole('button', { name: 'Account' }));
      expect(navigateMock).toHaveBeenLastCalledWith('account');
    });

    it('highlights active tab for all pages including wishmail-dashboard', () => {
      const { rerender } = render(<MobileBottomBar page="home" navigate={vi.fn()} />);
      expect(screen.getByRole('button', { name: 'Home' })).toHaveClass('active');

      rerender(<MobileBottomBar page="search" navigate={vi.fn()} />);
      expect(screen.getByRole('button', { name: 'Search' })).toHaveClass('active');

      rerender(<MobileBottomBar page="enter" navigate={vi.fn()} />);
      expect(screen.getByRole('button', { name: 'Post' })).toHaveClass('active');
      expect(screen.getByRole('button', { name: 'Post' })).toHaveClass('mobile-tab-post');

      rerender(<MobileBottomBar page="wishmail-dashboard" navigate={vi.fn()} />);
      expect(screen.getByRole('button', { name: 'Inbox' })).toHaveClass('active');

      rerender(<MobileBottomBar page="account" navigate={vi.fn()} />);
      expect(screen.getByRole('button', { name: 'Account' })).toHaveClass('active');
    });
  });
});
