/**
 * Brand mark.
 *
 * ┌───────────────────────────────────────────────────────────────────────┐
 * │  IMPORTANT - TRADEMARK NOTE                                           │
 * │  "Societe Generale" and its logo are registered trademarks of Societe │
 * │  Generale S.A. The graphic below is an ORIGINAL geometric mark drawn  │
 * │  for this demonstration in the same red/black visual family; it is    │
 * │  NOT the official logo and must not be presented as such.             │
 * │                                                                       │
 * │  To drop in the official asset:                                       │
 * │    1. place it at  frontend/public/brand/logo.svg                     │
 * │    2. set  VITE_BRAND_LOGO_URL=/brand/logo.svg  in the environment    │
 * │  Nothing else in the application needs to change.                     │
 * └───────────────────────────────────────────────────────────────────────┘
 */
const OFFICIAL_LOGO_URL = import.meta.env.VITE_BRAND_LOGO_URL || '';

export function BrandMark({ size = 40, title = 'Societe Generale' }) {
  if (OFFICIAL_LOGO_URL) {
    return (
      <img
        src={OFFICIAL_LOGO_URL}
        alt={title}
        width={size}
        height={size}
        className="brand-mark"
        decoding="async"
      />
    );
  }

  return (
    <svg
      className="brand-mark"
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role="img"
      aria-label={title}
      focusable="false"
    >
      <title>{title}</title>
      <rect x="0" y="0" width="64" height="64" rx="6" fill="var(--sg-black)" />
      {/* Red counterform, clipped to the rounded square. */}
      <clipPath id="brandClip">
        <rect x="0" y="0" width="64" height="64" rx="6" />
      </clipPath>
      <g clipPath="url(#brandClip)">
        <path d="M64 0 L64 64 L20 64 Z" fill="var(--sg-red)" />
        <path d="M64 0 L28 64 L14 64 L52 0 Z" fill="#ffffff" opacity="0.96" />
      </g>
    </svg>
  );
}

export function BrandLockup({ size = 40, subtitle = 'Account Management' }) {
  return (
    <div className="brand-lockup">
      <BrandMark size={size} />
      <div className="brand-lockup__text">
        <span className="brand-lockup__name">SOCIETE GENERALE</span>
        <span className="brand-lockup__sub">{subtitle}</span>
      </div>
    </div>
  );
}

export default BrandMark;
