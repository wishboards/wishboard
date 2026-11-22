import { describe, it, expect } from 'vitest';
import React from 'react';
import { render } from '@testing-library/react';
import * as AiSuggestionModalStories from './AiSuggestionModal.stories';
import * as AttributeInputStories from './AttributeInput.stories';
import * as BottomSheetStories from './common/BottomSheet.stories';
import * as FlagButtonStories from './FlagButton.stories';
import * as IdentityStickersStories from './IdentityStickers.stories';
import * as InfoToggleStories from './InfoToggle.stories';
import * as MobileBottomBarStories from './MobileBottomBar.stories';
import * as PassphraseInputStories from './PassphraseInput.stories';
import * as WiFiQrCodeStories from './WiFiQrCode.stories';
import * as WishCardStories from './WishCard.stories';
import * as WishPreviewStories from './WishPreview.stories';

describe('Storybook Stories Smoke Tests', () => {
  it('renders AiSuggestionModal stories without crashing', async () => {
    const originalFetch = globalThis.fetch;
    try {
      for (const story of [
        AiSuggestionModalStories.DefaultReview,
        AiSuggestionModalStories.SignedInProfileScope,
        AiSuggestionModalStories.ConflictResolution,
        AiSuggestionModalStories.StreamlinedTextComparison,
      ]) {
        const Render = story.render!;
        const { container, unmount } = render(<Render />);
        expect(container).toBeTruthy();
        unmount();
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('renders AttributeInput stories without crashing', () => {
    const { container: c1 } = render(<AttributeInputStories.Orientation.render />);
    expect(c1).toBeTruthy();

    const { container: c2 } = render(<AttributeInputStories.InterestsWithWarning.render />);
    expect(c2).toBeTruthy();
  });

  it('renders BottomSheet story without crashing', () => {
    const { container } = render(<BottomSheetStories.Interactive.render />);
    expect(container).toBeTruthy();
  });

  it('renders FlagButton story without crashing', () => {
    const Component = FlagButtonStories.default.component!;
    const { container } = render(<Component {...FlagButtonStories.Default.args!} />);
    expect(container).toBeTruthy();
  });

  it('renders IdentityStickers stories without crashing', () => {
    const Component = IdentityStickersStories.default.component!;
    const { container: c1 } = render(<Component {...IdentityStickersStories.Default.args!} />);
    expect(c1).toBeTruthy();

    const { container: c2 } = render(
      <Component {...IdentityStickersStories.OrientationHearts.args!} />
    );
    expect(c2).toBeTruthy();

    const { container: c3 } = render(
      <Component {...IdentityStickersStories.GenderFlagsAndIcons.args!} />
    );
    expect(c3).toBeTruthy();

    const { container: c4 } = render(
      <Component {...IdentityStickersStories.InterestBadges.args!} />
    );
    expect(c4).toBeTruthy();

    const { container: c5 } = render(
      <Component {...IdentityStickersStories.ProfessionalRoles.args!} />
    );
    expect(c5).toBeTruthy();

    const { container: c6 } = render(
      <Component {...IdentityStickersStories.MultiCategory.args!} />
    );
    expect(c6).toBeTruthy();
  });

  it('renders InfoToggle story without crashing', () => {
    const Component = InfoToggleStories.default.component!;
    const { container } = render(<Component {...InfoToggleStories.Default.args!} />);
    expect(container).toBeTruthy();
  });

  it('renders MobileBottomBar stories without crashing', () => {
    const { container: c1 } = render(<MobileBottomBarStories.Default.render />);
    expect(c1).toBeTruthy();

    const Component = MobileBottomBarStories.default.component!;
    const { container: c2 } = render(<Component {...MobileBottomBarStories.SearchActive.args!} />);
    expect(c2).toBeTruthy();

    const { container: c3 } = render(
      <Component {...MobileBottomBarStories.WithUnreadWishmail.args!} />
    );
    expect(c3).toBeTruthy();
  });

  it('renders PassphraseInput stories without crashing', () => {
    const { container: c1 } = render(<PassphraseInputStories.Default.render />);
    expect(c1).toBeTruthy();

    const { container: c2 } = render(<PassphraseInputStories.Empty.render />);
    expect(c2).toBeTruthy();
  });

  it('renders WiFiQrCode stories without crashing', () => {
    const Component = WiFiQrCodeStories.default.component!;
    const { container: c1 } = render(<Component {...WiFiQrCodeStories.Floating.args!} />);
    expect(c1).toBeTruthy();

    const { container: c2 } = render(<Component {...WiFiQrCodeStories.Sidebar.args!} />);
    expect(c2).toBeTruthy();
  });

  it('renders WishCard stories without crashing', () => {
    const Component = WishCardStories.default.component!;

    const { container: c1 } = render(<Component {...WishCardStories.Default.args!} />);
    expect(c1).toBeTruthy();

    const { container: c2 } = render(<Component {...WishCardStories.IvoryPaper.args!} />);
    expect(c2).toBeTruthy();

    const { container: c3 } = render(<Component {...WishCardStories.CanaryPaper.args!} />);
    expect(c3).toBeTruthy();

    const { container: c4 } = render(<WishCardStories.AllPaperTints.render />);
    expect(c4).toBeTruthy();

    const { container: c5 } = render(<WishCardStories.AllPushpinColors.render />);
    expect(c5).toBeTruthy();

    const { container: c6 } = render(<Component {...WishCardStories.WithImage.args!} />);
    expect(c6).toBeTruthy();

    const { container: c7 } = render(<Component {...WishCardStories.DisplayMode.args!} />);
    expect(c7).toBeTruthy();
  });

  it('renders WishPreview story without crashing', () => {
    const { container } = render(<WishPreviewStories.Default.render />);
    expect(container).toBeTruthy();
  });
});
