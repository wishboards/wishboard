import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import IdentityStickers from './IdentityStickers';
import { countMatchingStickers } from '../utils/stickers';
import * as EventProfileContext from '../EventProfileContext';

vi.mock('../EventProfileContext', () => ({
  useEventProfile: vi.fn(),
}));

const mockDefaultProfile = {
  profile: 'lifestyle',
  contact_methods: ['Phone', 'Email'],
  categories: [],
  stickers: {
    orientation: {
      straight: { type: 'heart', class: 'flag-straight' },
      gay: { type: 'heart', class: 'flag-rainbow' },
      lesbian: { type: 'heart', class: 'flag-lesbian' },
      bi: { type: 'heart', class: 'flag-bisexual' },
      pan: { type: 'heart', class: 'flag-pansexual' },
      asexual: { type: 'heart', class: 'flag-asexual' },
      queer: { type: 'heart', class: 'flag-rainbow' },
    },
    gender: {
      trans: { type: 'flag', class: 'flag-trans' },
      nonbinary: { type: 'flag', class: 'flag-nonbinary' },
      woman: { type: 'icon', class: 'female-icon', iconType: 'female' },
      man: { type: 'icon', class: 'male-icon', iconType: 'male' },
    },
  },
  realtimeProvider: 'socketio',
  apIp: '',
  isServerless: false,
};

const mockAlternativeProfile = {
  profile: 'professional',
  contact_methods: ['LinkedIn', 'Phone', 'Email'],
  categories: [],
  stickers: {
    role: {
      presenter: { type: 'image', src: '/assets/presenter.png' },
      attendee: { type: 'image', src: '/assets/attendee.png' },
    },
  },
  realtimeProvider: 'socketio',
  apIp: '',
  isServerless: false,
};

describe('IdentityStickers', () => {
  it('returns null if no stickers provided', () => {
    vi.mocked(EventProfileContext.useEventProfile).mockReturnValue(mockDefaultProfile);
    const { container } = render(<IdentityStickers />);
    expect(container.firstChild).toBeNull();
  });

  it('renders all recognized orientations for default domain', () => {
    vi.mocked(EventProfileContext.useEventProfile).mockReturnValue(mockDefaultProfile);
    const orientations = ['straight', 'gay', 'lesbian', 'bi', 'pan', 'asexual', 'queer', 'unknown'];
    const { container } = render(<IdentityStickers attributes={{ orientation: orientations }} />);
    expect(container.querySelectorAll('.sticker-heart-shadow')).toHaveLength(7);
  });

  it('renders all recognized genders for default domain', () => {
    vi.mocked(EventProfileContext.useEventProfile).mockReturnValue(mockDefaultProfile);
    const genders = ['trans', 'nonbinary', 'woman', 'man', 'unknown'];
    const { container } = render(<IdentityStickers attributes={{ gender: genders }} />);
    expect(container.querySelectorAll('.sticker-flag')).toHaveLength(2);
    expect(container.querySelectorAll('.sticker-icon')).toHaveLength(2);
  });

  it('renders alternative domain stickers correctly', () => {
    vi.mocked(EventProfileContext.useEventProfile).mockReturnValue(mockAlternativeProfile);
    const attributes = { role: ['presenter', 'attendee', 'sponsor'] };
    const { container } = render(<IdentityStickers attributes={attributes} />);
    expect(container.querySelectorAll('.sticker-image')).toHaveLength(2);
    const imgs = container.querySelectorAll('img');
    expect(imgs[0].getAttribute('src')).toBe('/assets/presenter.png');
    expect(imgs[1].getAttribute('src')).toBe('/assets/attendee.png');
  });

  describe('countMatchingStickers', () => {
    it('returns 0 for undefined or empty attributes or stickers', () => {
      expect(countMatchingStickers(undefined, mockDefaultProfile.stickers)).toBe(0);
      expect(countMatchingStickers({}, mockDefaultProfile.stickers)).toBe(0);
      expect(countMatchingStickers({ orientation: ['straight'] }, undefined)).toBe(0);
    });

    it('returns exact count of matching stickers', () => {
      const count = countMatchingStickers(
        {
          orientation: ['straight', 'gay', 'nonexistent'],
          gender: ['woman', 'unknown'],
        },
        mockDefaultProfile.stickers
      );
      expect(count).toBe(3); // straight, gay, woman
    });
  });
});
