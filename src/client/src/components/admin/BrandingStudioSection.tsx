import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { BrandingConfig, ThemePreset, BoardTexture } from '../../EventProfileContext';
import { resolveBoardTextureCss } from '../../hooks/useTheme';
import { checkWcagAA } from '../../utils/contrast';

export interface SectionProps {
  authHeader: Record<string, string>;
  setMessage: (msg: string | null) => void;
  setError: (err: string | null) => void;
  refreshCounter: number;
  onSessionExpired?: () => void;
}

const DEFAULT_BRANDING: BrandingConfig = {
  themePreset: 'midnight',
  accentColor: '#fbbf24',
  primaryColor: '#f59e0b',
  surfaceColor: 'rgba(30, 41, 59, 0.78)',
  boardTitle: 'Wishboard',
  tagline: 'Pin your convention wishes',
  boardTexture: 'cork',
  logoUrl: null,
  boardBgUrl: null,
};

const ALLOWED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

// eslint-disable-next-line react-refresh/only-export-components -- Helper exported for unit testing file validation logic
export const validateRasterFile = (file: File): string | null => {
  const lowerName = file.name.toLowerCase();
  const isSvg = file.type === 'image/svg+xml' || lowerName.endsWith('.svg');
  if (isSvg || !ALLOWED_MIME_TYPES.includes(file.type)) {
    return 'Invalid file type. Only PNG, JPG, and WEBP raster images are allowed. SVGs are strictly prohibited.';
  }
  if (file.size > MAX_FILE_SIZE) {
    return 'File size exceeds the 5MB limit.';
  }
  return null;
};

interface DropzoneProps {
  label: string;
  id: string;
  imageUrl: string | null | undefined;
  uploading: boolean;
  onFileSelected: (file: File) => void;
  onRemove: () => void;
  authHeader: Record<string, string>;
  setError: (err: string | null) => void;
}

function ImageDropzone({
  label,
  id,
  imageUrl,
  uploading,
  onFileSelected,
  onRemove,
  setError,
}: Readonly<DropzoneProps>) {
  const [isDragOver, setIsDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      const err = validateRasterFile(file);
      if (err) {
        setError(err);
        return;
      }
      onFileSelected(file);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const err = validateRasterFile(file);
      if (err) {
        setError(err);
        if (inputRef.current) inputRef.current.value = '';
        return;
      }
      onFileSelected(file);
    }
  };

  return (
    <div style={{ flex: 1, minWidth: '240px' }}>
      <label htmlFor={id} style={{ display: 'block', marginBottom: '6px', fontWeight: 600 }}>
        {label}
      </label>
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        style={{
          border: isDragOver
            ? '2px dashed var(--wb-accent-primary, #f59e0b)'
            : '2px dashed #475569',
          borderRadius: '12px',
          padding: '16px',
          textAlign: 'center',
          backgroundColor: isDragOver ? 'rgba(245, 158, 11, 0.08)' : 'rgba(15, 23, 42, 0.4)',
          transition: 'border-color 0.2s, background-color 0.2s',
          cursor: 'pointer',
        }}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            inputRef.current?.click();
          }
        }}
        aria-label={`Upload ${label}`}
      >
        <input
          id={id}
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          style={{
            position: 'absolute',
            opacity: 0,
            pointerEvents: 'none',
            width: '1px',
            height: '1px',
          }}
          onChange={handleInputChange}
          aria-label={label}
          data-testid={`${id}-input`}
        />
        {imageUrl ? (
          <div
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}
          >
            <img
              src={imageUrl}
              alt={`${label} Preview`}
              style={{
                maxHeight: '80px',
                maxWidth: '100%',
                objectFit: 'contain',
                borderRadius: '6px',
                border: '1px solid #334155',
              }}
            />
            <button
              type="button"
              className="secondary-button"
              style={{ fontSize: '0.8rem', padding: '4px 10px' }}
              onClick={(e) => {
                e.stopPropagation();
                onRemove();
                if (inputRef.current) inputRef.current.value = '';
              }}
            >
              Remove {label}
            </button>
          </div>
        ) : (
          <div>
            <div style={{ fontSize: '1.8rem', marginBottom: '4px' }}>📁</div>
            <p style={{ margin: 0, fontSize: '0.85rem', color: '#94a3b8' }}>
              {uploading
                ? 'Uploading...'
                : 'Drag & drop raster image (PNG, JPG, WebP) or click to browse'}
            </p>
            <span style={{ fontSize: '0.75rem', color: '#64748b' }}>Max 5MB • SVGs prohibited</span>
          </div>
        )}
      </div>
    </div>
  );
}

