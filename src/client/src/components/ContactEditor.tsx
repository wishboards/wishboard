import React from 'react';
import { useEventProfile } from '../EventProfileContext';

interface Contact {
  type: string;
  value: string;
}

interface ContactEditorProps {
  contacts: Contact[];
  setContacts: (contacts: Contact[]) => void;
  addButtonLabel?: string;
  removeButtonAriaLabel?: (index: number) => string;
}

export default function ContactEditor({
  contacts,
  setContacts,
  addButtonLabel = '+ Add Contact Method',
  removeButtonAriaLabel,
}: Readonly<ContactEditorProps>) {
  const { contact_methods = ['Phone', 'Email'] } = useEventProfile();
  const defaultMethod = contact_methods[0] || 'Phone';

  const addContact = () => setContacts([...contacts, { type: defaultMethod, value: '' }]);

  const updateContact = (index: number, field: 'type' | 'value', val: string) => {
    const newContacts = [...contacts];
    newContacts[index] = { ...newContacts[index], [field]: val };
    setContacts(newContacts);
  };

  const removeContact = (index: number) => {
    setContacts(contacts.filter((_, i) => i !== index));
  };

  return (
    <>
      {contacts.map((contact, index) => (
        <div
          // eslint-disable-next-line @eslint-react/no-array-index-key
          key={`${contact.type}-${index}`}
          style={{
            display: 'flex',
            gap: '8px',
            marginBottom: '8px',
            alignItems: 'center',
            width: '100%',
          }}
        >
          <select
            aria-label={`Contact ${index + 1} type`}
            value={contact.type}
            onChange={(e) => updateContact(index, 'type', e.target.value)}
            style={{
              flex: '0 0 auto',
              width: 'auto',
              minWidth: '110px',
              minHeight: '40px',
              padding: '8px',
              borderRadius: '8px',
              border: '1px solid var(--wb-border-subtle, #d7dee5)',
              background: 'var(--wb-bg-surface-elevated, #334155)',
              color: 'var(--wb-text-primary, inherit)',
            }}
          >
            {contact_methods.map((method) => (
              <option key={method} value={method}>
                {method}
              </option>
            ))}
          </select>
          <input
            type="text"
            aria-label={`Contact ${index + 1} value`}
            value={contact.value}
            onChange={(e) => updateContact(index, 'value', e.target.value)}
            placeholder="Username, number, etc."
            style={{
              flex: '1 1 auto',
              minWidth: 0,
              minHeight: '40px',
              padding: '8px',
            }}
          />
          <button
            type="button"
            aria-label={
              removeButtonAriaLabel
                ? removeButtonAriaLabel(index)
                : `Remove contact method ${index + 1}`
            }
            onClick={() => removeContact(index)}
            style={{
              flex: '0 0 auto',
              minWidth: '40px',
              minHeight: '40px',
              padding: '0 12px',
              background: 'var(--wb-danger, #ef4444)',
              color: '#ffffff',
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
        onClick={addContact}
        className="secondary-button"
        style={{ minHeight: '36px', padding: '6px 12px', fontSize: '0.9rem' }}
      >
        {addButtonLabel}
      </button>
    </>
  );
}
