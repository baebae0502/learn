import { Component, type ReactNode } from 'react';
import { FatalScreen } from '../components/FatalScreen';
import { t } from '../strings';

/** A render-time throw below this shows the fatal screen (which still reports the blocked context) instead of a blank window. */
export class RenderBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(error: unknown): void {
    // The error name only: messages can carry paths or document text.
    console.error(`[app] the main window failed to render: ${error instanceof Error ? error.name : 'unknown'}`);
  }

  override render(): ReactNode {
    if (this.state.failed) return <FatalScreen code="INTERNAL" message={t.shell.renderFailed} libraryRoot={null} />;
    return this.props.children;
  }
}
