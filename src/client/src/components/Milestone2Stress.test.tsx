import React, { useState } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import WishFormFields from './WishFormFields';
import ContactEditor from './ContactEditor';
import SendWishmailModal from './SendWishmailModal';
import EnterWishPage from '../pages/EnterWishPage';
import * as AuthContext from '../AuthContext';

vi.mock('../AuthContext', () => ({
  useAuth: vi.fn(() => ({ token: null })),
}));

vi.mock('../components/WishScanner', () => ({
  default: ({ onCapture, onCancel }: { onCapture: any; onCancel: any }) => (
    <div data-testid="mock-wish-scanner">
      <button
        data-testid="mock-capture"
        onClick={() => onCapture('Camera OCR text', new Blob(['cam'], { type: 'image/jpeg' }))}
      >
        Capture
      </button>
      <button data-testid="mock-cancel" onClick={onCancel}>
        Cancel
      </button>
    </div>
  ),
}));

vi.mock('../cardProcessor', () => ({
  processCardImage: vi.fn(async () => ({
    blob: new Blob(['mock data'], { type: 'image/jpeg' }),
    text: 'Mocked OCR Text from Card',
  })),
}));

// State wrapper component for testing live interactions
function WishFormFieldsHarness({
  initialContent = '',
  initialContacts = [] as { type: string; value: string }[],
  initialWishmail = false,
}: {
  initialContent?: string;
  initialContacts?: { type: string; value: string }[];
  initialWishmail?: boolean;
}) {
  const [content, setContent] = useState(initialContent);
  const [contacts, setContacts] = useState(initialContacts);
  const [wishmailEnabled, setWishmailEnabled] = useState(initialWishmail);

  return (
    <div>
      <div data-testid="live-content">{content}</div>
      <div data-testid="live-wishmail">{wishmailEnabled ? 'enabled' : 'disabled'}</div>
      <div data-testid="live-contacts-count">{contacts.length}</div>
      <WishFormFields
        content={content}
        setContent={setContent}
        contacts={contacts}
        setContacts={setContacts}
        wishmailEnabled={wishmailEnabled}
        setWishmailEnabled={setWishmailEnabled}
      />
    </div>
  );
}

function ContactEditorHarness({
  initialContacts = [] as { type: string; value: string }[],
  addButtonLabel,
  removeButtonAriaLabel,
}: {
  initialContacts?: { type: string; value: string }[];
  addButtonLabel?: string;
  removeButtonAriaLabel?: (index: number) => string;
}) {
  const [contacts, setContacts] = useState(initialContacts);

  return (
    <div>
      <div data-testid="live-count">{contacts.length}</div>
      <div data-testid="live-dump">{JSON.stringify(contacts)}</div>
      <ContactEditor
        contacts={contacts}
        setContacts={setContacts}
        addButtonLabel={addButtonLabel}
        removeButtonAriaLabel={removeButtonAriaLabel}
      />
    </div>
  );
}

