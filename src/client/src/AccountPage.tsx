import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from './AuthContext';
import { useExcludedWishes } from './hooks/useExcludedWishes';
import { generatePassphrase } from './passphrase.js';
import InfoToggle from './components/InfoToggle';
import AttributeInput from './components/AttributeInput';
import WishCard from './components/WishCard';
import PassphraseInput from './components/PassphraseInput';

import { QRCodeSVG } from 'qrcode.react';
import ConfirmDeleteAccountModal from './components/ConfirmDeleteAccountModal';
import { parseAttributesString, fetchConflicts, getConflictWarning } from './utils/conflicts';
import { useEventProfile, Category } from './EventProfileContext';

function useUsernameExistence(username: string) {
  const [existingUsername, setExistingUsername] = useState(false);
  const [mode, setMode] = useState<'login' | 'register'>('register');

  useEffect(() => {
    const name = username.trim();
    let active = true;

    if (!name) {
      setExistingUsername(false);
      setMode('register');
      return;
    }

    const timer = globalThis.setTimeout(async () => {
      try {
        const response = await fetch(`/api/users/exists?username=${encodeURIComponent(name)}`);
        if (!active) {
          return;
        }
        const exists = response.ok ? Boolean((await response.json()).exists) : false;
        setExistingUsername(exists);
        setMode(exists ? 'login' : 'register');
      } catch (err) {
        console.error(err);
        if (active) {
          setExistingUsername(false);
          setMode('register');
        }
      }
    }, 250);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [username]);

  return { existingUsername, mode, setMode };
}

function useClaimWish(token: string | null, loadWishes: () => void) {
  const [claimId, setClaimId] = useState('');
  const [claimSecret, setClaimSecret] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const claimWish = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);
    if (!claimId.trim() || !claimSecret.trim()) {
      setError('Wish ID and Passphrase are required to claim a wish.');
      return;
    }

    const response = await fetch(`/api/wishes/${encodeURIComponent(claimId.trim())}/claim`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ secret: claimSecret.trim() }),
    });

    if (!response.ok) {
      const data = await response.json();
      setError(data.error || 'Unable to claim wish.');
      return;
    }

    setMessage('Wish claimed successfully!');
    setClaimId('');
    setClaimSecret('');
    loadWishes();
  };

  return { claimId, setClaimId, claimSecret, setClaimSecret, message, error, claimWish };
}

function ClaimWishForm({
  token,
  loadWishes,
}: Readonly<{ token: string | null; loadWishes: () => void }>) {
  const { claimId, setClaimId, claimSecret, setClaimSecret, message, error, claimWish } =
    useClaimWish(token, loadWishes);

  return (
    <div className="profile-edit">
      <div className="label-with-info" style={{ marginBottom: '16px' }}>
        <h2 style={{ margin: 0 }}>Claim an Anonymous Wish</h2>
        <InfoToggle>
          Adopt a wish you created anonymously so you can manage it from your account.
        </InfoToggle>
      </div>
      <form onSubmit={claimWish} style={{ display: 'grid', gap: '12px' }}>
        <label>
          Wish ID{' '}
          <input
            type="text"
            value={claimId}
            onChange={(e) => setClaimId(e.target.value)}
            placeholder="e.g. abc123xy"
          />
        </label>
        <div style={{ display: 'grid', gap: '8px' }}>
          <label htmlFor="claim-passphrase">Passphrase</label>
          <PassphraseInput
            id="claim-passphrase"
            value={claimSecret}
            onChange={setClaimSecret}
            placeholder="e.g. CorrectHorseBatteryStaple"
          />
        </div>
        <button type="submit" className="secondary-button">
          Claim Wish
        </button>
      </form>
      {message && (
        <div className="message success" style={{ marginTop: '12px' }}>
          {message}
        </div>
      )}
      {error && (
        <div className="message error" style={{ marginTop: '12px' }}>
          {error}
        </div>
      )}
    </div>
  );
}

