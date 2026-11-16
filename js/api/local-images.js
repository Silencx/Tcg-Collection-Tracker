// =============================================================================
// local-images.js — card images we host ourselves, for cards no public CDN has.
//
// WHY: 11 of the 21 Japanese sets in JP_BULBA_SET_MAP have no Limitless code, so every
// card in them renders as a placeholder. tools/build-images.mjs fills exactly those
// gaps (today from PokéWallet) into img/, and records each file in data/img-index.json.
//
// LAYOUT — keyed on OUR identifiers, never the source's, so a source can change its ids
// (or be swapped for another) without moving a file:
//   img/jp/{setKey}/{numKey}-{size}.{ext}        e.g. img/jp/miracle-of-the-desert/1-low.jpg
//   data/img-index.json  { schemaVersion, builtAt, images: { "jp/miracle-of-the-desert/1":
//                          { sizes: { low: "jpg" }, source, fetched, unavailable? } } }
// `unavailable` lists sizes the source answered 404 for: it lists the card but has no
// scan. The build skips those instead of paying for the same 404 every run; delete the
// entry to ask again.
// `{setKey}/{numKey}` is the card's stable identity from api/jp-model.js — the same two
// parts as its checklist id JP_{setKey}_{numKey}. Sizes: `low` for the grid, `high` for
// the preview — the same split as TCGdex's low.webp / high.png.
//
// The manifest is what makes this cheap: the app knows which tiles have a local file
// without probing for 404s, the build only downloads what is missing, and every file
// carries its `source`, so all of one source's images can be removed in one pass.
//
// Pure apart from loadImageIndex(), which is the one fetch, and is safe to call when the
// manifest does not exist (a fork or local checkout without images — see README).
// =============================================================================

export const IMAGE_SIZES = ['low', 'high'];

/** "Miracle of the Desert" → "miracle-of-the-desert"; accents folded, never empty. */
export function setSlug(name) {
  const s = String(name || '').normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s || 'set';
}

/** "001/053" → "1", "229/SM-P" → "229", "TG01/TG30" → "TG01". */
export function cardNumber(jpnum) {
  const head = String(jpnum || '').split('/')[0].trim();
  const n = parseInt(head, 10);
  return /^\d+$/.test(head) && !Number.isNaN(n) ? String(n) : head.toUpperCase();
}

/** Site-root-relative file path for one size of one key. */
export function imagePath(key, size, ext = 'jpg') {
  return `img/${key}-${size}.${ext}`;
}

/**
 * The file for `key` at `size`, or null. Falls back to the other size rather than to
 * nothing: a low-only entry still beats a placeholder in the preview, and vice versa.
 * @param {object|null} index parsed data/img-index.json
 */
export function lookupImage(index, key, size) {
  const e = index?.images?.[key];
  if (!e || !e.sizes) return null;
  const order = size === 'high' ? ['high', 'low'] : ['low', 'high'];
  for (const s of order) if (e.sizes[s]) return imagePath(key, s, e.sizes[s]);
  return null;
}

/**
 * Of `sizes`, the ones the build should still download for one manifest entry: not
 * recorded, or recorded but the file is gone. Sizes the source has no scan for are skipped.
 * @param {object|undefined} entry  manifest entry
 * @param {string[]} sizes
 * @param {(size:string, ext:string) => boolean} fileExists
 */
export function sizesToFetch(entry, sizes, fileExists) {
  return sizes.filter(s => !entry?.unavailable?.includes(s)
    && (!entry?.sizes?.[s] || !fileExists(s, entry.sizes[s])));
}

/** An empty, valid manifest. */
export function emptyIndex() {
  return { schemaVersion: 1, builtAt: null, images: {} };
}

/**
 * The manifest as published: keys sorted, one entry per line, and only the fields named
 * here. Every Master Set visitor downloads it, so it stays lean, and a field like the
 * source's own card id (which the build keeps in its gitignored catalogue) can never ride
 * along into a public file.
 * @param {object} index { images: { key: { sizes, source, fetched, unavailable?, … } } }
 * @param {string} builtAt
 */
export function serializeIndex(index, builtAt) {
  const lines = Object.keys(index?.images || {}).sort().map(k => {
    const { sizes, source, fetched, unavailable } = index.images[k];
    const entry = { sizes, source, fetched, ...(unavailable?.length && { unavailable }) };
    return `${JSON.stringify(k)}:${JSON.stringify(entry)}`;
  });
  return `{"schemaVersion":1,"builtAt":${JSON.stringify(builtAt)},"images":{\n${lines.join(',\n')}\n}}\n`;
}

// ── browser side ─────────────────────────────────────────────────────────────
// Site root, from js/api/local-images.js. Paths in the manifest are root-relative.
const SITE_ROOT = new URL('../../', import.meta.url);
let loading = null;
let loaded = null;

/**
 * Fetch data/img-index.json once per session. Resolves to an empty index — never
 * rejects — when the file is missing or unreadable, so callers can always await it.
 */
export function loadImageIndex() {
  if (!loading) {
    loading = fetch(new URL('data/img-index.json', SITE_ROOT), { cache: 'no-cache' })
      .then(r => (r.ok ? r.json() : emptyIndex()))
      .catch(() => emptyIndex())
      .then(idx => (loaded = (idx && typeof idx.images === 'object') ? idx : emptyIndex()));
  }
  return loading;
}

/**
 * Absolute URL of a hosted image by manifest key (jp-model.jpImageKeyFor), or null.
 * Synchronous: reads the index loadImageIndex() has already resolved, null before that.
 */
export function localImage(key, size = 'low') {
  const p = lookupImage(loaded, key, size);
  return p ? new URL(p, SITE_ROOT).href : null;
}
