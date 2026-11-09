import React, { useEffect, useRef, useState } from 'react';

export interface BottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  id?: string;
  ariaLabel?: string;
  closeOnBackdropClick?: boolean;
  closeOnEscape?: boolean;
  showHandle?: boolean;
  showCloseButton?: boolean;
}

export default function BottomSheet({
  isOpen,
  onClose,
  title,
  children,
  className = '',
  id,
  ariaLabel,
  closeOnBackdropClick = true,
  closeOnEscape = true,
  showHandle = true,
  showCloseButton = true,
}: Readonly<BottomSheetProps>) {
  const drawerRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const previousActiveElementRef = useRef<HTMLElement | null>(null);

  const [translateY, setTranslateY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  const touchStateRef = useRef<{
    startY: number;
    startX: number;
    startTime: number;
    isEligible: boolean;
  }>({ startY: 0, startX: 0, startTime: 0, isEligible: false });

  const sheetId = id || 'bottom-sheet';

  // 1. Keyboard Escape Key Listener
  useEffect(() => {
    if (!isOpen || !closeOnEscape) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };

    globalThis.document?.addEventListener('keydown', handleKeyDown);
    return () => {
      globalThis.document?.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, closeOnEscape, onClose]);

  // 2. Body Scroll Locking
  useEffect(() => {
    if (!isOpen) return;

    const doc = globalThis.document;
    if (!doc?.body) return;

    const originalOverflow = doc.body.style.overflow;
    doc.body.style.overflow = 'hidden';

    return () => {
      doc.body.style.overflow = originalOverflow;
    };
  }, [isOpen]);

  // 3. Focus Trapping & ActiveElement Restoration
  useEffect(() => {
    if (!isOpen) return;

    const doc = globalThis.document;
    if (doc) {
      previousActiveElementRef.current = doc.activeElement as HTMLElement | null;
    }

    const getFocusable = (): HTMLElement[] => {
      if (!drawerRef.current) return [];
      const selector =
        'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
      return Array.from(drawerRef.current.querySelectorAll<HTMLElement>(selector)).filter(
        (el) => !el.hidden && el.style.display !== 'none' && el.style.visibility !== 'hidden'
      );
    };

    const focusable = getFocusable();
    if (focusable.length > 0) {
      focusable[0]?.focus();
    } else {
      drawerRef.current?.focus();
    }

    const handleTabKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;

      const elements = getFocusable();
      if (elements.length === 0) {
        e.preventDefault();
        return;
      }

      const first = elements[0];
      const last = elements[elements.length - 1];

      if (e.shiftKey) {
        if (
          doc?.activeElement === first ||
          !drawerRef.current?.contains(doc?.activeElement ?? null)
        ) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (
          doc?.activeElement === last ||
          !drawerRef.current?.contains(doc?.activeElement ?? null)
        ) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    doc?.addEventListener('keydown', handleTabKey);

    return () => {
      doc?.removeEventListener('keydown', handleTabKey);
      if (previousActiveElementRef.current && doc?.contains(previousActiveElementRef.current)) {
        previousActiveElementRef.current.focus();
      }
    };
  }, [isOpen]);

  // 4. Touch Gesture Handlers
  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length !== 1) return;

    const touch = e.touches[0];
    const isScrollableBody = (bodyRef.current?.scrollTop ?? 0) > 0;

    touchStateRef.current = {
      startY: touch.clientY,
      startX: touch.clientX,
      startTime: Date.now(),
      isEligible: !isScrollableBody,
    };
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!touchStateRef.current.isEligible || e.touches.length !== 1) return;

    const touch = e.touches[0];
    const deltaY = touch.clientY - touchStateRef.current.startY;
    const deltaX = touch.clientX - touchStateRef.current.startX;

    // Enforce dominant vertical gesture
    if (Math.abs(deltaY) < Math.abs(deltaX)) return;

    if (deltaY > 0) {
      setIsDragging(true);
      setTranslateY(deltaY);
      if (e.cancelable) {
        e.preventDefault();
      }
    } else {
      setTranslateY(0);
    }
  };

  const handleTouchEnd = () => {
    if (!isDragging) {
      setTranslateY(0);
      return;
    }

    setIsDragging(false);
    const distance = translateY;
    const duration = Math.max(1, Date.now() - touchStateRef.current.startTime);
    const velocity = distance / duration;

    // Dismiss if pulled down > 100px or quick downward flick (velocity > 0.5px/ms with 30px distance)
    if (distance > 100 || (velocity > 0.5 && distance > 30)) {
      onClose();
    }
    setTranslateY(0);
  };

  const handleTouchCancel = () => {
    setIsDragging(false);
    setTranslateY(0);
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (closeOnBackdropClick && e.target === e.currentTarget) {
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="bottom-sheet-overlay" role="presentation" data-testid="bottom-sheet-overlay">
      <div
        className="bottom-sheet-backdrop"
        aria-hidden="true"
        data-testid="bottom-sheet-backdrop"
        onClick={handleBackdropClick}
      />
      <div
        ref={drawerRef}
        id={id}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? `${sheetId}-title` : undefined}
        aria-label={title ? undefined : ariaLabel || 'Drawer'}
        tabIndex={-1}
        className={`bottom-sheet-drawer ${className}`}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchCancel}
        style={{
          transform: translateY > 0 ? `translateY(${translateY}px)` : undefined,
          transition: isDragging ? 'none' : 'transform 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {showHandle && (
          <div
            className="bottom-sheet-handle-container"
            aria-hidden="true"
            data-testid="bottom-sheet-handle"
          >
            <div className="bottom-sheet-handle-bar" />
          </div>
        )}

        {(title || showCloseButton) && (
          <header className="bottom-sheet-header">
            {title && (
              <h2 id={`${sheetId}-title`} className="bottom-sheet-title">
                {title}
              </h2>
            )}
            {showCloseButton && (
              <button
                type="button"
                className="bottom-sheet-close-btn"
                onClick={onClose}
                aria-label="Close drawer"
                data-testid="bottom-sheet-close-button"
              >
                ✕
              </button>
            )}
          </header>
        )}

        <div ref={bodyRef} className="bottom-sheet-body">
          {children}
        </div>
      </div>
    </div>
  );
}
