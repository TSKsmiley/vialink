// SPDX-License-Identifier: GPL-2.0-or-later
// ViaLink's logo: a keycap seen from above with the V of Vial on its face. The
// same drawing as the app icon (src-tauri/icons/icon.svg) and the favicon, in
// the same colours in both themes.

export function Logo({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" className="shrink-0">
      <rect width="64" height="64" rx="14" fill="#0f766e" />
      <rect x="11" y="12" width="42" height="42" rx="9" fill="#0a4f4a" />
      <rect x="16" y="14" width="32" height="31" rx="6" fill="#2dd4bf" />
      <path
        d="M24 22 L32 37 L40 22"
        fill="none"
        stroke="#04201c"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
