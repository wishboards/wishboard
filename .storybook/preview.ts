import type { Preview } from '@storybook/react-vite';
import React, { useEffect } from 'react';
import '../src/client/src/styles.css';
import '../src/client/src/theme.css';
import EventProfileContext, { EventProfile } from '../src/client/src/EventProfileContext';

export const mockEventProfile: EventProfile = {
  profile: 'lifestyle',
  title: 'Convention Wishboard',
  contact_methods: ['Telegram', 'Discord', 'Phone', 'Signal', 'Email'],
  categories: [
    {
      id: 'orientation',
      label: 'Orientation',
      suggestions: ['Gay', 'Lesbian', 'Bisexual', 'Pansexual', 'Asexual', 'Queer'],
    },
    {
      id: 'gender',
      label: 'Gender',
      suggestions: ['Man', 'Woman', 'Nonbinary', 'Genderfluid', 'Transgender'],
    },
    {
      id: 'interests',
      label: 'Interests',
      suggestions: ['Gaming', 'Cosplay', 'Board Games', 'Anime', 'VR', 'Karaoke'],
    },
  ],
  stickers: {
    orientation: {
      straight: { type: 'heart', class: 'flag-straight' },
      gay: { type: 'heart', class: 'flag-rainbow' },
      lesbian: { type: 'heart', class: 'flag-lesbian' },
      bisexual: { type: 'heart', class: 'flag-bisexual' },
      bi: { type: 'heart', class: 'flag-bisexual' },
      pansexual: { type: 'heart', class: 'flag-pansexual' },
      pan: { type: 'heart', class: 'flag-pansexual' },
      asexual: { type: 'heart', class: 'flag-asexual' },
      ace: { type: 'heart', class: 'flag-asexual' },
      queer: { type: 'heart', class: 'flag-rainbow' },
      rainbow: { type: 'heart', class: 'flag-rainbow' },
    },
    gender: {
      trans: { type: 'flag', class: 'flag-trans' },
      transgender: { type: 'flag', class: 'flag-trans' },
      nonbinary: { type: 'flag', class: 'flag-nonbinary' },
      'non-binary': { type: 'flag', class: 'flag-nonbinary' },
      enby: { type: 'flag', class: 'flag-nonbinary' },
      genderqueer: { type: 'flag', class: 'flag-genderqueer' },
      agender: { type: 'flag', class: 'flag-nonbinary' },
      woman: { type: 'icon', class: 'female-icon', iconType: 'female' },
      female: { type: 'icon', class: 'female-icon', iconType: 'female' },
      ciswoman: { type: 'icon', class: 'female-icon', iconType: 'female' },
      man: { type: 'icon', class: 'male-icon', iconType: 'male' },
      male: { type: 'icon', class: 'male-icon', iconType: 'male' },
      cisman: { type: 'icon', class: 'male-icon', iconType: 'male' },
    },
    interests: {
      gaming: { type: 'image', src: '/assets/gaming.svg' },
      cosplay: { type: 'image', src: '/assets/cosplay.svg' },
      'board games': { type: 'image', src: '/assets/boardgames.svg' },
      anime: { type: 'image', src: '/assets/anime.svg' },
      vr: { type: 'image', src: '/assets/vr.svg' },
    },
    role: {
      presenter: { type: 'image', src: '/assets/presenter.svg' },
      attendee: { type: 'image', src: '/assets/attendee.svg' },
    },
  },
  branding: {
    themePreset: 'midnight',
    accentColor: '#f59e0b',
    primaryColor: '#f59e0b',
    surfaceColor: 'rgba(30, 41, 59, 0.78)',
    boardTitle: 'Wishboard',
    tagline: 'Pin your convention wishes',
    boardTexture: 'cork',
    logoUrl: null,
    boardBgUrl: null,
  },
  realtimeProvider: 'socketio',
  apIp: '192.168.4.1',
  isServerless: false,
};

const preview: Preview = {
  globalTypes: {
    theme: {
      name: 'Theme Preset',
      description: 'Global Theme Preset for Wishboard',
      defaultValue: 'midnight',
      toolbar: {
        icon: 'mirror',
        items: [
          { value: 'midnight', title: 'Midnight Lounge (Dark)' },
          { value: 'daylight', title: 'Daylight (Light)' },
          { value: 'corkhouse', title: 'Corkhouse (Warm)' },
          { value: 'high-contrast', title: 'High Contrast (WCAG AAA)' },
        ],
        dynamicTitle: true,
      },
    },
    paper: {
      name: 'Card Paper Tint',
      description: 'Default 3x5 Index Card Paper Swatch',
      defaultValue: 'ivory',
      toolbar: {
        icon: 'document',
        items: [
          { value: 'ivory', title: 'Ivory (#fdfbf7)' },
          { value: 'canary', title: 'Canary (#fef9c3)' },
          { value: 'rose', title: 'Rose (#ffe4e6)' },
          { value: 'sky', title: 'Sky (#e0f2fe)' },
          { value: 'sage', title: 'Sage (#dcfce7)' },
        ],
        dynamicTitle: true,
      },
    },
  },
  decorators: [
    (Story, context) => {
      const theme = context.globals.theme || 'midnight';
      const paper = context.globals.paper || 'ivory';

      useEffect(() => {
        document.documentElement.setAttribute('data-theme', theme);
      }, [theme]);

      return React.createElement(
        EventProfileContext,
        { value: mockEventProfile },
        React.createElement(
          'div',
          {
            'data-theme': theme,
            'data-card-paper': paper,
            style: {
              padding: '2rem',
              background: 'var(--wb-bg-canvas, #080d1a)',
              color: 'var(--wb-text-primary, #f8fafc)',
              minHeight: '100vh',
              fontFamily: "var(--font-family, 'Outfit', sans-serif)",
            },
          },
          React.createElement(Story)
        )
      );
    },
  ],
};

export default preview;
