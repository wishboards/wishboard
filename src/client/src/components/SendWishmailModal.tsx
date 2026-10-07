import React, { useState } from 'react';
import { useAuth } from '../AuthContext';
import ContactEditor from './ContactEditor';

interface SendWishmailModalProps {
  wishId: string;
  onClose: () => void;
}

export default function SendWishmailModal({ wishId, onClose }: Readonly<SendWishmailModalProps>) {
  const { token } = useAuth();
  const [content, setContent] = useState('');
  const [contacts, setContacts] = useState<{ type: string; value: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const response = await fetch(`/api/wishes/${encodeURIComponent(wishId)}/mail`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        content,
        return_contacts: contacts.filter((c) => c.value.trim()),
      }),
    });

    if (response.ok) {
      setSuccess(true);
      setTimeout(onClose, 2000);
    } else {
      const data = await response.json();
      setError(data.error || 'Failed to send message.');
    }
  };

  return (
    <div className="kiosk-modal-backdrop" style={{ zIndex: 100000 }}>
      <div className="kiosk-modal" style={{ maxWidth: '500px' }}>
        <h2>Send Wishmail</h2>
        {success ? (
          <div className="message success">Message sent successfully!</div>
        ) : (
          <form onSubmit={handleSubmit}>
            {error && <div className="kiosk-modal-error">{error}</div>}

            <label>
              Your Message{' '}
              <textarea
                rows={4}
                required
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="What would you like to say to the wish creator?"
              />
            </label>

            <fieldset
              style={{
                border: '1px solid #d7dee5',
                borderRadius: '12px',
                padding: '16px',
                background: '#f8fafc',
                marginTop: '16px',
              }}
            >
              <legend style={{ fontWeight: 600, padding: '0 8px' }}>
                Return Contacts (Optional)
              </legend>
              <p className="microtext" style={{ marginTop: 0 }}>
                Provide a way for them to reply to you.
              </p>

              <ContactEditor
                contacts={contacts}
                setContacts={setContacts}
                addButtonLabel="+ Add Return Contact"
              />
            </fieldset>

            <div className="kiosk-modal-actions">
              <button type="button" className="secondary-button" onClick={onClose}>
                Cancel
              </button>
              <button type="submit">Send Message</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
