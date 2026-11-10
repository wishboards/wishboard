import React, { useState, useEffect } from 'react';
import ConfirmDeleteAccountModal from '../ConfirmDeleteAccountModal';
import DemoSeederSection from './DemoSeederSection';
import { apiClient } from '../../api/client';

interface UserAccountsSectionProps {
  authHeader: Record<string, string>;
  setMessage: (msg: string | null) => void;
  error: string | null;
  setError: (err: string | null) => void;
  refreshCounter: number;
  triggerRefresh: () => void;
  onSessionExpired?: () => void;
}

export default function UserAccountsSection({
  authHeader,
  setMessage,
  error,
  setError,
  refreshCounter,
  triggerRefresh,
  onSessionExpired,
}: Readonly<UserAccountsSectionProps>) {
  // A 401 means the session is dead; hand off so the app can drop to login.
  // Plain function (not useCallback) is intentional: capturing it in a stable
  // callback would propagate the unstable handleSessionExpired reference from
  // AdminPage through loadUsers into the useEffect dep array, causing a render
  // loop that clears errors immediately after setting them.
  const handledUnauthorized = (response: Response) => {
    if (response.status === 401) {
      onSessionExpired?.();
      return true;
    }
    return false;
  };
  const [users, setUsers] = useState<Array<{ id: string; username: string; role: string }>>([]);
  const [userToDelete, setUserToDelete] = useState<string | null>(null);
  const [deletePreview, setDeletePreview] = useState<{
    wishesCount: number;
    wishmailsCount: number;
  } | null>(null);

  const [isProduction, setIsProduction] = useState<boolean>(true);
  const [hasDemoSeeds, setHasDemoSeeds] = useState<boolean>(false);

  const loadUsers = async () => {
    setError(null);
    const { data, response } = await apiClient.GET('/api/admin/users', { headers: authHeader });
    if (response.ok && data) {
      setUsers(data);
    } else if (!handledUnauthorized(response)) {
      // Surface the failure instead of leaving a silently-empty table that
      // reads as "no accounts exist."
      setError('Failed to load user accounts.');
    }
  };

  const loadConfig = async () => {
    const { data: config, response } = await apiClient.GET('/api/admin/config', {
      headers: authHeader,
    });
    if (response.ok && config) {
      setIsProduction(config.isProduction);
      setHasDemoSeeds(config.hasDemoSeeds ?? false);
    } else {
      handledUnauthorized(response);
    }
  };

  useEffect(() => {
    void loadUsers();
    void loadConfig();
    // eslint-disable-next-line react-hooks/exhaustive-deps, @eslint-react/exhaustive-deps
  }, [refreshCounter]);

  const updateRole = async (id: string, role: 'user' | 'admin') => {
    setMessage(null);
    setError(null);
    const { response } = await apiClient.POST('/api/admin/users/{id}/role', {
      params: { path: { id } },
      headers: authHeader,
      body: { role },
    });
    if (!response.ok) {
      if (handledUnauthorized(response)) return;
      setError('Failed to update role.');
      return;
    }
    setMessage(`Updated user role for ${id}`);
    void loadUsers();
  };

  // The server route is keyed on USERNAME (POST /api/admin/users/{username}/reset-password)
  // and responds with snake_case `new_passphrase` — see src/server/routes/admin.js and the
  // OpenAPI spec. Passing the opaque account id here 404s ("User not found").
  const resetPassphrase = async (username: string) => {
    if (
      !globalThis.confirm(
        "Are you sure you want to reset this user's passphrase? Any active sessions will be terminated."
      )
    )
      return;
    setMessage(null);
    setError(null);
    const { data, response } = await apiClient.POST('/api/admin/users/{username}/reset-password', {
      params: { path: { username } },
      headers: authHeader,
    });
    if (!response.ok) {
      if (handledUnauthorized(response)) return;
      setError('Failed to reset passphrase.');
      return;
    }
    setMessage(
      `Passphrase for ${username} successfully reset! The new passphrase is: ${data?.new_passphrase}`
    );
  };

  const handleDeletePreview = async (id: string) => {
    setMessage(null);
    setError(null);
    const { data: preview, response } = await apiClient.GET(
      '/api/admin/users/{id}/delete-preview',
      {
        params: { path: { id } },
        headers: authHeader,
      }
    );
    if (!response.ok || !preview) {
      if (handledUnauthorized(response)) return;
      setError('Failed to fetch delete preview.');
      return;
    }
    setDeletePreview({
      wishesCount: preview.wishesCount ?? preview.wishes_count ?? 0,
      wishmailsCount: preview.wishmailsCount ?? preview.wishmails_count ?? 0,
    });
    setUserToDelete(id);
  };

  const confirmDelete = async () => {
    if (!userToDelete) return;
    const id = userToDelete;
    setUserToDelete(null);
    setDeletePreview(null);
    setMessage(null);
    setError(null);
    const { response } = await apiClient.POST('/api/admin/users/{id}/delete', {
      params: { path: { id } },
      headers: authHeader,
    });
    if (!response.ok) {
      if (handledUnauthorized(response)) return;
      setError('Failed to delete user.');
      return;
    }
    setMessage(`Deleted user ${id}`);
    void loadUsers();
  };

  return (
    <>
      <section>
        <h2>User Accounts</h2>
        {users.length === 0 ? (
          <p>No user accounts exist yet.</p>
        ) : (
          <div className="wish-grid">
            {users.map((account) => (
              <article className="wish-card" key={account.id}>
                <strong>{account.username}</strong>
                <p>Role: {account.role}</p>
                <div className="wish-actions" style={{ flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => resetPassphrase(account.username)}
                  >
                    Reset Password
                  </button>
                  {account.role === 'admin' ? (
                    <button type="button" onClick={() => updateRole(account.id, 'user')}>
                      Demote
                    </button>
                  ) : (
                    <button type="button" onClick={() => updateRole(account.id, 'admin')}>
                      Promote
                    </button>
                  )}
                  <button
                    type="button"
                    className="danger-button"
                    onClick={() => handleDeletePreview(account.id)}
                  >
                    Delete
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <DemoSeederSection
        isProduction={isProduction}
        hasDemoSeeds={hasDemoSeeds}
        authHeader={authHeader}
        setMessage={setMessage}
        setError={setError}
        triggerRefresh={triggerRefresh}
        handledUnauthorized={handledUnauthorized}
      />

      {userToDelete && deletePreview && (
        <ConfirmDeleteAccountModal
          deletePreview={deletePreview}
          deleteError={error}
          onCancel={() => {
            setUserToDelete(null);
            setDeletePreview(null);
            setError(null);
          }}
          onConfirm={confirmDelete}
        />
      )}
    </>
  );
}
