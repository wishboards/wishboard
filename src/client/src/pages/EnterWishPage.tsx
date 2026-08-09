import React, { useState, useEffect } from 'react';
import { useAuth } from '../AuthContext';
import { useEventProfile } from '../EventProfileContext';
import { QRCodeSVG } from 'qrcode.react';
import InfoToggle from '../components/InfoToggle';
import AttributeInput from '../components/AttributeInput';
import { parseAttributesString, fetchConflicts, getConflictWarning } from '../utils/conflicts';
import WishPreview from '../components/WishPreview';
import WishFormFields from '../components/WishFormFields';
import PassphraseInput from '../components/PassphraseInput';
const WishScanner = React.lazy(() => import('../components/WishScanner'));
// cardProcessor pulls in the ~15.6 MB @techstark/opencv-js blob. Import it
// dynamically at the point of use (card upload / scan) so it is not fetched
// on page load — mirrors the React.lazy(WishScanner) above. See issue #140.

type TempImageElement = HTMLImageElement & { _tempUrl?: string };

function loadImage(file: File): Promise<TempImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img: TempImageElement = new Image();
    img.src = url;
    img.onload = () => {
      img._tempUrl = url;
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image file.'));
    };
  });
}

export default function EnterWishPage() {
  const { token, user } = useAuth();
  const [content, setContent] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const { categories = [] } = useEventProfile();
  const [creatorAttributes, setCreatorAttributes] = useState<Record<string, string>>({});
  const [desiredAttributes, setDesiredAttributes] = useState<Record<string, string>>({});

  const [contacts, setContacts] = useState<{ type: string; value: string }[]>([]);
  const [wishmailEnabled, setWishmailEnabled] = useState(false);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [imageBlob, setImageBlob] = useState<Blob | null>(null);
  const [showScanner, setShowScanner] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStatus, setProcessingStatus] = useState('');

  useEffect(() => {
    if (user) {
      setContacts(user.contacts || []);
      setWishmailEnabled(user.wishmail_enabled || false);
    }
  }, [user]);

  const [result, setResult] = useState<{ id: string; secret?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creatorConflicts, setCreatorConflicts] = useState<
    Array<{ message: string; target_attribute: string }>
  >([]);
  const [desiredConflicts, setDesiredConflicts] = useState<
    Array<{ message: string; target_attribute: string }>
  >([]);

  // Debounced conflict checks for creator attributes
  useEffect(() => {
    if (user) return;
    const timer = globalThis.setTimeout(async () => {
      const parsed: Record<string, string[]> = {};
      categories.forEach(
        (cat) => (parsed[cat.id] = parseAttributesString(creatorAttributes[cat.id] || ''))
      );
      const conflicts = await fetchConflicts(parsed);
      setCreatorConflicts(conflicts);
    }, 300);
    return () => clearTimeout(timer);
  }, [creatorAttributes, user, categories]);

  // Debounced conflict checks for desired attributes
  useEffect(() => {
    const timer = globalThis.setTimeout(async () => {
      const parsed: Record<string, string[]> = {};
      categories.forEach(
        (cat) => (parsed[cat.id] = parseAttributesString(desiredAttributes[cat.id] || ''))
      );
      const conflicts = await fetchConflicts(parsed);
      setDesiredConflicts(conflicts);
    }, 300);
    return () => clearTimeout(timer);
  }, [desiredAttributes, categories]);

  const hasConflicts = creatorConflicts.length > 0 || desiredConflicts.length > 0;

  const submitWish = async (event: React.SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setResult(null);

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    let body: BodyInit;
    if (imageBlob) {
      delete headers['Content-Type'];
      const formData = new FormData();
      formData.append('content', content);
      if (passphrase) formData.append('passphrase', passphrase);
      formData.append('creator_attributes', JSON.stringify(creatorAttributes));
      formData.append('desired_attributes', JSON.stringify(desiredAttributes));
      formData.append('contacts', JSON.stringify(contacts));
      formData.append('wishmail_enabled', wishmailEnabled ? 'true' : '');
      formData.append('image', imageBlob, 'wish.jpg');
      body = formData;
    } else {
      body = JSON.stringify({
        content,
        passphrase: passphrase || undefined,
        creator_attributes: creatorAttributes,
        desired_attributes: desiredAttributes,
        contacts,
        wishmail_enabled: wishmailEnabled,
      });
    }

    let response: Response;
    try {
      response = await fetch('/api/wishes', {
        method: 'POST',
        headers,
        body,
      });
    } catch {
      // Network/connection failure — the form is untouched so they can retry.
      setError('Could not reach the server. Your wish is still here — please try again.');
      return;
    }

    let data: { id?: string; secret?: string; error?: string } = {};
    try {
      data = await response.json();
    } catch {
      // Non-JSON error body (e.g. a raw 5xx); fall through to the generic
      // message below. The form is preserved, so the user can retry by hand.
    }

    if (!response.ok) {
      setError(data.error || 'Could not submit your wish. Please try again in a moment.');
      return;
    }

    setResult({ id: data.id ?? '', secret: data.secret });
    setContent('');
    setPassphrase('');
    setCreatorAttributes({});
    setDesiredAttributes({});
    setContacts([]);
    setWishmailEnabled(false);
    setIsOverflowing(false);
    setImageBlob(null);
  };

  const parsedCreatorAttributes: Record<string, string[]> = {};
  categories.forEach((cat) => {
    if (creatorAttributes[cat.id]) {
      parsedCreatorAttributes[cat.id] = creatorAttributes[cat.id]
        .split(',')
        .map((s: string) => s.trim());
    }
  });

  const previewWish = {
    id: 'preview',
    content: content || 'Your wish text will appear here',
    creator_attributes: user ? user.attributes : parsedCreatorAttributes,
    contacts: contacts.filter((c) => c.value.trim()),
    wishmail_enabled: wishmailEnabled,
    image_url: imageBlob ? URL.createObjectURL(imageBlob) : undefined,
  };

  const renderUploadSection = () => {
    if (isProcessing) {
      return (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '12px',
          }}
        >
          <div
            className="spinner"
            style={{
              borderTopColor: '#166534',
              borderColor: 'rgba(22, 101, 52, 0.2)',
              marginBottom: '12px',
            }}
          ></div>
          <p style={{ margin: 0, color: '#166534', fontWeight: 'bold' }}>{processingStatus}</p>
        </div>
      );
    }

    if (imageBlob) {
      return (
        <div>
          <p style={{ color: '#166534', fontWeight: 'bold' }}>✓ Handwritten wish attached</p>
          <button type="button" className="secondary-button" onClick={() => setImageBlob(null)}>
            Remove Image
          </button>
        </div>
      );
    }

    return (
      <div>
        <p style={{ margin: '0 0 12px 0' }}>Have a physical 3x5 wish card?</p>
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', flexWrap: 'wrap' }}>
          <button type="button" onClick={() => setShowScanner(true)}>
            Capture with Camera
          </button>
          <label
            className="secondary-button"
            style={{
              cursor: 'pointer',
              display: 'inline-block',
              margin: 0,
              padding: '12px 24px',
              borderRadius: '24px',
              fontWeight: 'bold',
            }}
          >
            Upload Image{' '}
            <input
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file?.type.startsWith('image/')) return;

                setIsProcessing(true);
                setProcessingStatus('Processing card image...');
                setError(null);

                let img: TempImageElement | null = null;
                try {
                  img = await loadImage(file);
                  const { processCardImage } = await import('../cardProcessor');
                  const { blob, text } = await processCardImage(img);
                  if (text) setContent(text);
                  setImageBlob(blob);
                } catch (err: unknown) {
                  console.error(err);
                  const msg =
                    err instanceof Error ? err.message : 'Error processing uploaded image.';
                  setError(msg);
                  setImageBlob(null);
                } finally {
                  if (img?._tempUrl) {
                    URL.revokeObjectURL(img._tempUrl);
                  }
                  setIsProcessing(false);
                }
              }}
            />
          </label>
        </div>
      </div>
    );
  };

  return (
    <section>
      <h1>Enter a Wish</h1>

      <div className="wish-editor-layout">
        <form className="form-card" onSubmit={submitWish}>
          <WishFormFields
            content={content}
            setContent={setContent}
            contacts={contacts}
            setContacts={setContacts}
            wishmailEnabled={wishmailEnabled}
            setWishmailEnabled={setWishmailEnabled}
            isOverflowing={isOverflowing}
          />

          <div
            style={{
              margin: '16px 0',
              padding: '16px',
              background: '#f0fdf4',
              borderRadius: '8px',
              border: '1px solid #bbf7d0',
              textAlign: 'center',
            }}
          >
            {renderUploadSection()}
          </div>

          {token ? (
            <div className="note-box">
              <div className="label-with-info">
                <p style={{ margin: 0 }}>
                  Your account identity attributes are applied automatically to this wish.
                </p>
                <InfoToggle>
                  Any genders, orientations, or roles you set on your Account page are implicitly
                  used to match you with compatible fulfillers.
                </InfoToggle>
              </div>
            </div>
          ) : (
            <>
              <div style={{ display: 'grid', gap: '8px' }}>
                <div className="label-with-info">
                  <label htmlFor="passphrase">Optional passphrase</label>
                  <InfoToggle>
                    This allows you to edit or delete your wish later. Leave it blank and we'll
                    automatically generate a secure, memorable code phrase for you!
                  </InfoToggle>
                </div>
                <PassphraseInput
                  id="passphrase"
                  value={passphrase}
                  onChange={setPassphrase}
                  placeholder="Leave blank for automatic code phrase"
                />
              </div>
              {categories.map((cat) => {
                const suggs = cat.suggestions || [];
                return (
                  <label key={cat.id}>
                    Creator {cat.label}s (anonymous only)
                    <AttributeInput
                      category={cat.id}
                      value={creatorAttributes[cat.id] || ''}
                      onChange={(val) =>
                        setCreatorAttributes((prev) => ({ ...prev, [cat.id]: val }))
                      }
                      placeholder={suggs.length > 0 ? `e.g. ${suggs.slice(0, 2).join(', ')}` : ''}
                      suggestions={suggs}
                      warning={getConflictWarning(creatorConflicts, cat.id)}
                    />
                  </label>
                );
              })}
            </>
          )}
          <div className="advanced-criteria-toggle" style={{ margin: '24px 0 16px 0' }}>
            <button
              type="button"
              className="secondary-button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              style={{
                width: '100%',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <span>{showAdvanced ? 'Hide' : 'Show'} Advanced Match Criteria</span>
              <span>{showAdvanced ? '▲' : '▼'}</span>
            </button>
            {!showAdvanced && (
              <p
                style={{
                  fontSize: '0.85rem',
                  color: '#64748b',
                  marginTop: '8px',
                  textAlign: 'center',
                }}
              >
                By default, we smartly guess who you want to match with based on your own identity.
                Open this to set strict requirements for who can view this wish.
              </p>
            )}
          </div>

          {showAdvanced && (
            <fieldset
              style={{
                border: '1px solid #d7dee5',
                borderRadius: '12px',
                padding: '16px',
                background: '#f8fafc',
                marginBottom: '16px',
              }}
            >
              <legend style={{ fontWeight: 600, padding: '0 8px' }}>Advanced Match Criteria</legend>
              <div style={{ display: 'grid', gap: '12px' }}>
                {categories.map((cat, idx) => {
                  const suggs = cat.suggestions || [];
                  return (
                    <div
                      key={cat.id}
                      style={{ display: 'grid', gap: '8px', marginTop: idx > 0 ? '12px' : '0' }}
                    >
                      <div className="label-with-info">
                        <label htmlFor={`desired-${cat.id}`}>Strictly required {cat.label}s</label>
                        <InfoToggle>
                          Only users with these {cat.label}s will be able to see this wish.
                        </InfoToggle>
                      </div>
                      <AttributeInput
                        id={`desired-${cat.id}`}
                        category={cat.id}
                        value={desiredAttributes[cat.id] || ''}
                        onChange={(val) =>
                          setDesiredAttributes((prev) => ({ ...prev, [cat.id]: val }))
                        }
                        placeholder={suggs.length > 0 ? `e.g. ${suggs.slice(0, 2).join(', ')}` : ''}
                        suggestions={suggs}
                        warning={getConflictWarning(desiredConflicts, cat.id)}
                      />
                    </div>
                  );
                })}
              </div>
            </fieldset>
          )}
          {hasConflicts && (
            <div className="message error" style={{ marginBottom: '12px' }}>
              Please resolve the attribute conflicts highlighted above before submitting.
            </div>
          )}
          <button type="submit" disabled={hasConflicts}>
            Submit Wish
          </button>
        </form>

        <WishPreview wish={previewWish} onOverflowChange={setIsOverflowing} />
      </div>

      {result && (
        <div className="message success" style={{ textAlign: 'center', marginTop: '24px' }}>
          <p>
            <strong>Wish saved! ID: {result.id}</strong>
          </p>
          {result.secret && (
            <>
              <p>
                Your passphrase is: <strong>{result.secret}</strong>
              </p>
              <div style={{ margin: '16px 0' }}>
                <QRCodeSVG
                  value={`${globalThis.location.origin}${globalThis.location.pathname}#manage-wish?id=${result.id}&secret=${encodeURIComponent(result.secret)}`}
                  size={150}
                  bgColor="#ffffff"
                  fgColor="#0f172a"
                />
              </div>
              <p>
                <a
                  href={`#manage-wish?id=${result.id}&secret=${encodeURIComponent(result.secret)}`}
                >
                  Click here or bookmark this link to manage your wish later
                </a>
              </p>
              <p style={{ fontSize: '0.9em', color: '#475569' }}>
                Or scan the QR code with your phone to save it!
              </p>
            </>
          )}
        </div>
      )}
      {error && <div className="message error">{error}</div>}

      {showScanner && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1000,
            background: 'rgba(0,0,0,0.9)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <React.Suspense fallback={<div style={{ color: 'white' }}>Loading scanner...</div>}>
            <WishScanner
              onCapture={(ocrContent, blob) => {
                if (ocrContent) setContent(ocrContent);
                setImageBlob(blob);
                setShowScanner(false);
              }}
              onCancel={() => setShowScanner(false)}
            />
          </React.Suspense>
        </div>
      )}
    </section>
  );
}
