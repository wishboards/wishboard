import React from 'react';
import InfoToggle from './InfoToggle';
import ContactEditor from './ContactEditor';

interface Contact {
  type: string;
  value: string;
}

interface WishFormFieldsProps {
  content: string;
  setContent: (content: string) => void;
  contacts: Contact[];
  setContacts: (contacts: Contact[]) => void;
  wishmailEnabled: boolean;
  setWishmailEnabled: (enabled: boolean) => void;
  isOverflowing?: boolean;
}

export default function WishFormFields({
  content,
  setContent,
  contacts,
  setContacts,
  wishmailEnabled,
  setWishmailEnabled,
  isOverflowing,
}: Readonly<WishFormFieldsProps>) {
  return (
    <>
      <label>
        What is your wish?{' '}
        <textarea
          rows={6}
          value={content}
          onChange={(event) => setContent(event.target.value)}
          placeholder="Type your wish here"
          className={isOverflowing ? 'overflowing-textarea' : ''}
        />
      </label>

      {isOverflowing && (
        <div className="label-with-info" style={{ marginTop: '-4px', marginBottom: '8px' }}>
          <strong style={{ color: '#b91717', fontSize: '0.9rem', margin: 0 }}>
            Text Overflowing
          </strong>
          <InfoToggle>
            Your wish is getting quite long! The text won't fit beautifully on the physical display
            board at this size. Consider making it more concise.
          </InfoToggle>
        </div>
      )}

      <fieldset
        style={{
          border: '1px solid var(--wb-border-subtle, rgba(255, 255, 255, 0.12))',
          borderRadius: '12px',
          padding: '16px',
          background: 'var(--wb-bg-surface, rgba(30, 41, 59, 0.78))',
          color: 'var(--wb-text-primary, #f8fafc)',
          marginTop: '4px',
        }}
      >
        <legend
          style={{
            fontWeight: 600,
            padding: '0 8px',
            color: 'var(--wb-text-primary, #f8fafc)',
          }}
        >
          Contacts & Wishmail
        </legend>
        <div style={{ display: 'grid', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <input
              id="wishmail-enabled"
              type="checkbox"
              checked={wishmailEnabled}
              onChange={(e) => setWishmailEnabled(e.target.checked)}
            />
            <label
              htmlFor="wishmail-enabled"
              style={{
                fontWeight: 'normal',
                cursor: 'pointer',
                color: 'var(--wb-text-primary, #f8fafc)',
                margin: 0,
                display: 'inline',
              }}
            >
              Enable Wishmail (allow others to message you about this wish)
            </label>
          </div>

          <div>
            <p
              style={{
                margin: '8px 0',
                fontWeight: 600,
                fontSize: '0.9rem',
                color: 'var(--wb-text-primary, #f8fafc)',
              }}
            >
              Contact Methods
            </p>
            <ContactEditor contacts={contacts} setContacts={setContacts} />
          </div>
        </div>
      </fieldset>
    </>
  );
}
