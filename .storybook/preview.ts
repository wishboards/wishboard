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
      Gay: { unicode: '🌈', color: '#38bdf8' },
      Lesbian: { unicode: '🧡', color: '#f43f5e' },
      Bisexual: { unicode: '💖', color: '#d946ef' },
      Pansexual: { unicode: '💛', color: '#eab308' },
      Asexual: { unicode: '🖤', color: '#a855f7' },
      Queer: { unicode: '✨', color: '#ec4899' },
    },
    gender: {
      Man: { unicode: '♂️', color: '#60a5fa' },
      Woman: { unicode: '♀️', color: '#f472b6' },
      Nonbinary: { unicode: '⚧️', color: '#c084fc' },
    },
    interests: {
      Gaming: { unicode: '🎮', color: '#4ade80' },
      Cosplay: { unicode: '🎭', color: '#fb923c' },
      'Board Games': { unicode: '🎲', color: '#facc15' },
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