interface IdentityAttributesFieldsProps {
  categories: Category[];
  identityAttributes: Record<string, string>;
  setIdentityAttributes: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  regConflicts: Array<{ message: string; target_attribute: string }>;
}

function IdentityAttributesFields({
  categories,
  identityAttributes,
  setIdentityAttributes,
  regConflicts,
}: Readonly<IdentityAttributesFieldsProps>) {
  return (
    <>
      <div className="label-with-info" style={{ marginTop: '12px', marginBottom: '8px' }}>
        <strong style={{ display: 'block' }}>Identity Attributes</strong>
        <InfoToggle>
          These attributes are automatically applied to any wishes you create, and are used by
          default when you search.
        </InfoToggle>
      </div>
      {categories.map((cat) => {
        const suggs = cat.suggestions || [];
        return (
          <label key={cat.id}>
            Identity {cat.label}s
            <AttributeInput
              category={cat.id}
              value={identityAttributes[cat.id] || ''}
              onChange={(val) => setIdentityAttributes((prev) => ({ ...prev, [cat.id]: val }))}
              placeholder={suggs.length > 0 ? `e.g. ${suggs.slice(0, 2).join(', ')}` : ''}
              suggestions={suggs}
              warning={getConflictWarning(regConflicts, cat.id)}
            />
          </label>
        );
      })}
    </>
  );
}

interface AccountTabsProps {
  mode: 'login' | 'register';
  setMode: (mode: 'login' | 'register') => void;
}

function AccountTabs({ mode, setMode }: Readonly<AccountTabsProps>) {
  return (
    <div className="tab-buttons">
      <button
        type="button"
        className={mode === 'login' ? 'nav-button active' : 'nav-button'}
        onClick={() => setMode('login')}
      >
        Login
      </button>
      <button
        type="button"
        className={mode === 'register' ? 'nav-button active' : 'nav-button'}
        onClick={() => setMode('register')}
      >
        Register
      </button>
    </div>
  );
}

interface UnauthenticatedAccountViewProps {
  mode: 'login' | 'register';
  setMode: (mode: 'login' | 'register') => void;
  effectiveMode: 'login' | 'register';
  onLogin: (event: React.SyntheticEvent<HTMLFormElement>) => Promise<void>;
  onRegister: (event: React.SyntheticEvent<HTMLFormElement>) => Promise<void>;
  username: string;
  setUsername: (username: string) => void;
  passphrase: string;
  setPassphrase: (passphrase: string) => void;
  identityAttributes: Record<string, string>;
  setIdentityAttributes: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  regConflicts: Array<{ message: string; target_attribute: string }>;
  message: string | null;
  error: string | null;
  isSubmitDisabled?: boolean;
}

function UnauthenticatedAccountView({
  mode,
  setMode,
  effectiveMode,
  onLogin,
  onRegister,
  username,
  setUsername,
  passphrase,
  setPassphrase,
  identityAttributes,
  setIdentityAttributes,
  regConflicts,
  message,
  error,
  isSubmitDisabled,
}: Readonly<UnauthenticatedAccountViewProps>) {
  const { categories } = useEventProfile();
  return (
    <section>
      <h1>My Account</h1>
      <p>Create an account to manage multiple wishes, or log in if you already have one.</p>
      <AccountTabs mode={mode} setMode={setMode} />
      <form className="form-card" onSubmit={effectiveMode === 'login' ? onLogin : onRegister}>
        <label>
          Username{' '}
          <input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="Choose a username"
          />
        </label>
        <div style={{ display: 'grid', gap: '8px' }}>
          <label htmlFor="account-passphrase">Passphrase</label>
          <PassphraseInput
            id="account-passphrase"
            value={passphrase}
            onChange={setPassphrase}
            placeholder={
              effectiveMode === 'register'
                ? 'Leave blank to auto-generate when registering'
                : 'Enter your passphrase'
            }
          />
        </div>
        {effectiveMode === 'register' && (
          <IdentityAttributesFields
            categories={categories}
            identityAttributes={identityAttributes}
            setIdentityAttributes={setIdentityAttributes}
            regConflicts={regConflicts}
          />
        )}
        {effectiveMode === 'login' ? (
          <button type="submit">Login</button>
        ) : (
          <button type="submit" disabled={isSubmitDisabled}>
            Register
          </button>
        )}
      </form>
      {effectiveMode === 'register' && isSubmitDisabled && (
        <div className="message error" style={{ marginTop: '12px' }}>
          Please resolve the attribute conflicts before registering.
        </div>
      )}
      {message && <div className="message success">{message}</div>}
      {error && <div className="message error">{error}</div>}
      {effectiveMode === 'register' && (
        <div className="note-box">
          <p>
            Tip: Use a memorable passphrase like <strong>{generatePassphrase()}</strong>.
          </p>
        </div>
      )}
    </section>
  );
}

