import React, { createContext, useContext, useEffect, useState } from 'react';

export interface Category {
  id: string;
  label: string;
  type?: string;
  suggestions?: string[];
}

export interface EventProfile {
  profile: string;
  title?: string;
  contact_methods: string[];
  categories: Category[];
  stickers?: Record<
    string,
    Record<
      string,
      {
        type?: string;
        iconType?: string;
        unicode?: string;
        color?: string;
        class?: string;
        src?: string;
      }
    >
  >;
  realtimeProvider: string;
  apIp: string;
  isServerless: boolean;
}

const emptyProfile: EventProfile = {
  profile: '',
  contact_methods: ['Phone', 'Email'],
  categories: [],
  realtimeProvider: 'socketio',
  apIp: '',
  isServerless: false,
};

const EventProfileContext = createContext<EventProfile>(emptyProfile);

// eslint-disable-next-line react-refresh/only-export-components -- Context hook export co-located with provider per idiomatic React pattern
export const useEventProfile = () => useContext(EventProfileContext);

export const EventProfileProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [profile, setProfile] = useState<EventProfile>(emptyProfile);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/config', { signal: controller.signal })
      .then((r) => r.json())
      .then((data) => {
        setProfile((prev) => ({ ...prev, ...data }));
        setLoaded(true);
      })
      .catch((e) => {
        if (e.name !== 'AbortError') {
          console.error('Failed to load event profile config:', e);
          setLoaded(true);
        }
      });
    return () => controller.abort();
  }, []);

  if (!loaded)
    return (
      <div style={{ padding: '20px', textAlign: 'center' }}>Loading application config...</div>
    );

  return <EventProfileContext.Provider value={profile}>{children}</EventProfileContext.Provider>;
};

export default EventProfileContext;