interface LivePreviewProps {
  branding: BrandingConfig;
}

function LivePreview({ branding }: Readonly<LivePreviewProps>) {
  const boardTextureCss = resolveBoardTextureCss(branding.boardTexture, branding.boardBgUrl);

  return (
    <div
      style={{
        marginTop: '24px',
        padding: '20px',
        borderRadius: '16px',
        border: '1px solid #334155',
        backgroundColor: '#0b1120',
      }}
      aria-label="Live Branding Preview"
    >
      <h3 style={{ marginTop: 0, marginBottom: '16px', fontSize: '1.1rem', color: '#f8fafc' }}>
        Live Interactive Preview
      </h3>
      <div
        style={{
          borderRadius: '12px',
          overflow: 'hidden',
          border: '1px solid #1e293b',
          boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)',
        }}
      >
        {/* Mock Header */}
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 20px',
            backgroundColor: branding.surfaceColor || 'rgba(30, 41, 59, 0.78)',
            borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            {branding.logoUrl ? (
              <img
                src={branding.logoUrl}
                alt="Brand Logo"
                style={{ height: '36px', maxWidth: '120px', objectFit: 'contain' }}
              />
            ) : (
              <span style={{ fontSize: '1.4rem' }}>🌟</span>
            )}
            <div>
              <div style={{ fontWeight: 700, fontSize: '1.15rem', color: '#f8fafc' }}>
                {branding.boardTitle || 'Wishboard'}
              </div>
              <div style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
                {branding.tagline || 'Pin your convention wishes'}
              </div>
            </div>
          </div>
          <button
            type="button"
            style={{
              backgroundColor: branding.primaryColor || '#f59e0b',
              color: '#0f172a',
              fontWeight: 600,
              padding: '6px 14px',
              borderRadius: '8px',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            Sample CTA
          </button>
        </header>

        {/* Mock Board Surface */}
        <div
          style={{
            padding: '30px 20px',
            minHeight: '140px',
            backgroundImage: boardTextureCss,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            backgroundColor: '#1e293b',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '16px',
            flexWrap: 'wrap',
          }}
        >
          {/* Simulated Tactile 3x5 Wish Card */}
          <div
            style={{
              backgroundColor: '#fffdf3',
              color: '#1e293b',
              padding: '16px 20px',
              borderRadius: '8px',
              boxShadow: '0 8px 20px rgba(0,0,0,0.3)',
              maxWidth: '280px',
              position: 'relative',
              transform: 'rotate(-1.5deg)',
            }}
          >
            <div
              style={{
                position: 'absolute',
                top: '-8px',
                left: '50%',
                transform: 'translateX(-50%)',
                width: '14px',
                height: '14px',
                borderRadius: '50%',
                backgroundColor: branding.accentColor || '#fbbf24',
                boxShadow: '0 2px 4px rgba(0,0,0,0.4)',
              }}
            />
            <div style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: '6px' }}>
              Looking for board game crew!
            </div>
            <div style={{ fontSize: '0.8rem', color: '#475569' }}>
              Tabletop room @ 7pm • Tag: #gaming
            </div>
          </div>
        </div>

        {/* Palette Summary Footer */}
        <div
          style={{
            padding: '10px 16px',
            backgroundColor: '#0f172a',
            fontSize: '0.8rem',
            color: '#94a3b8',
            display: 'flex',
            alignItems: 'center',
            gap: '16px',
            flexWrap: 'wrap',
          }}
        >
          <span>
            Preset: <strong>{branding.themePreset || 'midnight'}</strong>
          </span>
          <span>
            Texture: <strong>{branding.boardTexture || 'cork'}</strong>
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            Primary:
            <span
              style={{
                display: 'inline-block',
                width: '12px',
                height: '12px',
                borderRadius: '2px',
                backgroundColor: branding.primaryColor || '#f59e0b',
                border: '1px solid #64748b',
              }}
            />
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            Accent:
            <span
              style={{
                display: 'inline-block',
                width: '12px',
                height: '12px',
                borderRadius: '2px',
                backgroundColor: branding.accentColor || '#fbbf24',
                border: '1px solid #64748b',
              }}
            />
          </span>
        </div>
      </div>
    </div>
  );
}

