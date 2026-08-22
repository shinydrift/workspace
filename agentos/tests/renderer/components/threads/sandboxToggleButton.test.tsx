/**
 * The sandbox button states what will happen at start, not what was chosen. Colour therefore tracks
 * the effective outcome in all four states — an inherited sandbox is emerald like a pinned one,
 * because a muted inherited state read as "sandbox off".
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SandboxToggleButton } from '../../../../src/renderer/components/threads/SandboxToggleButton';

afterEach(cleanup);

function renderButton(runOnHost: boolean | undefined, inheritedRunOnHost: boolean | undefined) {
  const onToggle = vi.fn();
  render(<SandboxToggleButton runOnHost={runOnHost} inheritedRunOnHost={inheritedRunOnHost} onToggle={onToggle} />);
  return onToggle;
}

describe('SandboxToggleButton', () => {
  it('stays hidden until the inherited setting resolves', () => {
    renderButton(undefined, undefined);
    expect(screen.queryByRole('button')).toBe(null);
  });

  it('colours an inherited sandbox the same as a pinned one', () => {
    renderButton(undefined, false);
    const inherited = screen.getByRole('button');
    expect(inherited.className).toContain('text-emerald-500');
    expect(inherited.className).not.toContain('text-muted-foreground');
    expect(inherited.getAttribute('aria-label')).toBe('Sandbox on');

    cleanup();
    renderButton(false, false);
    expect(screen.getByRole('button').className).toContain('text-emerald-500');
  });

  it('colours an inherited host run the same as a pinned one', () => {
    renderButton(undefined, true);
    const inherited = screen.getByRole('button');
    expect(inherited.className).toContain('text-amber-500');
    expect(inherited.getAttribute('aria-label')).toBe('Sandbox off — running on host');

    cleanup();
    renderButton(true, true);
    expect(screen.getByRole('button').className).toContain('text-amber-500');
  });

  it('carries pinned-vs-inherited in the tooltip only', () => {
    renderButton(undefined, false);
    expect(screen.getByRole('button').getAttribute('title')).toContain('(inherited)');

    cleanup();
    renderButton(false, false);
    expect(screen.getByRole('button').getAttribute('title')).not.toContain('(inherited)');
  });

  it('pins the opposite of the effective state, inherited or not', () => {
    const fromInherited = renderButton(undefined, false);
    fireEvent.click(screen.getByRole('button'));
    expect(fromInherited).toHaveBeenCalledWith(true);

    cleanup();
    const fromPinnedHost = renderButton(true, false);
    fireEvent.click(screen.getByRole('button'));
    expect(fromPinnedHost).toHaveBeenCalledWith(false);
  });
});
