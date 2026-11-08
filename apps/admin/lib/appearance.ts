'use client';
import type { Preferences } from '@shiv/shared';
import { api } from './api';

export type ThemeChoice = NonNullable<Preferences['theme']>;
export type TextSize = NonNullable<Preferences['textSize']>;

const year = 365 * 24 * 60 * 60;

function cookie(name: string, value: string | null) {
  document.cookie = value
    ? `${name}=${value}; path=/; max-age=${year}; samesite=lax`
    : `${name}=; path=/; max-age=0; samesite=lax`;
}

function read(name: string) {
  return document.cookie.match(new RegExp(`(?:^|; )${name}=([a-z]+)`))?.[1] ?? null;
}

/** What this page shows now. No attribute means Auto: the device's own light or dark. */
export function currentAppearance(): { theme: ThemeChoice; textSize: TextSize } {
  const theme = read('shiv_theme');
  const size = read('shiv_text');
  return {
    theme: theme === 'light' || theme === 'dark' ? theme : 'auto',
    textSize: size === 'large' || size === 'larger' ? size : 'normal',
  };
}

/**
 * Shows the choice at once. The cookie lets the server draw the next page the same way, so it never
 * flashes the wrong theme (app/layout.tsx).
 */
export function applyAppearance(next: Preferences) {
  const html = document.documentElement;
  if (next.theme) {
    if (next.theme === 'auto') html.removeAttribute('data-theme');
    else html.setAttribute('data-theme', next.theme);
    cookie('shiv_theme', next.theme === 'auto' ? null : next.theme);
  }
  if (next.textSize) {
    if (next.textSize === 'normal') html.removeAttribute('data-text');
    else html.setAttribute('data-text', next.textSize);
    cookie('shiv_text', next.textSize === 'normal' ? null : next.textSize);
  }
}

/** Shows it here and saves it for this person, so it follows them to another phone or computer. */
export async function chooseAppearance(next: Preferences) {
  applyAppearance(next);
  await api('/me/preferences', 'PUT', next);
}

/** On sign-in: the saved choice wins over what this browser last showed. */
export function syncAppearance(saved: Preferences | undefined) {
  if (!saved) return;
  const now = currentAppearance();
  const differs =
    (saved.theme && saved.theme !== now.theme) ||
    (saved.textSize && saved.textSize !== now.textSize);
  if (differs) applyAppearance(saved);
}
