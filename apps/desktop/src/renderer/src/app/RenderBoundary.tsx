import { Component, type ReactNode } from 'react';
import { FatalScreen } from '../components/FatalScreen';

/**
 * A render-time throw below this shows the fatal screen (which still reports the blocked context) instead of a blank
 * window. Not caught here (React error boundaries never see them): event handlers, async code, effects' rejected
 * promises, failed lazy chunks, and anything above the boundary (Boot).
 */
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
    if (this.state.failed) return <FatalScreen kind="render" code="INTERNAL" />;
    return this.props.children;
  }
}
