import React, { useEffect, useState } from 'react';
import { useAuth } from '../AuthContext';

interface Wishmail {
  id: string;
  content: string;
  return_contacts: { type: string; value: string }[];
  sender_id: string | null;
  read: boolean;
  created_at: string;
}

function parseInitialWishmailParams(): {
  initialError: string | null;
  wishId: string | null;
  secret: string | null;
} {
  const hashIndex = globalThis.location.hash.indexOf('?');
  if (hashIndex === -1) {
    return { initialError: 'No wish ID provided.', wishId: null, secret: null };
  }

  const params = new URLSearchParams(globalThis.location.hash.substring(hashIndex));
  const wId = params.get('id');
  const wSecret = params.get('secret');

  if (!wId) {
    return { initialError: 'No wish ID provided.', wishId: null, secret: null };
  }

  if (!/^[a-zA-Z0-9-]+$/.test(wId)) {
    return { initialError: 'Invalid wish ID format.', wishId: null, secret: null };
  }

  if (wSecret && !/^[a-zA-Z0-9_-]+$/.test(wSecret)) {
    return { initialError: 'Invalid secret format.', wishId: null, secret: null };
  }

  return { initialError: null, wishId: wId, secret: wSecret };
}

export default function WishmailDashboard() {
  const { token } = useAuth();
  const [initialParams] = useState(parseInitialWishmailParams);
  const [mails, setMails] = useState<Wishmail[]>([]);
  const [error, setError] = useState<string | null>(initialParams.initialError);
  const [wishId] = useState<string | null>(initialParams.wishId);
  const [secret] = useState<string | null>(initialParams.secret);

  useEffect(() => {
    if (!wishId || initialParams.initialError) {
      return;
    }

    const controller = new AbortController();
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (secret) headers['x-wish-secret'] = secret;

    fetch(`/api/wishes/${encodeURIComponent(wishId)}/mail`, {
      headers,
      signal: controller.signal,
    })
      .then((res) => {
        if (res.ok) return res.json();
        throw new Error('Not authorized to view wishmail for this wish, or wish not found.');
      })
      .then((data) => setMails(data))
      .catch((err) => {
        if (err.name !== 'AbortError') {
          setError(err.message);
        }
      });

    return () => controller.abort();
  }, [token, wishId, secret, initialParams.initialError]);

  const markRead = async (mailId: string) => {
    if (!wishId || !/^[a-zA-Z0-9-]+$/.test(wishId) || !/^[a-zA-Z0-9-]+$/.test(mailId)) return;

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;

    const response = await fetch(
      `/api/wishes/${encodeURIComponent(wishId)}/mail/${encodeURIComponent(mailId)}/read`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ secret: secret || undefined }),
      }
    );

    if (response.ok) {
      setMails(mails.map((m) => (m.id === mailId ? { ...m, read: true } : m)));
    }
  };

  const deleteMail = async (mailId: string) => {
    if (!wishId || !/^[a-zA-Z0-9-]+$/.test(wishId) || !/^[a-zA-Z0-9-]+$/.test(mailId)) return;
    if (!confirm('Are you sure you want to delete this message?')) return;

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (secret) headers['x-wish-secret'] = secret;

    const response = await fetch(
      `/api/wishes/${encodeURIComponent(wishId)}/mail/${encodeURIComponent(mailId)}`,
      {
        method: 'DELETE',
        headers,
      }
    );

    if (response.ok) {
      setMails(mails.filter((m) => m.id !== mailId));
    } else {
      alert('Failed to delete message.');
    }
  };

  if (error) {
    return (
      <section>
        <h1>Wishmail Dashboard</h1>
        <div className="message error">{error}</div>
        <a
          href="#home"
          className="secondary-button"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '10px 16px',
            borderRadius: '99px',
            marginTop: '16px',
            textDecoration: 'none',
            fontWeight: 600,
          }}
        >
          Return Home
        </a>
      </section>
    );
  }

  return (
    <section>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          flexWrap: 'wrap',
          gap: '16px',
          marginBottom: '24px',
        }}
      >
        <div>
          <h1 style={{ margin: 0 }}>Wishmail</h1>
          <p style={{ marginTop: '8px', color: '#556275' }}>
            Messages sent to your wish by other attendees.
          </p>
        </div>
        <a
          href={
            '#manage-wish?id=' + wishId + (secret ? '&secret=' + encodeURIComponent(secret) : '')
          }
          className="compact-btn"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            background: '#f1f5f9',
            color: '#334155',
            border: '1px solid #cbd5e1',
            textDecoration: 'none',
          }}
        >
          Back to Wish
        </a>
      </div>

      <div style={{ display: 'grid', gap: '16px' }}>
        {mails.length === 0 ? (
          <div className="note-box">
            No messages yet! When someone sends a wishmail from your wish card, it will appear here.
          </div>
        ) : (
          mails.map((mail) => (
            <div
              key={mail.id}
              style={{
                padding: '20px',
                borderRadius: '16px',
                border: `1px solid ${mail.read ? '#e2e8f0' : '#bfdbfe'}`,
                background: mail.read ? '#f8fafc' : '#eff6ff',
                boxShadow: mail.read ? 'none' : '0 4px 12px rgba(37, 99, 235, 0.08)',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '16px',
                }}
              >
                <span style={{ fontSize: '0.85rem', color: '#64748b', fontWeight: 500 }}>
                  {new Date(mail.created_at).toLocaleString(undefined, {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })}
                </span>
                <div style={{ display: 'flex', gap: '8px' }}>
                  {!mail.read && (
                    <button
                      type="button"
                      onClick={() => markRead(mail.id)}
                      style={{
                        padding: '6px 12px',
                        fontSize: '0.85rem',
                        minHeight: 'auto',
                        borderRadius: '99px',
                      }}
                    >
                      Mark as Read
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => deleteMail(mail.id)}
                    className="secondary-button"
                    style={{
                      padding: '6px 12px',
                      fontSize: '0.85rem',
                      minHeight: 'auto',
                      borderRadius: '99px',
                      background: '#fee2e2',
                      color: '#b91c1c',
                      border: '1px solid #fecaca',
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>
              <p
                style={{
                  whiteSpace: 'pre-wrap',
                  margin: '0 0 20px 0',
                  fontSize: '1.05rem',
                  color: '#1e293b',
                  lineHeight: 1.6,
                }}
              >
                {mail.content}
              </p>

              {mail.return_contacts && mail.return_contacts.length > 0 && (
                <div
                  style={{
                    background: 'white',
                    padding: '16px',
                    borderRadius: '12px',
                    border: '1px solid #e2e8f0',
                  }}
                >
                  <span
                    style={{
                      fontSize: '0.85rem',
                      fontWeight: 600,
                      color: '#64748b',
                      display: 'block',
                      marginBottom: '12px',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                    }}
                  >
                    Return Contacts
                  </span>
                  <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                    {mail.return_contacts.map((c) => (
                      <span
                        key={`${c.type}-${c.value}`}
                        style={{
                          background: '#f8fafc',
                          padding: '6px 12px',
                          borderRadius: '6px',
                          border: '1px solid #cbd5e1',
                          fontSize: '0.95rem',
                          color: '#334155',
                        }}
                      >
                        <strong style={{ color: '#0f172a' }}>{c.type}:</strong> {c.value}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </section>
  );
}
