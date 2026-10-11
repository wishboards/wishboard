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
}

export default function ContactEditor({
  contacts,
  setContacts,
  addButtonLabel = '+ Add Contact Method',
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
          style={{ display: 'flex', gap: '8px', marginBottom: '8px', alignItems: 'center' }}
        >
          <select
            value={contact.type}
            onChange={(e) => updateContact(index, 'type', e.target.value)}
            style={{
              padding: '8px',
              borderRadius: '8px',
              border: '1px solid #d7dee5',
              background: 'white',
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
            value={contact.value}
            onChange={(e) => updateContact(index, 'value', e.target.value)}
            placeholder="Username, number, etc."
            style={{ minHeight: '36px', padding: '8px' }}
          />
          <button
            type="button"
            onClick={() => removeContact(index)}
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
        onClick={addContact}
        className="secondary-button"
        style={{ minHeight: '36px', padding: '6px 12px', fontSize: '0.9rem' }}
      >
        {addButtonLabel}
      </button>
    </>
  );
}
