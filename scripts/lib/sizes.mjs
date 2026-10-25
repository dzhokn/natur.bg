// Phone viewport the responsive-image rules are evaluated at (Lighthouse mobile emulation: 412 px, DPR 1.75).
export const PHONE_VW = 412;
// Lighthouse image-size-responsive: natural width >= ceil(0.75 * 1.5 * displayed) for DPR 1.5-1.99.
export const LO_RATIO = 1.125;

export const round10 = (n) => Math.round(n / 10) * 10;
export const ceil10 = (n) => Math.ceil(n / 10) * 10;

const inMedia = (cond, vw) => {
  const m = cond.match(/^\((max|min)-width:\s*([\d.]+)px\)$/);
  return !!m && (m[1] === 'max' ? vw <= Number(m[2]) : vw >= Number(m[2]));
};

// CSS width a `sizes` list resolves to at `vw`: first entry whose media matches. Handles Npx, Nvw,
// calc(100vw - Npx) and min(100vw, Npx).
export function phoneWidth(sizes, vw = PHONE_VW) {
  for (const entry of sizes.split(/,(?![^(]*\))/)) {
    const m = entry.trim().match(/^(\(.+?\))?\s*(.+)$/);
    if (m[1] && !inMedia(m[1], vw)) continue;
    const v = m[2];
    let r;
    if ((r = v.match(/^([\d.]+)px$/))) return Number(r[1]);
    if ((r = v.match(/^([\d.]+)vw$/))) return (Number(r[1]) / 100) * vw;
    if ((r = v.match(/^calc\(100vw - ([\d.]+)px\)$/))) return vw - Number(r[1]);
    if ((r = v.match(/^min\(100vw, ([\d.]+)px\)$/))) return Math.min(vw, Number(r[1]));
  }
  throw new Error(`cannot resolve sizes "${sizes}"`);
}
