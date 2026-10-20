/** The app logo, drawn as in `build/icon.svg` (the .exe icon): keep the two in step. */
export function AppLogo({ size = 28 }: { size?: number }): React.JSX.Element {
  return (
    <svg className="app-logo" width={size} height={size} viewBox="0 0 512 512" aria-hidden="true">
      <defs>
        <linearGradient id="app-logo-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2970ff" />
          <stop offset="1" stopColor="#0b3b8c" />
        </linearGradient>
      </defs>
      <rect width="512" height="512" rx="112" fill="url(#app-logo-bg)" />
      <rect x="64" y="72" width="384" height="32" rx="16" fill="#0b1f44" fillOpacity="0.55" />
      <rect x="104" y="92" width="304" height="332" rx="28" fill="#ffffff" />
      <path fill="#0b1f44" shapeRendering="crispEdges" d="M144 148h28v28h-28zM200 148h28v28h-28zM256 148h28v28h-28zM312 148h28v28h-28zM144 176h28v28h-28zM172 176h28v28h-28zM200 176h28v28h-28zM284 176h28v28h-28zM340 176h28v28h-28zM144 204h28v28h-28zM200 204h28v28h-28zM256 204h28v28h-28zM284 204h28v28h-28zM312 204h28v28h-28zM144 232h28v28h-28zM172 232h28v28h-28zM256 232h28v28h-28zM312 232h28v28h-28zM340 232h28v28h-28zM144 260h28v28h-28zM200 260h28v28h-28zM228 260h28v28h-28zM284 260h28v28h-28zM144 288h28v28h-28zM172 288h28v28h-28zM200 288h28v28h-28zM256 288h28v28h-28zM340 288h28v28h-28zM144 316h28v28h-28zM228 316h28v28h-28zM256 316h28v28h-28zM284 316h28v28h-28zM144 344h28v28h-28zM172 344h28v28h-28zM200 344h28v28h-28zM228 344h28v28h-28zM256 344h28v28h-28zM284 344h28v28h-28zM312 344h28v28h-28zM340 344h28v28h-28z" />
    </svg>
  )
}
