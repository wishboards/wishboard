import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import WishFormFields from './WishFormFields';
import React from 'react';

describe('WishFormFields', () => {
  it('renders content textarea and calls setContent', () => {
    const setContent = vi.fn();
    render(
      <WishFormFields
        content="my wish"
        setContent={setContent}
        contacts={[]}
        setContacts={vi.fn()}
        wishmailEnabled={false}
        setWishmailEnabled={vi.fn()}
        isOverflowing={false}
      />
    );
    const textarea = screen.getByRole('textbox', { name: /What is your wish\?/i });
    expect(textarea).toHaveValue('my wish');
    expect(textarea).toHaveAttribute('rows', '6');
    expect(textarea).toHaveAttribute('placeholder', 'Type your wish here');
    expect(textarea).not.toHaveClass('overflowing-textarea');
    expect(screen.queryByText('Text Overflowing')).not.toBeInTheDocument();

    // Check fieldset renders
    expect(screen.getByText('Contacts & Wishmail')).toBeInTheDocument();

    fireEvent.change(textarea, { target: { value: 'new wish' } });
    expect(setContent).toHaveBeenCalledWith('new wish');
  });

  it('renders overflow hint and styling when isOverflowing is true', () => {
    render(
      <WishFormFields
        content="my wish"
        setContent={vi.fn()}
        contacts={[]}
        setContacts={vi.fn()}
        wishmailEnabled={false}
        setWishmailEnabled={vi.fn()}
        isOverflowing={true}
      />
    );
    expect(screen.getByText('Text Overflowing')).toBeInTheDocument();

    const textarea = screen.getByRole('textbox', { name: /What is your wish\?/i });
    expect(textarea).toHaveClass('overflowing-textarea');
  });

  it('renders Contacts & Wishmail fieldset with semantic tokens and accessible Wishmail checkbox', () => {
    const setWishmailEnabled = vi.fn();
    const { container } = render(
      <WishFormFields
        content=""
        setContent={vi.fn()}
        contacts={[]}
        setContacts={vi.fn()}
        wishmailEnabled={false}
        setWishmailEnabled={setWishmailEnabled}
      />
    );

    // Verify fieldset adopts semantic design tokens
    const fieldset = container.querySelector('fieldset');
    expect(fieldset).not.toBeNull();
    expect(fieldset?.style.background).toContain('var(--wb-bg-surface');
    expect(fieldset?.style.border).toContain('var(--wb-border-subtle');

    // Verify legend text and styling
    const legend = screen.getByText('Contacts & Wishmail');
    expect(legend).toBeInTheDocument();
    expect(legend.style.color).toContain('var(--wb-text-primary');

    // Verify explicit label and checkbox association
    const checkbox = screen.getByRole('checkbox', {
      name: 'Enable Wishmail (allow others to message you about this wish)',
    });
    expect(checkbox).not.toBeChecked();
    expect(checkbox).toHaveAttribute('id', 'wishmail-enabled');

    const label = screen.getByText('Enable Wishmail (allow others to message you about this wish)');
    expect(label).toHaveAttribute('for', 'wishmail-enabled');

    // Toggle via label click
    fireEvent.click(label);
    expect(setWishmailEnabled).toHaveBeenCalledWith(true);

    // Toggle via checkbox click directly
    fireEvent.click(checkbox);
    expect(setWishmailEnabled).toHaveBeenCalledWith(true);
  });

  it('adds, updates, and removes contacts with responsive styling and accessibility attributes', () => {
    const setContacts = vi.fn();
    const contacts = [{ type: 'Phone', value: 'user1' }];

    render(
      <WishFormFields
        content=""
        setContent={vi.fn()}
        contacts={contacts}
        setContacts={setContacts}
        wishmailEnabled={false}
        setWishmailEnabled={vi.fn()}
      />
    );

    // Add contact
    const addButton = screen.getByRole('button', { name: '+ Add Contact Method' });
    fireEvent.click(addButton);
    expect(setContacts).toHaveBeenCalledWith([...contacts, { type: 'Phone', value: '' }]);

    // Update contact type using accessible combobox name
    const typeSelect = screen.getByRole('combobox', { name: 'Contact 1 type' });
    expect(typeSelect).toHaveValue('Phone');
    fireEvent.change(typeSelect, { target: { value: 'Email' } });
    expect(setContacts).toHaveBeenCalledWith([{ type: 'Email', value: 'user1' }]);

    // Update contact value using accessible input name
    const valueInput = screen.getByRole('textbox', { name: 'Contact 1 value' });
    expect(valueInput).toHaveValue('user1');
    fireEvent.change(valueInput, { target: { value: 'newval' } });
    expect(setContacts).toHaveBeenCalledWith([{ type: 'Phone', value: 'newval' }]);

    // Remove contact using accessible remove button name
    const removeButton = screen.getByRole('button', { name: 'Remove contact method 1' });
    expect(removeButton).toBeInTheDocument();
    fireEvent.click(removeButton);
    expect(setContacts).toHaveBeenCalledWith([]);
  });
});
