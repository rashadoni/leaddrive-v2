import sharp from 'sharp'
import { writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT = join(__dirname, 'final')
mkdirSync(OUT, { recursive: true })

const NAVY = '#001E3C'
const CREAM = '#F3EEE4'
const WHITE = '#FFFFFF'

// ═══════════════════════════════════════════════════════════════════
// Master D with single angular notch (SVG path)
// Canvas: 1024x1024
// D cap-height: 704px (y: 160..864), left edge: x=220, stem thickness: 140px
// Inner counter: radius 220px from (360, 512), clipped at x=360
// Notch: triangular hole in upper stem area
// ═══════════════════════════════════════════════════════════════════
// D letterform with top-left corner chamfered (diagonal cut) — matches AI reference a3-single-notch
// Canvas: 1024x1024
// D bounding: x=220..772, y=160..864 (width 552, height 704)
// Stem: x=220..420 (200px wide), bowl radius 352 from (420, 512)
// Counter: inner radius 220 from (420, 512), clipped at x=420
// Chamfer: diagonal cut from top edge (370, 160) down to left edge (220, 440)
const dPath = `
<path fill-rule="evenodd" d="
  M 370 160
  L 420 160
  A 352 352 0 0 1 420 864
  L 220 864
  L 220 440
  Z
  M 420 292
  A 220 220 0 0 1 420 732
  L 420 732 Z
"/>
`

// Variant: mark only (transparent bg) at current fill color
const markOnly = (color) => `<svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
  ${dPath.replace('<path', `<path fill="${color}"`)}
</svg>`

// Variant: app icon (solid background + mark)
const appIcon = (bg, fg, rounded = true) => `<svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
  <rect width="1024" height="1024"${rounded ? ' rx="224"' : ''} fill="${bg}"/>
  ${dPath.replace('<path', `<path fill="${fg}"`)}
</svg>`

// Variant: plain background (no rounded corners — for Meta which auto-rounds)
const flatIcon = (bg, fg) => `<svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
  <rect width="1024" height="1024" fill="${bg}"/>
  ${dPath.replace('<path', `<path fill="${fg}"`)}
</svg>`

// Horizontal logo (mark + text) for sidebar / marketing
const horizontalLogo = (fgText, markColor) => `<svg viewBox="0 0 960 200" xmlns="http://www.w3.org/2000/svg">
  <g transform="translate(0 -410) scale(0.195)">
    ${dPath.replace('<path', `<path fill="${markColor}"`)}
  </g>
  <text x="225" y="110" font-family="Inter, system-ui, -apple-system, 'Segoe UI', sans-serif"
    font-size="96" font-weight="700" letter-spacing="-3" fill="${fgText}">Lead<tspan font-weight="800">Drive</tspan></text>
  <text x="700" y="108" font-family="Inter, system-ui, sans-serif"
    font-size="80" font-weight="300" letter-spacing="8" fill="${fgText}" opacity="0.5">CRM</text>
  <line x1="680" y1="60" x2="680" y2="140" stroke="${fgText}" stroke-width="2" opacity="0.25"/>
</svg>`

// ═══════════════════════════════════════════════════════════════════
// Generate all variants
// ═══════════════════════════════════════════════════════════════════

const variants = [
  // Primary: Meta App Icon (navy bg, cream mark, 1024x1024, NO rounded corners)
  // Meta auto-applies rounded corners on mobile
  { name: 'meta-app-icon-1024', svg: flatIcon(NAVY, CREAM), size: 1024 },

  // Inverted (cream bg, navy mark)
  { name: 'app-icon-cream-1024', svg: flatIcon(CREAM, NAVY), size: 1024 },

  // Favicon sizes (navy on cream, no rounded corners for small)
  { name: 'favicon-16', svg: flatIcon(CREAM, NAVY), size: 16 },
  { name: 'favicon-32', svg: flatIcon(CREAM, NAVY), size: 32 },
  { name: 'favicon-48', svg: flatIcon(CREAM, NAVY), size: 48 },
  { name: 'favicon-64', svg: flatIcon(CREAM, NAVY), size: 64 },
  { name: 'favicon-128', svg: flatIcon(CREAM, NAVY), size: 128 },
  { name: 'favicon-256', svg: flatIcon(CREAM, NAVY), size: 256 },

  // Apple touch icon (180×180, rounded corners applied by iOS automatically)
  { name: 'apple-touch-icon', svg: flatIcon(NAVY, CREAM), size: 180 },

  // Android/PWA icons
  { name: 'android-192', svg: flatIcon(NAVY, CREAM), size: 192 },
  { name: 'android-512', svg: flatIcon(NAVY, CREAM), size: 512 },

  // Mark-only (transparent bg) for flexible embedding
  { name: 'mark-navy', svg: markOnly(NAVY), size: 1024 },
  { name: 'mark-cream', svg: markOnly(CREAM), size: 1024 },
  { name: 'mark-white', svg: markOnly(WHITE), size: 1024 },

  // Hero versions (bigger, higher quality marketing)
  { name: 'hero-navy-on-cream-2048', svg: flatIcon(CREAM, NAVY), size: 2048 },
  { name: 'hero-cream-on-navy-2048', svg: flatIcon(NAVY, CREAM), size: 2048 },
]

console.log('Generating PNG variants…')
for (const { name, svg, size } of variants) {
  const svgPath = join(OUT, `${name}.svg`)
  const pngPath = join(OUT, `${name}.png`)
  writeFileSync(svgPath, svg)
  await sharp(Buffer.from(svg), { density: 300 }).resize(size, size).png().toFile(pngPath)
  console.log(`  ✓ ${name}.png (${size}×${size})`)
}

// Horizontal logo (960x200, for sidebar / marketing)
console.log('\nGenerating horizontal logos…')
const hLogoLight = horizontalLogo(NAVY, NAVY)
const hLogoDark = horizontalLogo(WHITE, WHITE)
writeFileSync(join(OUT, 'logo-horizontal-light.svg'), hLogoLight)
writeFileSync(join(OUT, 'logo-horizontal-dark.svg'), hLogoDark)
await sharp(Buffer.from(hLogoLight)).resize(960, 200).png().toFile(join(OUT, 'logo-horizontal-light.png'))
await sharp(Buffer.from(hLogoDark)).resize(960, 200).png().toFile(join(OUT, 'logo-horizontal-dark.png'))
console.log('  ✓ logo-horizontal-light.svg/png')
console.log('  ✓ logo-horizontal-dark.svg/png')

// Use the AI-generated hero image as marketing asset (it's the exact picked design)
const aiSource = join(__dirname, 'nano-banana/knight-d-abstract/a3-single-notch.png')
if (existsSync(aiSource)) {
  copyFileSync(aiSource, join(OUT, 'marketing-hero-1024.png'))
  console.log('  ✓ marketing-hero-1024.png (AI-generated original)')
}

console.log(`\nAll files in: ${OUT}`)
