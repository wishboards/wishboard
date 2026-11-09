import React from 'react';

export type MobilePageId = 'home' | 'enter' | 'search' | 'wishmail-dashboard' | 'account';

export interface MobileBottomBarProps {
  page: string;
  navigate: (pageId: MobilePageId) => void;
  unreadCount?: number;
}

// Crisp, zero-dependency inline SVG icons with currentColor support
const HomeIcon = () => (
  <svg
    width="22"
    height="22"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    <polyline points="9 22 9 12 15 12 15 22" />
  </svg>
);

const SearchIcon = () => (
  <svg
    width="22"
    height="22"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);

const PostIcon = () => (
  <svg
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

const InboxIcon = () => (
  <svg
    width="22"
    height="22"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
    <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
  </svg>
);

const AccountIcon = () => (
  <svg
    width="22"
    height="22"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>
);

const getTabButtonClass = (isPost: boolean | undefined, isActive: boolean): string => {
  const base = isPost ? 'mobile-tab-button mobile-tab-post' : 'mobile-tab-button';
  return isActive ? `${base} active` : base;
};

const getTabAriaLabel = (label: string, unread: number | undefined): string => {
  if (!unread || unread <= 0) return label;
  const suffix = unread === 1 ? '' : 's';
  return `${label}, ${unread} unread message${suffix}`;
};

export default React.memo(function MobileBottomBar({
  page,
  navigate,
  unreadCount = 0,
}: Readonly<MobileBottomBarProps>) {
  const tabs: readonly {
    id: string;
    label: string;
    icon: React.ReactNode;
    isPost: boolean;
    targetPage: MobilePageId;
    unread?: number;
  }[] = [
    {
      id: 'home',
      label: 'Home',
      icon: <HomeIcon />,
      isPost: false,
      targetPage: 'home',
    },
    {
      id: 'search',
      label: 'Search',
      icon: <SearchIcon />,
      isPost: false,
      targetPage: 'search',
    },
    {
      id: 'enter',
      label: 'Post',
      icon: <PostIcon />,
      isPost: true, // Primary amber action pill in center
      targetPage: 'enter',
    },
    {
      id: 'inbox',
      label: 'Inbox',
      icon: <InboxIcon />,
      isPost: false,
      targetPage: 'wishmail-dashboard',
      unread: unreadCount,
    },
    {
      id: 'account',
      label: 'Account',
      icon: <AccountIcon />,
      isPost: false,
      targetPage: 'account',
    },
  ];

  return (
    <nav className="mobile-bottom-bar" aria-label="Mobile Navigation">
      {tabs.map((tab) => {
        const isActive =
          page === tab.targetPage || (tab.id === 'inbox' && page === 'wishmail-dashboard');
        const buttonClass = getTabButtonClass(tab.isPost, isActive);

        return (
          <button
            type="button"
            key={tab.id}
            className={buttonClass}
            aria-current={isActive ? 'page' : undefined}
            aria-label={getTabAriaLabel(tab.label, tab.unread)}
            onClick={() => navigate(tab.targetPage)}
          >
            <div className="mobile-tab-icon-wrapper">
              <div className="mobile-tab-icon">{tab.icon}</div>
              {tab.unread !== undefined && tab.unread > 0 && (
                <span
                  className="mobile-tab-badge"
                  aria-hidden="true"
                  data-testid="mobile-tab-unread-badge"
                >
                  {tab.unread > 99 ? '99+' : tab.unread}
                </span>
              )}
            </div>
            <span className="mobile-tab-label">{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
});