interface Wish {
  id: string;
  content: string;
  flagged: number;
  contacts: Array<{ type: string; value: string }>;
  wishmail_enabled: boolean;
  creator_attributes?: Record<string, string[]>;
  is_active: boolean;
  image_id?: string;
  image_url?: string;
  unread_wishmail_count?: number;
}

function UnauthenticatedAccountPage() {
  const { login, register } = useAuth();
  const { excludedIds, unexcludeWish } = useExcludedWishes();
  const { categories } = useEventProfile();

  const [username, setUsername] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [identityAttributes, setIdentityAttributes] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hiddenWishes, setHiddenWishes] = useState<Wish[]>([]);
  const [regConflicts, setRegConflicts] = useState<
    Array<{ message: string; target_attribute: string }>
  >([]);

  const { existingUsername, mode, setMode } = useUsernameExistence(username);
  const effectiveMode = existingUsername ? 'login' : mode;

  // Debounced conflict check for registration form
  useEffect(() => {
    if (effectiveMode !== 'register') return;
    const timer = globalThis.setTimeout(async () => {
      const parsed: Record<string, string[]> = {};
      categories.forEach(
        (cat) => (parsed[cat.id] = parseAttributesString(identityAttributes[cat.id] || ''))
      );
      const conflicts = await fetchConflicts(parsed);
      setRegConflicts(conflicts);
    }, 300);
    return () => clearTimeout(timer);
  }, [identityAttributes, categories, effectiveMode]);

  const loadHiddenWishes = useCallback(async () => {
    if (excludedIds.length === 0) {
      setHiddenWishes([]);
      return;
    }
    try {
      const response = await fetch(`/api/wishes?ids=${excludedIds.join(',')}&ignore_attributes=1`);
      if (response.ok) {
        const data = await response.json();
        setHiddenWishes(data);
      }
    } catch (err) {
      console.error('Failed to load local hidden wishes:', err);
    }
  }, [excludedIds]);

  useEffect(() => {
    loadHiddenWishes();
  }, [loadHiddenWishes]);

  const onLogin = async (event: React.SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setMessage(null);
    if (!username.trim() || !passphrase.trim()) {
      setError('Username and passphrase are required to log in.');
      return;
    }
    const response = await login(username.trim(), passphrase.trim());
    if (!response.success) {
      setError(response.error || 'Login failed.');
      return;
    }
    setMessage('Logged in successfully.');
    setUsername('');
    setPassphrase('');
  };

  const onRegister = async (event: React.SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setMessage(null);
    if (!username.trim()) {
      setError('Username is required to register.');
      return;
    }
    const response = await register(
      username.trim(),
      passphrase.trim() || undefined,
      identityAttributes
    );
    if (!response.success) {
      setError(response.error || 'Registration failed.');
      return;
    }
    setMessage(`Account created. Remember your passphrase: ${response.secret}`);
    setUsername('');
    setPassphrase('');
    setIdentityAttributes({});
  };

  const unhideWish = async (id: string) => {
    setError(null);
    setMessage(null);
    try {
      await unexcludeWish(id);
      setMessage('Wish is now visible again.');
      setHiddenWishes((prev) => prev.filter((w) => w.id !== id));
    } catch {
      setError('Error un-hiding wish.');
    }
  };

  return (
    <>
      <UnauthenticatedAccountView
        mode={mode}
        setMode={setMode}
        effectiveMode={effectiveMode}
        onLogin={onLogin}
        onRegister={onRegister}
        username={username}
        setUsername={setUsername}
        passphrase={passphrase}
        setPassphrase={setPassphrase}
        identityAttributes={identityAttributes}
        setIdentityAttributes={setIdentityAttributes}
        regConflicts={regConflicts}
        message={message}
        error={error}
        isSubmitDisabled={regConflicts.length > 0}
      />
      {hiddenWishes.length > 0 && (
        <div style={{ marginTop: '40px', marginBottom: '32px' }}>
          <h2>Hidden Wishes (Not Interested)</h2>
          <p style={{ marginBottom: '16px', fontSize: '0.9rem', color: '#556275' }}>
            These wishes are hidden from your search results on this device. If you log in, they
            will be saved to your account so they stay hidden across all your sessions.
          </p>
          <div className="wish-grid">
            {hiddenWishes.map((wish) => (
              <WishCard
                key={wish.id}
                wish={wish}
                showFlag={false}
                isExcluded={true}
                onExclude={() => {}}
                onUnexclude={() => unhideWish(wish.id)}
              />
            ))}
          </div>
        </div>
      )}
    </>
  );
}

