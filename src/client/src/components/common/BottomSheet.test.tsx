import React, { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import BottomSheet from './BottomSheet';

describe('BottomSheet component', () => {
  beforeEach(() => {
    document.body.style.overflow = '';
  });

  it('renders nothing when isOpen is false', () => {
    render(
      <BottomSheet isOpen={false} onClose={vi.fn()}>
        <div>Content</div>
      </BottomSheet>
    );

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders dialog with ARIA attributes and title linkage when open', () => {
    render(
      <BottomSheet isOpen={true} onClose={vi.fn()} title="Filter Attributes" id="test-sheet">
        <div>Drawer Body</div>
      </BottomSheet>
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby', 'test-sheet-title');
    expect(screen.getByText('Filter Attributes')).toHaveAttribute('id', 'test-sheet-title');
  });

  it('falls back to aria-label when no title is provided', () => {
    render(
      <BottomSheet isOpen={true} onClose={vi.fn()} ariaLabel="Custom Action Sheet">
        <div>Drawer Body</div>
      </BottomSheet>
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-label', 'Custom Action Sheet');
    expect(dialog).not.toHaveAttribute('aria-labelledby');
  });

  it('locks body scroll on mount/open and restores on unmount', () => {
    const { unmount } = render(
      <BottomSheet isOpen={true} onClose={vi.fn()}>
        <div>Drawer Body</div>
      </BottomSheet>
    );

    expect(document.body.style.overflow).toBe('hidden');

    unmount();
    expect(document.body.style.overflow).toBe('');
  });

  it('calls onClose when close button is clicked', () => {
    const handleClose = vi.fn();
    render(
      <BottomSheet isOpen={true} onClose={handleClose} title="Test Title">
        <div>Drawer Body</div>
      </BottomSheet>
    );

    const closeBtn = screen.getByTestId('bottom-sheet-close-button');
    fireEvent.click(closeBtn);
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when backdrop is clicked', () => {
    const handleClose = vi.fn();
    render(
      <BottomSheet isOpen={true} onClose={handleClose}>
        <div>Drawer Body</div>
      </BottomSheet>
    );

    const backdrop = screen.getByTestId('bottom-sheet-backdrop');
    fireEvent.click(backdrop);
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it('does not call onClose on backdrop click when closeOnBackdropClick is false', () => {
    const handleClose = vi.fn();
    render(
      <BottomSheet isOpen={true} onClose={handleClose} closeOnBackdropClick={false}>
        <div>Drawer Body</div>
      </BottomSheet>
    );

    const backdrop = screen.getByTestId('bottom-sheet-backdrop');
    fireEvent.click(backdrop);
    expect(handleClose).not.toHaveBeenCalled();
  });

  it('does not call onClose when drawer content is clicked', () => {
    const handleClose = vi.fn();
    render(
      <BottomSheet isOpen={true} onClose={handleClose}>
        <div data-testid="inner-content">Content</div>
      </BottomSheet>
    );

    fireEvent.click(screen.getByTestId('inner-content'));
    expect(handleClose).not.toHaveBeenCalled();
  });

  it('calls onClose when Escape key is pressed', () => {
    const handleClose = vi.fn();
    render(
      <BottomSheet isOpen={true} onClose={handleClose}>
        <div>Content</div>
      </BottomSheet>
    );

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it('does not call onClose on Escape when closeOnEscape is false', () => {
    const handleClose = vi.fn();
    render(
      <BottomSheet isOpen={true} onClose={handleClose} closeOnEscape={false}>
        <div>Content</div>
      </BottomSheet>
    );

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(handleClose).not.toHaveBeenCalled();
  });

  it('traps focus inside the dialog and restores to trigger element on close', () => {
    function TestHarness() {
      const [isOpen, setIsOpen] = useState(false);
      return (
        <div>
          <button data-testid="trigger-btn" onClick={() => setIsOpen(true)}>
            Open
          </button>
          <BottomSheet isOpen={isOpen} onClose={() => setIsOpen(false)}>
            <button data-testid="first-btn">First</button>
            <input data-testid="input-field" placeholder="Input" />
            <button data-testid="last-btn">Last</button>
          </BottomSheet>
        </div>
      );
    }

    render(<TestHarness />);
    const trigger = screen.getByTestId('trigger-btn');
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    // Open sheet
    fireEvent.click(trigger);

    // Close button or first focusable element should receive focus
    const closeBtn = screen.getByTestId('bottom-sheet-close-button');
    const firstBtn = screen.getByTestId('first-btn');
    const lastBtn = screen.getByTestId('last-btn');

    expect(firstBtn).toBeInTheDocument();
    expect(document.activeElement).toBe(closeBtn);

    // Tab key cycling: from last to first
    lastBtn.focus();
    expect(document.activeElement).toBe(lastBtn);
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(closeBtn);

    // Shift+Tab key cycling: from first to last
    closeBtn.focus();
    expect(document.activeElement).toBe(closeBtn);
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(lastBtn);

    // Close sheet and check focus restoration
    fireEvent.click(screen.getByTestId('bottom-sheet-backdrop'));
    expect(document.activeElement).toBe(trigger);
  });

  it('focuses dialog root container when no focusable elements are present and close button is hidden', () => {
    render(
      <BottomSheet isOpen={true} onClose={vi.fn()} showCloseButton={false} showHandle={false}>
        <p>Text only, no interactive controls</p>
      </BottomSheet>
    );

    const dialog = screen.getByRole('dialog');
    expect(document.activeElement).toBe(dialog);

    // Tab does nothing / prevented
    const tabEvent = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    document.dispatchEvent(tabEvent);
    expect(tabEvent.defaultPrevented).toBe(true);
  });

  it('handles downward swipe gesture past 100px threshold to dismiss', () => {
    const handleClose = vi.fn();
    render(
      <BottomSheet isOpen={true} onClose={handleClose}>
        <div>Swipeable body</div>
      </BottomSheet>
    );

    const dialog = screen.getByRole('dialog');

    // Start touch
    fireEvent.touchStart(dialog, {
      touches: [{ clientY: 200, clientX: 100 }],
    });

    // Move downward by 120px
    fireEvent.touchMove(dialog, {
      touches: [{ clientY: 320, clientX: 100 }],
    });

    expect(dialog.style.transform).toBe('translateY(120px)');

    // Release
    fireEvent.touchEnd(dialog);
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it('handles fast downward flick gesture to dismiss', () => {
    const handleClose = vi.fn();
    render(
      <BottomSheet isOpen={true} onClose={handleClose}>
        <div>Swipeable body</div>
      </BottomSheet>
    );

    const dialog = screen.getByRole('dialog');

    // Simulate touch flick: 40px in 20ms = 2px/ms (velocity > 0.5)
    fireEvent.touchStart(dialog, {
      touches: [{ clientY: 100, clientX: 100 }],
    });

    fireEvent.touchMove(dialog, {
      touches: [{ clientY: 145, clientX: 100 }],
    });

    fireEvent.touchEnd(dialog);
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it('snaps back when downward drag is less than threshold', () => {
    const handleClose = vi.fn();
    render(
      <BottomSheet isOpen={true} onClose={handleClose}>
        <div>Swipeable body</div>
      </BottomSheet>
    );

    const dialog = screen.getByRole('dialog');

    fireEvent.touchStart(dialog, {
      touches: [{ clientY: 100, clientX: 100 }],
    });

    // Drag down only 30px slowly
    fireEvent.touchMove(dialog, {
      touches: [{ clientY: 130, clientX: 100 }],
    });

    // Wait slightly then release
    fireEvent.touchEnd(dialog);
    expect(dialog.style.transform).toBe('');
  });

  it('clamps upward drag to 0 (no upward translation into void)', () => {
    render(
      <BottomSheet isOpen={true} onClose={vi.fn()}>
        <div>Swipeable body</div>
      </BottomSheet>
    );

    const dialog = screen.getByRole('dialog');

    fireEvent.touchStart(dialog, {
      touches: [{ clientY: 200, clientX: 100 }],
    });

    // Drag upward
    fireEvent.touchMove(dialog, {
      touches: [{ clientY: 100, clientX: 100 }],
    });

    expect(dialog.style.transform).toBe('');
  });

  it('ignores horizontal gestures during touch move', () => {
    render(
      <BottomSheet isOpen={true} onClose={vi.fn()}>
        <div>Swipeable body</div>
      </BottomSheet>
    );

    const dialog = screen.getByRole('dialog');

    fireEvent.touchStart(dialog, {
      touches: [{ clientY: 100, clientX: 100 }],
    });

    // Dominant horizontal movement
    fireEvent.touchMove(dialog, {
      touches: [{ clientY: 105, clientX: 180 }],
    });

    expect(dialog.style.transform).toBe('');
  });

  it('resets transform on touch cancel', () => {
    render(
      <BottomSheet isOpen={true} onClose={vi.fn()}>
        <div>Swipeable body</div>
      </BottomSheet>
    );

    const dialog = screen.getByRole('dialog');

    fireEvent.touchStart(dialog, {
      touches: [{ clientY: 100, clientX: 100 }],
    });

    fireEvent.touchMove(dialog, {
      touches: [{ clientY: 160, clientX: 100 }],
    });

    expect(dialog.style.transform).toBe('translateY(60px)');

    fireEvent.touchCancel(dialog);
    expect(dialog.style.transform).toBe('');
  });
});
