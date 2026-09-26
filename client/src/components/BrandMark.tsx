// VeraKey's logo comes in two forms, both in client/public/brand:
// - the mark alone, where the name is written next to it or there is little room (bars, icons, avatars);
// - the mark with "VeraKey" below it, where the logo stands on its own (the site's footer, the README, link cards).
// Both are drawn light on transparency, for dark backgrounds only.

const MARK_SET = "/brand/verakey-mark-64.png 64w, /brand/verakey-mark-128.png 128w, /brand/verakey-mark-256.png 256w";
const LOGO_SET = "/brand/verakey-logo-480.png 480w, /brand/verakey-logo-960.png 960w";
/** The logo's height over its width. */
const LOGO_RATIO = 416 / 480;

/** The mark without the name. Decorative: the name next to it, or the control around it, says what it is. */
export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <img
      className="brand-mark"
      src="/brand/verakey-mark-64.png"
      srcSet={MARK_SET}
      sizes={`${size}px`}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      draggable={false}
    />
  );
}

/** The mark with the name below it. */
export function BrandLogo({ width = 120 }: { width?: number }) {
  return (
    <img
      className="brand-logo"
      src="/brand/verakey-logo-480.png"
      srcSet={LOGO_SET}
      sizes={`${width}px`}
      width={width}
      height={Math.round(width * LOGO_RATIO)}
      alt="VeraKey"
      draggable={false}
    />
  );
}
