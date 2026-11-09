import React, { useState, useMemo } from 'react';
import { useAuth } from '../AuthContext';
import PassphraseInput from '../components/PassphraseInput';
import MatchingRulesSection from '../components/admin/MatchingRulesSection';
import FlaggedWishesSection from '../components/admin/FlaggedWishesSection';
import SystemOverviewSection from '../components/admin/SystemOverviewSection';
import UserAccountsSection from '../components/admin/UserAccountsSection';
import BrandingStudioSection from '../components/admin/BrandingStudioSection';

export default function AdminPage() {
  const { user, token, login, logout } = useAuth();
  const [username, setUsername] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshCounter, setRefreshCounter] = useState(0);

  const [activeTab, setActiveTab] = useState<'rules' | 'flags' | 'overview' | 'users' | 'branding'>(
    'rules'
  );
  const [sidebarExpanded, setSidebarExpanded] = useState(true);

  const authHeader = useMemo(() => {
    const headers: Record<string, string> = {};
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    return headers;
  }, [token]);

  const onLogin = async (event: React.SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setMessage(null);
    const result = await login(username.trim(), passphrase.trim());
    if (!result.success) {
      setError(result.error || 'Login failed.');
      return;
    }
    setUsername('');
    setPassphrase('');
    if (result.role !== 'admin') {
      setError('Logged in successfully, but this account is not an admin.');
      return;
    }
    setMessage('Admin login successful.');
  };

  const triggerRefresh = () => setRefreshCounter((c) => c + 1);

  // A 401 from an admin call means our session is dead (expired/orphaned). Drop
  // it and bounce to the login form instead of leaving a stale admin UI that
  // silently shows nothing.
  const handleSessionExpired = () => {
    logout();
    setError('Your session expired or is no longer valid — please log in again.');
  };

  return (
    <section>
      <h1>Admin Panel</h1>
      <p>Only admin users can review flagged wishes and manage accounts.</p>
      {message && <div className="message success">{message}</div>}
      {error && <div className="message error">{error}</div>}

      {user?.role === 'admin' ? (
        <div style={{ display: 'flex', minHeight: '80vh', gap: '24px', marginTop: '24px' }}>
          <aside
            style={{
              width: sidebarExpanded ? '200px' : '60px',
              transition: 'width 0.2s',
              borderRight: '1px solid #333',
              paddingRight: '12px',
            }}
          >
            <button
              type="button"
              className="secondary-button"
              onClick={() => setSidebarExpanded(!sidebarExpanded)}
              style={{ marginBottom: '24px', width: '100%' }}
              aria-label="Toggle Sidebar"
            >
              {sidebarExpanded ? '◀ Collapse' : '▶'}
            </button>
            <nav style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <button
                type="button"
                onClick={() => setActiveTab('rules')}
                className={activeTab === 'rules' ? '' : 'secondary-button'}
                title="Matching Rules"
              >
                📜 {sidebarExpanded && 'Rules'}
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('flags')}
                className={activeTab === 'flags' ? '' : 'secondary-button'}
                title="Flagged Wishes"
              >
                🚩 {sidebarExpanded && 'Flags'}
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('users')}
                className={activeTab === 'users' ? '' : 'secondary-button'}
                title="User Accounts"
              >
                👥 {sidebarExpanded && 'Users'}
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('overview')}
                className={activeTab === 'overview' ? '' : 'secondary-button'}
                title="System Overview"
              >
                📊 {sidebarExpanded && 'System'}
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('branding')}
                className={activeTab === 'branding' ? '' : 'secondary-button'}
                title="Branding Studio"
              >
                🎨 {sidebarExpanded && 'Branding'}
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  globalThis.location.hash = '#poster';
                }}
                title="Print Event Poster"
              >
                🖨️ {sidebarExpanded && 'Poster'}
              </button>
            </nav>
          </aside>
          <main style={{ flex: 1, overflowX: 'hidden' }}>
            {activeTab === 'rules' && (
              <MatchingRulesSection
                authHeader={authHeader}
                setMessage={setMessage}
                setError={setError}
                refreshCounter={refreshCounter}
              />
            )}
            {activeTab === 'flags' && (
              <FlaggedWishesSection
                authHeader={authHeader}
                setMessage={setMessage}
                setError={setError}
                refreshCounter={refreshCounter}
              />
            )}
            {activeTab === 'users' && (
              <UserAccountsSection
                authHeader={authHeader}
                setMessage={setMessage}
                error={error}
                setError={setError}
                refreshCounter={refreshCounter}
                triggerRefresh={triggerRefresh}
                onSessionExpired={handleSessionExpired}
              />
            )}
            {activeTab === 'overview' && (
              <SystemOverviewSection authHeader={authHeader} refreshCounter={refreshCounter} />
            )}
            {activeTab === 'branding' && (
              <BrandingStudioSection
                authHeader={authHeader}
                setMessage={setMessage}
                setError={setError}
                refreshCounter={refreshCounter}
                onSessionExpired={handleSessionExpired}
              />
            )}
          </main>
        </div>
      ) : (
        <form className="form-card" onSubmit={onLogin} style={{ marginTop: '24px' }}>
          <label>
            Admin username{' '}
            <input value={username} onChange={(event) => setUsername(event.target.value)} />
          </label>
          <div style={{ display: 'grid', gap: '8px', marginBottom: '12px' }}>
            <label htmlFor="admin-passphrase">Admin passphrase</label>
            <PassphraseInput id="admin-passphrase" value={passphrase} onChange={setPassphrase} />
          </div>
          <button type="submit">Login as Admin</button>
        </form>
      )}
    </section>
  );
}