export default function BrandingStudioSection({
  authHeader,
  setMessage,
  setError,
  refreshCounter,
  onSessionExpired,
}: Readonly<SectionProps>) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingBg, setUploadingBg] = useState(false);
  const [branding, setBranding] = useState<BrandingConfig>(DEFAULT_BRANDING);

  const loadBranding = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const response = await fetch('/api/admin/branding', { headers: authHeader });
      if (response.status === 401) {
        onSessionExpired?.();
        return;
      }
      if (response.ok) {
        const data: BrandingConfig = await response.json();
        setBranding({
          themePreset: data.themePreset || 'midnight',
          primaryColor: data.primaryColor || '#f59e0b',
          accentColor: data.accentColor || '#fbbf24',
          surfaceColor: data.surfaceColor || 'rgba(30, 41, 59, 0.78)',
          boardTitle: data.boardTitle ?? 'Wishboard',
          tagline: data.tagline ?? 'Pin your convention wishes',
          boardTexture: data.boardTexture || 'cork',
          logoUrl: data.logoUrl ?? null,
          boardBgUrl: data.boardBgUrl ?? null,
        });
      } else {
        setError('Failed to load branding configuration.');
      }
    } catch (err) {
      console.error('Error fetching branding configuration:', err);
      setError('Unable to load branding configuration.');
    } finally {
      setLoading(false);
    }
  }, [authHeader, setError, onSessionExpired]);

  useEffect(() => {
    void loadBranding();
  }, [refreshCounter, loadBranding]);

  const handlePresetChange = (preset: ThemePreset) => {
    // When preset changes, if choosing a built-in preset, offer appropriate default colors
    let primary = branding.primaryColor;
    let accent = branding.accentColor;
    let surface = branding.surfaceColor;

    if (preset === 'midnight') {
      primary = '#f59e0b';
      accent = '#fbbf24';
      surface = 'rgba(30, 41, 59, 0.78)';
    } else if (preset === 'daylight') {
      primary = '#2563eb';
      accent = '#1d4ed8';
      surface = '#ffffff';
    } else if (preset === 'corkhouse') {
      primary = '#d97706';
      accent = '#b45309';
      surface = 'rgba(58, 43, 31, 0.88)';
    } else if (preset === 'high-contrast') {
      primary = '#ffff00';
      accent = '#ffffff';
      surface = '#000000';
    }

    setBranding((prev) => ({
      ...prev,
      themePreset: preset,
      primaryColor: primary,
      accentColor: accent,
      surfaceColor: surface,
    }));
  };

  const handleFileUpload = async (file: File, type: 'logo' | 'bg') => {
    setError(null);
    setMessage(null);

    const validationError = validateRasterFile(file);
    if (validationError) {
      setError(validationError);
      return;
    }

    if (type === 'logo') setUploadingLogo(true);
    else setUploadingBg(true);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch('/api/admin/branding/upload', {
        method: 'POST',
        headers: authHeader,
        body: formData,
      });

      if (response.status === 401) {
        onSessionExpired?.();
        return;
      }

      const resData = await response.json();
      if (response.ok && resData.url) {
        if (type === 'logo') {
          setBranding((prev) => ({ ...prev, logoUrl: resData.url }));
          setMessage('Logo uploaded successfully.');
        } else {
          setBranding((prev) => ({ ...prev, boardBgUrl: resData.url }));
          setMessage('Background image uploaded successfully.');
        }
      } else {
        setError(resData.error || 'Failed to upload image.');
      }
    } catch (err) {
      console.error('Error uploading branding image:', err);
      setError('An unexpected error occurred during image upload.');
    } finally {
      if (type === 'logo') setUploadingLogo(false);
      else setUploadingBg(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    setError(null);
    setSaving(true);

    try {
      const response = await fetch('/api/admin/branding', {
        method: 'PUT',
        headers: {
          ...authHeader,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(branding),
      });

      if (response.status === 401) {
        onSessionExpired?.();
        return;
      }

      const resData = await response.json();
      if (response.ok && resData.success) {
        setMessage('Branding configuration saved successfully.');
        if (resData.branding) {
          setBranding(resData.branding);
        }
      } else {
        setError(resData.error || 'Failed to save branding.');
      }
    } catch (err) {
      console.error('Error saving branding configuration:', err);
      setError('An unexpected error occurred while saving branding.');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    if (
      !globalThis.confirm(
        'Are you sure you want to reset all branding settings to event profile defaults?'
      )
    ) {
      return;
    }

    setMessage(null);
    setError(null);
    setSaving(true);

    try {
      const response = await fetch('/api/admin/branding', {
        method: 'DELETE',
        headers: authHeader,
      });

      if (response.status === 401) {
        onSessionExpired?.();
        return;
      }

      const resData = await response.json();
      if (response.ok && resData.success) {
        setMessage('Branding configuration reset to profile defaults.');
        if (resData.branding) {
          setBranding(resData.branding);
        } else {
          setBranding(DEFAULT_BRANDING);
        }
      } else {
        setError(resData.error || 'Failed to reset branding.');
      }
    } catch (err) {
      console.error('Error resetting branding configuration:', err);
      setError('An unexpected error occurred while resetting branding.');
    } finally {
      setSaving(false);
    }
  };

  // Compute live contrast diagnostics
  const contrastWarnings = useMemo(() => {
    const warnings: string[] = [];
    if (branding.primaryColor && branding.surfaceColor) {
      const check = checkWcagAA(branding.primaryColor, branding.surfaceColor, true);
      if (!check.pass) {
        warnings.push(
          `Primary brand color (${branding.primaryColor}) has low contrast (${check.ratio}:1) against the surface background. WCAG AA requires at least ${check.required}:1.`
        );
      }
    }
    if (branding.accentColor && branding.surfaceColor) {
      const check = checkWcagAA(branding.accentColor, branding.surfaceColor, true);
      if (!check.pass) {
        warnings.push(
          `Accent color (${branding.accentColor}) has low contrast (${check.ratio}:1) against the surface background. WCAG AA requires at least ${check.required}:1.`
        );
      }
    }
    return warnings;
  }, [branding.primaryColor, branding.accentColor, branding.surfaceColor]);

  if (loading) {
    return (
      <div style={{ padding: '24px', textAlign: 'center', color: '#94a3b8' }}>
        Loading branding studio...
      </div>
    );
  }

  return (
    <section>
      <h2>Event-Host Branding Studio</h2>
      <p style={{ color: '#94a3b8', marginBottom: '20px' }}>
        Customize visual themes, logos, colors, and textures for your event installation. Changes
        update all connected kiosk and attendee screens in real time.
      </p>

      <form className="form-card" onSubmit={handleSave}>
        {contrastWarnings.length > 0 && (
          <div
            role="alert"
            className="contrast-warning-banner"
            style={{
              padding: '12px 16px',
              backgroundColor: 'rgba(234, 179, 8, 0.15)',
              border: '1px solid #eab308',
              borderRadius: '8px',
              color: '#fef08a',
              marginBottom: '20px',
            }}
          >
            <strong style={{ display: 'block', marginBottom: '6px' }}>
              ⚠️ Accessibility & Contrast Warning
            </strong>
            <ul style={{ margin: 0, paddingLeft: '20px' }}>
              {contrastWarnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Preset Selector */}
        <div style={{ marginBottom: '16px' }}>
          <label
            htmlFor="theme-preset-select"
            style={{ display: 'block', marginBottom: '6px', fontWeight: 600 }}
          >
            Theme Preset
          </label>
          <select
            id="theme-preset-select"
            value={branding.themePreset || 'midnight'}
            onChange={(e) => handlePresetChange(e.target.value as ThemePreset)}
            style={{ width: '100%', maxWidth: '360px' }}
          >
            <option value="midnight">Midnight Lounge (Dark Glassmorphic)</option>
            <option value="daylight">Daylight (Warm Light Mode)</option>
            <option value="corkhouse">Corkhouse (Warm Earthy Cork)</option>
            <option value="high-contrast">High-Contrast (WCAG AAA &gt;= 7:1)</option>
            <option value="custom">Custom (Bespoke Palette)</option>
          </select>
        </div>

        {/* Board Title & Tagline */}
        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', marginBottom: '16px' }}>
          <div style={{ flex: 1, minWidth: '240px' }}>
            <label
              htmlFor="board-title-input"
              style={{ display: 'block', marginBottom: '6px', fontWeight: 600 }}
            >
              Board Title
            </label>
            <input
              id="board-title-input"
              type="text"
              value={branding.boardTitle || ''}
              onChange={(e) => setBranding({ ...branding, boardTitle: e.target.value })}
              placeholder="e.g. Wishboard"
              style={{ width: '100%' }}
            />
          </div>
          <div style={{ flex: 1, minWidth: '240px' }}>
            <label
              htmlFor="tagline-input"
              style={{ display: 'block', marginBottom: '6px', fontWeight: 600 }}
            >
              Tagline / Subtitle
            </label>
            <input
              id="tagline-input"
              type="text"
              value={branding.tagline || ''}
              onChange={(e) => setBranding({ ...branding, tagline: e.target.value })}
              placeholder="e.g. Pin your convention wishes"
              style={{ width: '100%' }}
            />
          </div>
        </div>

        {/* Color Customization */}
        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', marginBottom: '16px' }}>
          <div style={{ flex: 1, minWidth: '200px' }}>
            <label
              htmlFor="primary-color-input"
              style={{ display: 'block', marginBottom: '6px', fontWeight: 600 }}
            >
              Primary Brand Color
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input
                id="primary-color-input"
                type="color"
                value={branding.primaryColor?.startsWith('#') ? branding.primaryColor : '#f59e0b'}
                onChange={(e) => setBranding({ ...branding, primaryColor: e.target.value })}
                style={{ width: '42px', height: '42px', padding: '2px', cursor: 'pointer' }}
                aria-label="Primary Brand Color Picker"
              />
              <input
                type="text"
                value={branding.primaryColor || ''}
                onChange={(e) => setBranding({ ...branding, primaryColor: e.target.value })}
                placeholder="#f59e0b"
                style={{ flex: 1 }}
                aria-label="Primary Brand Color Hex"
              />
            </div>
          </div>

          <div style={{ flex: 1, minWidth: '200px' }}>
            <label
              htmlFor="accent-color-input"
              style={{ display: 'block', marginBottom: '6px', fontWeight: 600 }}
            >
              Accent Highlight Color
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input
                id="accent-color-input"
                type="color"
                value={branding.accentColor?.startsWith('#') ? branding.accentColor : '#fbbf24'}
                onChange={(e) => setBranding({ ...branding, accentColor: e.target.value })}
                style={{ width: '42px', height: '42px', padding: '2px', cursor: 'pointer' }}
                aria-label="Accent Highlight Color Picker"
              />
              <input
                type="text"
                value={branding.accentColor || ''}
                onChange={(e) => setBranding({ ...branding, accentColor: e.target.value })}
                placeholder="#fbbf24"
                style={{ flex: 1 }}
                aria-label="Accent Highlight Color Hex"
              />
            </div>
          </div>

          <div style={{ flex: 1, minWidth: '200px' }}>
            <label
              htmlFor="surface-color-input"
              style={{ display: 'block', marginBottom: '6px', fontWeight: 600 }}
            >
              Surface Tint (CSS / RGBA)
            </label>
            <input
              id="surface-color-input"
              type="text"
              value={branding.surfaceColor || ''}
              onChange={(e) => setBranding({ ...branding, surfaceColor: e.target.value })}
              placeholder="rgba(30, 41, 59, 0.78)"
              style={{ width: '100%' }}
            />
          </div>
        </div>

        {/* Texture Selector */}
        <div style={{ marginBottom: '16px' }}>
          <label
            htmlFor="board-texture-select"
            style={{ display: 'block', marginBottom: '6px', fontWeight: 600 }}
          >
            Board Texture
          </label>
          <select
            id="board-texture-select"
            value={branding.boardTexture || 'cork'}
            onChange={(e) =>
              setBranding({ ...branding, boardTexture: e.target.value as BoardTexture })
            }
            style={{ width: '100%', maxWidth: '360px' }}
          >
            <option value="cork">Cork Board (Warm Cork Texture)</option>
            <option value="slate">Slate (Dark Stone Slate)</option>
            <option value="linen">Linen (Textured Neutral Fabric)</option>
            <option value="custom">Custom (Use Uploaded Background)</option>
            <option value="none">None (Flat Background Color)</option>
          </select>
        </div>

        {/* Dropzones for Logo and Background */}
        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', marginBottom: '24px' }}>
          <ImageDropzone
            id="branding-logo-upload"
            label="Organization Logo"
            imageUrl={branding.logoUrl}
            uploading={uploadingLogo}
            onFileSelected={(file) => void handleFileUpload(file, 'logo')}
            onRemove={() => setBranding((prev) => ({ ...prev, logoUrl: null }))}
            authHeader={authHeader}
            setError={setError}
          />
          <ImageDropzone
            id="branding-bg-upload"
            label="Board Background Image"
            imageUrl={branding.boardBgUrl}
            uploading={uploadingBg}
            onFileSelected={(file) => void handleFileUpload(file, 'bg')}
            onRemove={() => setBranding((prev) => ({ ...prev, boardBgUrl: null }))}
            authHeader={authHeader}
            setError={setError}
          />
        </div>

        {/* Live Interactive Preview */}
        <LivePreview branding={branding} />

        {/* Form Action Controls */}
        <div style={{ display: 'flex', gap: '12px', marginTop: '24px', flexWrap: 'wrap' }}>
          <button type="submit" disabled={saving}>
            {saving ? 'Saving Branding...' : 'Save Branding'}
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={handleReset}
            disabled={saving}
            style={{ color: '#ef4444' }}
          >
            Reset to Defaults
          </button>
        </div>
      </form>
    </section>
  );
}
