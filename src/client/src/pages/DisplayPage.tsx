import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import WishCard from '../components/WishCard';
import useFlagWish from '../hooks/useFlagWish';
import SendWishmailModal from '../components/SendWishmailModal';
import { useWebSocket } from '../hooks/useWebSocket';

interface Wish {
  id: string;
  content: string;
  creator_attributes?: Record<string, string[]>;
  image_url?: string;
  image_id?: string;
}

interface DisplayPageProps {
  onEnterKiosk?: () => void;
  isKiosk?: boolean;
}

export default function DisplayPage({ onEnterKiosk, isKiosk }: DisplayPageProps = {}) {
  const [wishes, setWishes] = useState<Wish[]>([]);
  const [pinnedWishes, setPinnedWishes] = useState<{ wish: Wish; pinnedAt: number }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [capacity, setCapacity] = useState<number>(12);
  const [mailWishId, setMailWishId] = useState<string | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof globalThis.setInterval> | null>(null);
  const { socket } = useWebSocket();

  const loadWishes = useCallback(async () => {
    setError(null);
    try {
      const currentLimit = isKiosk ? capacity : 12;
      const response = await fetch(`/api/wishes/random?limit=${currentLimit}`);
      if (!response.ok) {
        throw new Error('Unable to load wishes.');
      }
      const data = await response.json();
      setWishes(data);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [capacity, isKiosk]);

  const resetTimer = useCallback(() => {
    if (timerRef.current) globalThis.clearInterval(timerRef.current);
    timerRef.current = globalThis.setInterval(loadWishes, 12000);
  }, [loadWishes]);

  useEffect(() => {
    void loadWishes();
    resetTimer();
    return () => {
      if (timerRef.current) globalThis.clearInterval(timerRef.current);
    };
  }, [loadWishes, resetTimer]);

  const handleNewWish = useCallback(
    (newWish: Wish) => {
      setPinnedWishes((prev) => {
        const filtered = prev.filter((p) => p.wish.id !== newWish.id);
        return [{ wish: newWish, pinnedAt: Date.now() }, ...filtered];
      });
      // Give people time to read the newly arrived wish
      resetTimer();
    },
    [resetTimer]
  );

  const handleDeletedWish = useCallback((deletedWishId: string) => {
    setWishes((prev) => prev.filter((w) => w.id !== deletedWishId));
    setPinnedWishes((prev) => prev.filter((p) => p.wish.id !== deletedWishId));
  }, []);

  useEffect(() => {
    if (!socket) return;
    socket.emit('subscribe', { channel: 'wish:*' });
    socket.on('wish:created', handleNewWish);
    socket.on('wish:deleted', handleDeletedWish);
    return () => {
      socket.emit('unsubscribe', { channel: 'wish:*' });
      socket.off('wish:created', handleNewWish);
      socket.off('wish:deleted', handleDeletedWish);
    };
  }, [socket, handleNewWish, handleDeletedWish]);

  useEffect(() => {
    if (!isKiosk) return;

    const calculateCapacity = () => {
      if (!gridRef.current) return;
      const width = gridRef.current.clientWidth;
      const height = gridRef.current.clientHeight;

      // Determine card min-width and gap based on screen size (matches styles.css media queries)
      const isLargeScreen = globalThis.innerWidth >= 1600;
      const gap = isLargeScreen ? 40 : 24;
      const cardWidth = isLargeScreen ? 500 : 240;

      const cols = Math.max(1, Math.floor((width + gap) / (cardWidth + gap)));

      // Account for 1fr flex-stretching on CSS Grid: calculate actual width and height dynamically
      const actualCardWidth = (width - (cols - 1) * gap) / cols;
      const actualCardHeight = actualCardWidth * (3 / 5);

      // Subtract a little buffer from height to ensure we don't clip the bottom row
      const rows = Math.max(1, Math.floor((height + gap - 10) / (actualCardHeight + gap)));

      setCapacity(cols * rows);
    };

    const observer = new ResizeObserver(calculateCapacity);
    if (gridRef.current) observer.observe(gridRef.current);

    calculateCapacity();
    return () => observer.disconnect();
  }, [isKiosk, wishes]);

  const handleFlag = useFlagWish((id) =>
    setWishes((prev) => prev.filter((wish) => wish.id !== id))
  );

  const displayWishes = useMemo(() => {
    const currentLimit = isKiosk ? capacity : 12;
    const now = Date.now();
    const PIN_DURATION = 120000; // 2 minutes
    const activePins = pinnedWishes
      .filter((p) => now - p.pinnedAt < PIN_DURATION)
      .map((p) => p.wish);

    const randomWishes = wishes.filter((w) => !activePins.some((p) => p.id === w.id));

    return [...activePins, ...randomWishes].slice(0, currentLimit);
  }, [wishes, pinnedWishes, capacity, isKiosk]);

  return (
    <section className="display-section">
      <div className="display-header-bar">
        <h1>Big Screen Display</h1>
        {!isKiosk && onEnterKiosk && (
          <button type="button" className="kiosk-btn secondary-button" onClick={onEnterKiosk}>
            Enter Kiosk Mode
          </button>
        )}
      </div>
      <p>This screen refreshes automatically with rotated wishes.</p>
      {error && <div className="message error">{error}</div>}
      <div className="display-grid" ref={gridRef}>
        {displayWishes.map((wish) => (
          <WishCard
            key={wish.id}
            wish={wish}
            cardClass="display-card"
            showFlag={!isKiosk}
            onFlag={handleFlag}
            onSendMail={setMailWishId}
          />
        ))}
      </div>

      {mailWishId && <SendWishmailModal wishId={mailWishId} onClose={() => setMailWishId(null)} />}
    </section>
  );
}