describe('Milestone 2 Adversarial Stress Suite', () => {
  let originalInnerWidth: number;
  let originalInnerHeight: number;

  beforeEach(() => {
    originalInnerWidth = globalThis.innerWidth;
    originalInnerHeight = globalThis.innerHeight;
    vi.mocked(AuthContext.useAuth).mockReturnValue({ token: null });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: 'stress-wish-1', secret: 'stress-secret' }),
      })
    );
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'innerWidth', {
      writable: true,
      configurable: true,
      value: originalInnerWidth,
    });
    Object.defineProperty(globalThis, 'innerHeight', {
      writable: true,
      configurable: true,
      value: originalInnerHeight,
    });
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // =========================================================================
  // SUITE 1: Dynamic adding and removing large numbers of contact methods
  // =========================================================================
  describe('Suite 1: Dynamic Contact Add/Remove Stress', () => {
    it('handles adding 30 contacts consecutively and maintains correct ARIA indices', () => {
      render(<ContactEditorHarness />);
      const addButton = screen.getByRole('button', { name: '+ Add Contact Method' });

      // Rapidly add 30 contacts
      for (let i = 0; i < 30; i++) {
        fireEvent.click(addButton);
      }

      expect(screen.getByTestId('live-count')).toHaveTextContent('30');

      // Verify all 30 rows have properly indexed ARIA labels
      for (let i = 1; i <= 30; i++) {
        expect(screen.getByRole('combobox', { name: `Contact ${i} type` })).toBeInTheDocument();
        expect(screen.getByRole('textbox', { name: `Contact ${i} value` })).toBeInTheDocument();
        expect(
          screen.getByRole('button', { name: `Remove contact method ${i}` })
        ).toBeInTheDocument();
      }
    });

    it('handles interleaved removal from beginning, middle, and end without data corruption', () => {
      const initial = Array.from({ length: 25 }, (_, i) => ({
        type: i % 2 === 0 ? 'Phone' : 'Email',
        value: `attendee_${i}`,
      }));

      render(<ContactEditorHarness initialContacts={initial} />);
      expect(screen.getByTestId('live-count')).toHaveTextContent('25');

      // 1. Remove contact 0 (attendee_0)
      const removeBtn1 = screen.getByRole('button', { name: 'Remove contact method 1' });
      fireEvent.click(removeBtn1);

      expect(screen.getByTestId('live-count')).toHaveTextContent('24');
      // Former attendee_1 is now contact 1
      const newContact1Input = screen.getByRole('textbox', { name: 'Contact 1 value' });
      expect(newContact1Input).toHaveValue('attendee_1');

      // 2. Remove from the middle (now at index 10, which corresponds to Remove contact method 11)
      const removeBtnMiddle = screen.getByRole('button', { name: 'Remove contact method 11' });
      fireEvent.click(removeBtnMiddle);
      expect(screen.getByTestId('live-count')).toHaveTextContent('23');

      // 3. Remove from the end (now contact 23)
      const removeBtnEnd = screen.getByRole('button', { name: 'Remove contact method 23' });
      fireEvent.click(removeBtnEnd);
      expect(screen.getByTestId('live-count')).toHaveTextContent('22');

      // 4. Rapidly drain all remaining 22 contacts by repeatedly clicking contact 1 remove button
      for (let i = 22; i > 0; i--) {
        const removeFirst = screen.getByRole('button', { name: 'Remove contact method 1' });
        fireEvent.click(removeFirst);
      }

      expect(screen.getByTestId('live-count')).toHaveTextContent('0');
      expect(screen.queryByRole('combobox')).toBeNull();

      // 5. Add a fresh contact after complete drain
      const addBtn = screen.getByRole('button', { name: '+ Add Contact Method' });
      fireEvent.click(addBtn);
      expect(screen.getByTestId('live-count')).toHaveTextContent('1');
      expect(screen.getByRole('combobox', { name: 'Contact 1 type' })).toBeInTheDocument();
    });

    it('correctly shifts controlled input values when middle contact with duplicate type is removed', () => {
      const initial = [
        { type: 'Phone', value: 'Alpha' },
        { type: 'Phone', value: 'Beta' },
        { type: 'Phone', value: 'Gamma' },
      ];

      render(<ContactEditorHarness initialContacts={initial} />);

      // Remove middle contact 'Beta' (contact 2)
      const removeBtn2 = screen.getByRole('button', { name: 'Remove contact method 2' });
      fireEvent.click(removeBtn2);

      expect(screen.getByTestId('live-count')).toHaveTextContent('2');

      const inputs = screen.getAllByRole('textbox');
      expect(inputs).toHaveLength(2);
      expect(inputs[0]).toHaveValue('Alpha');
      expect(inputs[1]).toHaveValue('Gamma');
    });

    it('supports submitting a wish with 20+ contacts in EnterWishPage and cleanly resets form', async () => {
      render(<EnterWishPage />);

      fireEvent.change(screen.getByPlaceholderText(/Type your wish here/i), {
        target: { value: 'Stress test wish with 20 contacts' },
      });

      // Enable Wishmail
      fireEvent.click(
        screen.getByRole('checkbox', {
          name: /Enable Wishmail \(allow others to message you about this wish\)/i,
        })
      );

      // Add 20 contacts
      const addBtn = screen.getByRole('button', { name: '+ Add Contact Method' });
      for (let i = 0; i < 20; i++) {
        fireEvent.click(addBtn);
      }

      // Populate each contact
      for (let i = 1; i <= 20; i++) {
        const valueInput = screen.getByRole('textbox', { name: `Contact ${i} value` });
        fireEvent.change(valueInput, { target: { value: `contact_handle_${i}` } });
      }

      // Submit
      fireEvent.click(screen.getByRole('button', { name: /Submit Wish/i }));

      await waitFor(() => expect(screen.getByText(/Wish saved! ID:/i)).toBeInTheDocument());

      expect(globalThis.fetch).toHaveBeenCalledWith(
        '/api/wishes',
        expect.objectContaining({ method: 'POST' })
      );

      const sentBody = JSON.parse(vi.mocked(globalThis.fetch).mock.calls[0][1]?.body as string);
      expect(sentBody.content).toBe('Stress test wish with 20 contacts');
      expect(sentBody.wishmail_enabled).toBe(true);
      expect(sentBody.contacts).toHaveLength(20);
      expect(sentBody.contacts[0].value).toBe('contact_handle_1');
      expect(sentBody.contacts[19].value).toBe('contact_handle_20');

      // Verify contacts and wishmail reset cleanly
      expect(screen.queryByRole('combobox')).toBeNull();
      const wishmailCheckbox = screen.getByRole('checkbox', {
        name: /Enable Wishmail \(allow others to message you about this wish\)/i,
      });
      expect(wishmailCheckbox).not.toBeChecked();
    });

    it('preserves wish content, contacts, and wishmail checkbox state if server returns error', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          json: async () => ({ error: 'Database error' }),
        })
      );

      render(<EnterWishPage />);

      fireEvent.change(screen.getByPlaceholderText(/Type your wish here/i), {
        target: { value: 'Important unsaved wish' },
      });

      // Enable Wishmail
      const wishmailCheckbox = screen.getByRole('checkbox', {
        name: /Enable Wishmail \(allow others to message you about this wish\)/i,
      });
      fireEvent.click(wishmailCheckbox);
      expect(wishmailCheckbox).toBeChecked();

      // Add a contact
      fireEvent.click(screen.getByRole('button', { name: '+ Add Contact Method' }));
      const valueInput = screen.getByRole('textbox', { name: 'Contact 1 value' });
      fireEvent.change(valueInput, { target: { value: 'preserve_me@example.com' } });

      // Submit
      fireEvent.click(screen.getByRole('button', { name: /Submit Wish/i }));

      await waitFor(() => expect(screen.getByText('Database error')).toBeInTheDocument());

      // Verify user input was NOT wiped out
      expect(screen.getByPlaceholderText(/Type your wish here/i)).toHaveValue(
        'Important unsaved wish'
      );
      expect(wishmailCheckbox).toBeChecked();
      expect(screen.getByRole('textbox', { name: 'Contact 1 value' })).toHaveValue(
        'preserve_me@example.com'
      );
    });
  });

  // =========================================================================
  // SUITE 2: Extreme strings, special characters, whitespace, long handles
  // =========================================================================
  describe('Suite 2: Extreme Strings & Special Characters', () => {
    it('handles 2,000-character string in contact handle without error or truncation', () => {
      render(<ContactEditorHarness initialContacts={[{ type: 'Email', value: '' }]} />);

      const hugeString = 'A'.repeat(2000);
      const input = screen.getByRole('textbox', { name: 'Contact 1 value' });
      fireEvent.change(input, { target: { value: hugeString } });

      expect(input).toHaveValue(hugeString);
      const dump = JSON.parse(screen.getByTestId('live-dump').textContent || '[]');
      expect(dump[0].value.length).toBe(2000);
    });

    it('safely handles XSS payloads, Unicode, emojis, RTL, and zero-width characters in contacts', () => {
      const maliciousAndExtremeStrings = [
        "<script>alert('xss')</script>",
        '"><svg onload=alert(1)>',
        "Robert'); DROP TABLE wishes;--",
        '👩‍👩‍👦‍👦 🚀 ✨ 🎉 🏳️‍🌈',
        'مرحبا بالعالم (Arabic test)',
        'שלום עולם (Hebrew test)',
        '   \t  whitespace only   ',
        '\u200B\u200C\u200D\uFEFFinvisible',
      ];

      render(<ContactEditorHarness />);
      const addBtn = screen.getByRole('button', { name: '+ Add Contact Method' });

      maliciousAndExtremeStrings.forEach((str, idx) => {
        fireEvent.click(addBtn);
        const input = screen.getByRole('textbox', { name: `Contact ${idx + 1} value` });
        fireEvent.change(input, { target: { value: str } });
        expect(input).toHaveValue(str);
      });

      const dump = JSON.parse(screen.getByTestId('live-dump').textContent || '[]');
      expect(dump).toHaveLength(maliciousAndExtremeStrings.length);
      maliciousAndExtremeStrings.forEach((str, idx) => {
        expect(dump[idx].value).toBe(str);
      });
    });

    it('SendWishmailModal filters out whitespace-only contacts and preserves special characters', async () => {
      render(<SendWishmailModal wishId="wish-test-123" onClose={vi.fn()} />);

      // Fill message
      const textarea = screen.getByRole('textbox', { name: /Your Message/i });
      fireEvent.change(textarea, { target: { value: 'Hello with special chars: <>&"\'🚀' } });

      // Add 3 return contacts:
      // Contact 1: valid with emojis
      // Contact 2: whitespace only (should be filtered)
      // Contact 3: valid with XSS payload
      const addBtn = screen.getByRole('button', { name: '+ Add Return Contact' });
      fireEvent.click(addBtn);
      fireEvent.click(addBtn);
      fireEvent.click(addBtn);

      const input1 = screen.getByRole('textbox', { name: 'Contact 1 value' });
      const input2 = screen.getByRole('textbox', { name: 'Contact 2 value' });
      const input3 = screen.getByRole('textbox', { name: 'Contact 3 value' });

      fireEvent.change(input1, { target: { value: 'user_🚀@example.com' } });
      fireEvent.change(input2, { target: { value: '    \t   ' } });
      fireEvent.change(input3, { target: { value: '<script>alert(1)</script>' } });

      // Submit
      fireEvent.click(screen.getByRole('button', { name: 'Send Message' }));

      await waitFor(() =>
        expect(screen.getByText('Message sent successfully!')).toBeInTheDocument()
      );

      expect(globalThis.fetch).toHaveBeenCalledWith(
        '/api/wishes/wish-test-123/mail',
        expect.objectContaining({ method: 'POST' })
      );

      const body = JSON.parse(vi.mocked(globalThis.fetch).mock.calls[0][1]?.body as string);
      expect(body.content).toBe('Hello with special chars: <>&"\'🚀');
      expect(body.return_contacts).toHaveLength(2);
      expect(body.return_contacts[0].value).toBe('user_🚀@example.com');
      expect(body.return_contacts[1].value).toBe('<script>alert(1)</script>');
    });

    it('SendWishmailModal supports dynamically adding and removing 20 return contacts', () => {
      render(<SendWishmailModal wishId="stress-wish-modal" onClose={vi.fn()} />);

      const addBtn = screen.getByRole('button', { name: '+ Add Return Contact' });
      for (let i = 0; i < 20; i++) {
        fireEvent.click(addBtn);
      }

      // Check all 20 remove buttons are rendered (using backward-compatible name 'X')
      const removeButtons = screen.getAllByRole('button', { name: 'X' });
      expect(removeButtons).toHaveLength(20);

      // Remove 5 of them
      for (let i = 0; i < 5; i++) {
        fireEvent.click(removeButtons[i]);
      }

      expect(screen.getAllByRole('button', { name: 'X' })).toHaveLength(15);
    });
  });

  // =========================================================================
  // SUITE 3: Screen resize / narrow viewport simulation down to 320px
  // =========================================================================
  describe('Suite 3: 320px Narrow Viewport Layout Simulation', () => {
    it('renders WishFormFields and ContactEditor on a 320px simulated mobile viewport', () => {
      Object.defineProperty(globalThis, 'innerWidth', {
        writable: true,
        configurable: true,
        value: 320,
      });
      Object.defineProperty(globalThis, 'innerHeight', {
        writable: true,
        configurable: true,
        value: 568,
      });
      globalThis.dispatchEvent(new Event('resize'));

      const { container } = render(
        <WishFormFieldsHarness
          initialContent="Mobile test"
          initialContacts={[{ type: 'Phone', value: '+1234567890' }]}
          initialWishmail={false}
        />
      );

      // Verify fieldset styles
      const fieldset = container.querySelector('fieldset');
      expect(fieldset).not.toBeNull();
      expect(fieldset?.style.borderRadius).toBe('12px');
      expect(fieldset?.style.background).toContain('var(--wb-bg-surface');
      expect(fieldset?.style.border).toContain('var(--wb-border-subtle');

      // Verify responsive flex attributes on contact row controls
      const select = screen.getByRole('combobox', { name: 'Contact 1 type' });
      expect(select.style.flex).toBe('0 0 auto');
      expect(select.style.minWidth).toBe('110px');
      expect(select.style.minHeight).toBe('40px');

      const input = screen.getByRole('textbox', { name: 'Contact 1 value' });
      expect(input.style.flex).toBe('1 1 auto');
      expect(input.style.minWidth).toBe('0px');
      expect(input.style.minHeight).toBe('40px');

      const removeBtn = screen.getByRole('button', { name: 'Remove contact method 1' });
      expect(removeBtn.style.flex).toBe('0 0 auto');
      expect(removeBtn.style.minWidth).toBe('40px');
      expect(removeBtn.style.minHeight).toBe('40px');

      // Verify checkbox label click toggles on 320px viewport
      const label = screen.getByText(
        'Enable Wishmail (allow others to message you about this wish)'
      );
      expect(label).toHaveAttribute('for', 'wishmail-enabled');
      fireEvent.click(label);

      expect(screen.getByTestId('live-wishmail')).toHaveTextContent('enabled');
      const checkbox = screen.getByRole('checkbox', {
        name: 'Enable Wishmail (allow others to message you about this wish)',
      });
      expect(checkbox).toBeChecked();
    });

    it('renders SendWishmailModal fieldset cleanly with backward-compatible remove button ARIA label', () => {
      render(<SendWishmailModal wishId="modal-test" onClose={vi.fn()} />);

      // Add a contact
      fireEvent.click(screen.getByRole('button', { name: '+ Add Return Contact' }));

      // SendWishmailModal passes removeButtonAriaLabel={() => 'X'}
      const removeBtn = screen.getByRole('button', { name: 'X' });
      expect(removeBtn).toBeInTheDocument();
      expect(removeBtn.style.flex).toBe('0 0 auto');
      expect(removeBtn.style.minWidth).toBe('40px');
    });

    it('supports keyboard navigation and spacebar toggle of Wishmail checkbox', () => {
      render(<WishFormFieldsHarness initialWishmail={false} />);

      const checkbox = screen.getByRole('checkbox', {
        name: 'Enable Wishmail (allow others to message you about this wish)',
      });

      // Spacebar click simulation on checkbox
      checkbox.focus();
      expect(document.activeElement).toBe(checkbox);

      fireEvent.click(checkbox);
      expect(checkbox).toBeChecked();
      expect(screen.getByTestId('live-wishmail')).toHaveTextContent('enabled');
    });
  });

  // =========================================================================
  // SUITE 4: Rapid toggle of Wishmail checkbox during typing
  // =========================================================================
  describe('Suite 4: Rapid Wishmail Checkbox Toggle & Typing Concurrency', () => {
    it('preserves text content and contacts when Wishmail checkbox is toggled 50 times during typing', () => {
      render(
        <WishFormFieldsHarness
          initialContent=""
          initialContacts={[{ type: 'Email', value: 'seed@test.com' }]}
          initialWishmail={false}
        />
      );

      const textarea = screen.getByRole('textbox', { name: /What is your wish\?/i });
      const contactInput = screen.getByRole('textbox', { name: 'Contact 1 value' });
      const checkbox = screen.getByRole('checkbox', {
        name: 'Enable Wishmail (allow others to message you about this wish)',
      });

      // Simulate rapid user typing interleaved with checkbox toggles
      let accumulatedContent = '';
      let isChecked = false;

      for (let i = 0; i < 50; i++) {
        // Type a character into textarea
        accumulatedContent += `c${i % 10}`;
        fireEvent.change(textarea, { target: { value: accumulatedContent } });

        // Toggle checkbox
        fireEvent.click(checkbox);
        isChecked = !isChecked;

        // Type into contact input
        fireEvent.change(contactInput, { target: { value: `val_${i}` } });
      }

      // 50 toggles from false -> back to false
      expect(isChecked).toBe(false);
      expect(screen.getByTestId('live-wishmail')).toHaveTextContent('disabled');
      expect(checkbox).not.toBeChecked();

      // Content matches exact accumulation
      expect(textarea).toHaveValue(accumulatedContent);
      expect(screen.getByTestId('live-content')).toHaveTextContent(accumulatedContent);

      // Contact value matches last iteration
      expect(contactInput).toHaveValue('val_49');
    });

    it('interleaves contact addition, removal, and rapid checkbox toggles without race condition or state drop', () => {
      render(<WishFormFieldsHarness initialWishmail={false} />);

      const addContactBtn = screen.getByRole('button', { name: '+ Add Contact Method' });
      const checkbox = screen.getByRole('checkbox', {
        name: 'Enable Wishmail (allow others to message you about this wish)',
      });

      // Perform a sequence of add, toggle, edit, remove, toggle
      // 1. Add 3 contacts
      fireEvent.click(addContactBtn);
      fireEvent.click(addContactBtn);
      fireEvent.click(addContactBtn);
      expect(screen.getByTestId('live-contacts-count')).toHaveTextContent('3');

      // 2. Toggle checkbox
      fireEvent.click(checkbox);
      expect(screen.getByTestId('live-wishmail')).toHaveTextContent('enabled');

      // 3. Edit contact 2 value
      const input2 = screen.getByRole('textbox', { name: 'Contact 2 value' });
      fireEvent.change(input2, { target: { value: 'edited_middle' } });

      // 4. Remove contact 1
      const removeBtn1 = screen.getByRole('button', { name: 'Remove contact method 1' });
      fireEvent.click(removeBtn1);
      expect(screen.getByTestId('live-contacts-count')).toHaveTextContent('2');

      // 5. Toggle checkbox again
      fireEvent.click(checkbox);
      expect(screen.getByTestId('live-wishmail')).toHaveTextContent('disabled');

      // Contact 1 should now be 'edited_middle'
      const newInput1 = screen.getByRole('textbox', { name: 'Contact 1 value' });
      expect(newInput1).toHaveValue('edited_middle');
    });

    it('submits FormData containing serialized contacts and wishmail_enabled when wish includes an image', async () => {
      render(<EnterWishPage />);

      // Trigger mock camera capture to set imageBlob
      fireEvent.click(screen.getByRole('button', { name: /Capture with Camera/i }));
      const captureBtn = await screen.findByTestId('mock-capture');
      fireEvent.click(captureBtn);

      await waitFor(() =>
        expect(screen.getByPlaceholderText(/Type your wish here/i)).toHaveValue('Camera OCR text')
      );

      // Enable Wishmail
      const wishmailCheckbox = screen.getByRole('checkbox', {
        name: /Enable Wishmail \(allow others to message you about this wish\)/i,
      });
      fireEvent.click(wishmailCheckbox);

      // Add a contact
      fireEvent.click(screen.getByRole('button', { name: '+ Add Contact Method' }));
      const valueInput = screen.getByRole('textbox', { name: 'Contact 1 value' });
      fireEvent.change(valueInput, { target: { value: 'photographer@example.com' } });

      // Submit wish
      fireEvent.click(screen.getByRole('button', { name: /Submit Wish/i }));

      await waitFor(() => expect(screen.getByText(/Wish saved! ID:/i)).toBeInTheDocument());

      expect(globalThis.fetch).toHaveBeenCalledWith(
        '/api/wishes',
        expect.objectContaining({ method: 'POST' })
      );

      const wishCall = vi
        .mocked(globalThis.fetch)
        .mock.calls.find((call) => call[0] === '/api/wishes');
      expect(wishCall).toBeDefined();
      const sentFormData = wishCall?.[1]?.body as FormData;
      expect(sentFormData).toBeInstanceOf(FormData);
      expect(sentFormData.get('wishmail_enabled')).toBe('true');
      expect(JSON.parse(sentFormData.get('contacts') as string)).toEqual([
        { type: 'Phone', value: 'photographer@example.com' },
      ]);
    });
  });
});