function AuthenticatedAccountPage() {
  const { user, token, logout, refreshUser } = useAuth();
  const { categories } = useEventProfile();

  const [editIdentityAttributes, setEditIdentityAttributes] = useState<Record<string, string>>({});
  const [contacts, setContacts] = useState<Array<{ type: string; value: string }>>([]);
  const [wishmailEnabled, setWishmailEnabled] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [wishes, setWishes] = useState<Wish[]>([]);
  const [hiddenWishes, setHiddenWishes] = useState<Wish[]>([]);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deletePreview, setDeletePreview] = useState<{
    wishesCount: number;
    wishmailsCount: number;
  } | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [editConflicts, setEditConflicts] = useState<
    Array<{ message: string; target_attribute: string }>
  >([]);

  // Debounced conflict check for profile edit form
  useEffect(() => {
    const timer = globalThis.setTimeout(async () => {
      const parsed: Record<string, string[]> = {};
      categories.forEach(
        (cat) => (parsed[cat.id] = parseAttributesString(editIdentityAttributes[cat.id] || ''))
      );
      const conflicts = await fetchConflicts(parsed);
      setEditConflicts(conflicts);
    }, 300);
    return () => clearTimeout(timer);
  }, [editIdentityAttributes, categories]);

  const loadWishes = useCallback(async () => {
    setError(null);
    if (!user) {
      return;
    }
    const response = await fetch('/api/users/me/wishes', {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!response.ok) {
      setError('Unable to load your wishes.');
      return;
    }
    const data = await response.json();
    setWishes(data);
  }, [user, token]);

  const loadHiddenWishes = useCallback(async () => {
    if (!user) return;
    try {
      const response = await fetch('/api/wishes/exclusions', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (response.ok) {
        const data = await response.json();
        setHiddenWishes(data);
      }
    } catch (err) {
      console.error('Failed to load hidden wishes:', err);
    }
  }, [user, token]);

  useEffect(() => {
    loadWishes();
  }, [loadWishes]);

  useEffect(() => {
    loadHiddenWishes();
  }, [loadHiddenWishes]);

  useEffect(() => {
    if (!user) {
      return;
    }
    if (user.attributes) {
      const initialAttributes: Record<string, string> = {};
      Object.keys(user.attributes).forEach((key) => {
        if (Array.isArray(user.attributes[key])) {
          initialAttributes[key] = user.attributes[key].join(', ');
        }
      });
      setEditIdentityAttributes(initialAttributes);
    }
    setContacts(user.contacts || []);
    setWishmailEnabled(user.wishmail_enabled || false);
  }, [user]);

  const saveProfile = async () => {
    setError(null);
    setMessage(null);
    const response = await fetch('/api/users/me', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        identity_attributes: editIdentityAttributes,
        contacts,
        wishmail_enabled: wishmailEnabled,
      }),
    });

    if (!response.ok) {
      const data = await response.json();
      setError(data.error || 'Unable to save profile.');
      return;
    }

    setMessage('Profile updated successfully.');
    if (refreshUser) {
      await refreshUser();
    }
  };

  const deleteWish = async (id: string) => {
    setError(null);
    setMessage(null);
    const response = await fetch(`/api/wishes/${encodeURIComponent(id)}/manage`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ action: 'delete' }),
    });
    if (!response.ok) {
      const data = await response.json();
      setError(data.error || 'Unable to delete wish.');
      return;
    }
    setMessage('Wish deleted successfully.');
    loadWishes();
  };

  const unhideWish = async (id: string) => {
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`/api/wishes/${encodeURIComponent(id)}/exclude`, {
        method: 'DELETE',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!response.ok) {
        setError('Unable to un-hide wish.');
        return;
      }
      setMessage('Wish is now visible again.');
      loadHiddenWishes();
    } catch {
      setError('Error un-hiding wish.');
    }
  };

  const handleDeletePreview = async () => {
    setError(null);
    const response = await fetch('/api/users/me/delete-preview', {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!response.ok) {
      setError('Unable to fetch delete preview.');
      return;
    }
    const data = await response.json();
    setDeletePreview(data);
    setShowDeleteModal(true);
  };

  const confirmDelete = async () => {
    setDeleteError(null);
    const response = await fetch('/api/users/me/delete', {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!response.ok) {
      setDeleteError('Unable to delete account.');
      return;
    }
    logout();
  };

  const toggleProfileStatus = async () => {
    setError(null);
    setMessage(null);
    const endpoint = user?.is_active ? '/api/users/me/deactivate' : '/api/users/me/reactivate';
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!response.ok) {
      setError(`Unable to ${user?.is_active ? 'deactivate' : 'reactivate'} profile.`);
      return;
    }
    setMessage(`Profile ${user?.is_active ? 'deactivated' : 'reactivated'} successfully.`);
    if (refreshUser) await refreshUser();
    loadWishes();
  };

  if (!user) return null; // Should not happen if correctly gated

  return (
    <section>
      <div className="account-header">
        <div>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            Welcome back, {user.username}
            {!user.is_active && (
              <span
                style={{
                  fontSize: '0.9rem',
                  color: '#e53e3e',
                  background: '#ffe5e5',
                  padding: '4px 8px',
                  borderRadius: '4px',
                }}
              >
                Inactive
              </span>
            )}
          </h1>
          <p>You can manage your saved wishes here.</p>
        </div>
        <button type="button" className="secondary-button" onClick={logout}>
          Logout
        </button>
      </div>

      <div className="profile-details">
        <h2>Your profile attributes</h2>
        {categories.map((cat) => (
          <div className="info-row" key={cat.id}>
            <span className="info-label">{cat.label}s:</span>
            <span className="info-value">
              {user.attributes?.[cat.id]?.length > 0
                ? user.attributes[cat.id].join(', ')
                : '(None)'}
            </span>
          </div>
        ))}
      </div>

      <div className="profile-edit">
        <div className="label-with-info" style={{ marginBottom: '16px' }}>
          <h2 style={{ margin: 0 }}>Edit profile attributes</h2>
          <InfoToggle>
            Updating these attributes will change how you are matched with other users across all
            your wishes.
          </InfoToggle>
        </div>
        {categories.map((cat) => {
          const suggs = cat.suggestions || [];
          return (
            <label key={cat.id}>
              {cat.label}s
              <AttributeInput
                category={cat.id}
                value={editIdentityAttributes[cat.id] || ''}
                onChange={(val) =>
                  setEditIdentityAttributes((prev) => ({ ...prev, [cat.id]: val }))
                }
                placeholder={suggs.length > 0 ? `e.g. ${suggs.slice(0, 2).join(', ')}` : ''}
                suggestions={suggs}
                warning={getConflictWarning(editConflicts, cat.id)}
              />
            </label>
          );
        })}

        <div style={{ marginTop: '24px', marginBottom: '16px' }}>
          <h2 style={{ margin: 0 }}>Default Contact Methods</h2>
          <p style={{ marginTop: '8px', fontSize: '0.9rem', color: '#556275' }}>
            These will be automatically added to any new wishes you create.
          </p>
        </div>

        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontWeight: 'normal',
            marginBottom: '16px',
          }}
        >
          <input
            type="checkbox"
            checked={wishmailEnabled}
            onChange={(e) => setWishmailEnabled(e.target.checked)}
            style={{ width: 'auto', minHeight: 'auto' }}
          />{' '}
          Enable Wishmail by default
        </label>

        <div style={{ marginBottom: '24px' }}>
          {contacts.map((contact, index) => (
            <div
              key={`${contact.type}-${contact.value || index}`}
              style={{ display: 'flex', gap: '8px', marginBottom: '8px', alignItems: 'center' }}
            >
              <select
                value={contact.type}
                onChange={(e) => {
                  const newContacts = [...contacts];
                  newContacts[index] = { ...newContacts[index], type: e.target.value };
                  setContacts(newContacts);
                }}
                style={{
                  padding: '8px',
                  borderRadius: '8px',
                  border: '1px solid #d7dee5',
                  background: 'white',
                }}
              >
                <option value="FetLife">FetLife</option>
                <option value="Phone">Phone</option>
                <option value="Email">Email</option>
              </select>
              <input
                type="text"
                value={contact.value}
                onChange={(e) => {
                  const newContacts = [...contacts];
                  newContacts[index] = { ...newContacts[index], value: e.target.value };
                  setContacts(newContacts);
                }}
                placeholder="Username, number, etc."
                style={{ minHeight: '36px', padding: '8px' }}
              />
              <button
                type="button"
                onClick={() => setContacts(contacts.filter((_, i) => i !== index))}
                style={{
                  minHeight: '36px',
                  padding: '0 12px',
                  background: '#e53e3e',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  cursor: 'pointer',
                }}
              >
                X
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setContacts([...contacts, { type: 'FetLife', value: '' }])}
            className="secondary-button"
            style={{ minHeight: '36px', padding: '6px 12px', fontSize: '0.9rem' }}
          >
            + Add Contact Method
          </button>
        </div>

        {editConflicts.length > 0 && (
          <div className="message error" style={{ marginTop: '12px' }}>
            Please resolve the attribute conflicts before saving.
          </div>
        )}
        <button
          className="secondary-button"
          onClick={saveProfile}
          type="button"
          disabled={editConflicts.length > 0}
        >
          Save attributes
        </button>
      </div>

      <div className="profile-edit" style={{ border: '1px solid #e53e3e', marginBottom: '32px' }}>
        <h2 style={{ color: '#e53e3e', margin: '0 0 16px 0' }}>Danger Zone</h2>
        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
          <button
            className="secondary-button"
            style={{
              color: user.is_active ? '#e53e3e' : '#2b6cb0',
              borderColor: user.is_active ? '#e53e3e' : '#2b6cb0',
            }}
            onClick={toggleProfileStatus}
            type="button"
          >
            {user.is_active ? 'Deactivate Profile' : 'Reactivate Profile'}
          </button>
          <button
            className="secondary-button"
            style={{ background: '#e53e3e', color: 'white', borderColor: '#e53e3e' }}
            onClick={handleDeletePreview}
            type="button"
          >
            Delete Account
          </button>
        </div>
        <p style={{ marginTop: '12px', fontSize: '0.9rem', color: '#556275' }}>
          {user.is_active
            ? 'Deactivating your profile will temporarily hide all your wishes. Deleting your account is permanent.'
            : 'Your profile is currently deactivated. Your wishes are hidden from the public.'}
        </p>
      </div>

      {message && <div className="message success">{message}</div>}
      {error && <div className="message error">{error}</div>}

      {wishes.length === 0 ? (
        <p>No wishes yet. Submit a new wish from the Enter a Wish page.</p>
      ) : (
        <div className="wish-grid">
          {wishes.map((wish) => (
            <div key={wish.id} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ opacity: wish.is_active ? 1 : 0.6 }}>
                <WishCard
                  wish={wish}
                  showFlag={false}
                  onEdit={(id) => {
                    globalThis.location.hash = `#manage-wish?id=${id}`;
                  }}
                  onDelete={deleteWish}
                  onViewWishmail={(id) => {
                    globalThis.location.hash = `#wishmail-dashboard?id=${id}`;
                  }}
                  unreadWishmailCount={wish.unread_wishmail_count}
                />
                {!wish.is_active && (
                  <div
                    style={{
                      textAlign: 'center',
                      color: '#e53e3e',
                      fontWeight: 'bold',
                      marginTop: '4px',
                    }}
                  >
                    Inactive
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {hiddenWishes.length > 0 && (
        <div style={{ marginTop: '40px', marginBottom: '32px' }}>
          <h2>Hidden Wishes (Not Interested)</h2>
          <p style={{ marginBottom: '16px', fontSize: '0.9rem', color: '#556275' }}>
            These wishes are hidden from your search results. You can make them visible again at any
            time.
          </p>
          <div className="wish-grid">
            {hiddenWishes.map((wish) => (
              <WishCard
                key={wish.id}
                wish={wish}
                showFlag={false}
                isExcluded={true}
                onExclude={() => {}}
                onUnexclude={() => unhideWish(wish.id)}
              />
            ))}
          </div>
        </div>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
          gap: '24px',
          marginTop: '32px',
        }}
      >
        <ClaimWishForm token={token} loadWishes={loadWishes} />

        {token && (
          <div className="profile-edit" style={{ textAlign: 'center' }}>
            <div
              className="label-with-info"
              style={{ marginBottom: '16px', justifyContent: 'center' }}
            >
              <h2 style={{ margin: 0 }}>Easy Mobile Login</h2>
              <InfoToggle>
                Scan this QR code with your phone or save the link to instantly log back into your
                account without a passphrase.
              </InfoToggle>
            </div>
            <div
              style={{
                background: 'white',
                padding: '16px',
                display: 'inline-block',
                borderRadius: '12px',
              }}
            >
              <QRCodeSVG
                value={`${globalThis.location.origin}${globalThis.location.pathname}#account?token=${token}`}
                size={160}
              />
            </div>
            <p style={{ marginTop: '16px' }}>
              <a href={`#account?token=${token}`}>Bookmark this auto-login link</a>
            </p>
          </div>
        )}
      </div>

      {showDeleteModal && deletePreview && (
        <ConfirmDeleteAccountModal
          deletePreview={deletePreview}
          deleteError={deleteError}
          onCancel={() => setShowDeleteModal(false)}
          onConfirm={confirmDelete}
        />
      )}
    </section>
  );
}

export default function AccountPage() {
  const { user } = useAuth();

  if (!user) {
    return <UnauthenticatedAccountPage />;
  }

  return <AuthenticatedAccountPage />;
}
