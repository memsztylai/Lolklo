// Android Web Speech stabilizer. Browser recognition can repeatedly emit a
// growing phrase as "final"; only settled, non-overlapping text is committed.
const tidy = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const words = value => tidy(value).split(' ').filter(Boolean);
const same = value => tidy(value).toLocaleLowerCase();

export function getUniqueSuffix(committed, incoming) {
  const base = tidy(committed), next = tidy(incoming);
  if (!next) return { text: '', join: '' };
  if (!base) return { text: next, join: '' };
  const b = same(base), n = same(next);
  if (b === n || b.endsWith(' ' + n) || b.endsWith(n)) return { text: '', join: '' };
  if (n.startsWith(b + ' ')) return { text: next.slice(base.length).trim(), join: ' ' };
  // Some Android implementations restart their result list from the beginning.
  // Compare token overlaps; do not depend on result indices or isFinal flags.
  const bw = words(base), nw = words(next);
  const normalizeToken = token => token.toLocaleLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
  let overlap = 0;
  for (let k = Math.min(bw.length, nw.length); k >= 1; k--) {
    // Require at least two shared words, except for a single long word.
    if (k === 1 && normalizeToken(nw[0]).length < 8) continue;
    let ok = true;
    for (let j = 0; j < k; j++) {
      if (normalizeToken(bw[bw.length-k+j]) !== normalizeToken(nw[j])) { ok = false; break; }
    }
    if (ok) { overlap = k; break; }
  }
  if (overlap > 0) return { text: nw.slice(overlap).join(' '), join: ' ' };
  // A recently repeated full result (already present in the stable tail).
  if (n.length >= 12 && b.slice(-Math.max(500, n.length + 30)).includes(n)) return { text: '', join: '' };
  return { text: next, join: '\n' };
}

export class AndroidTranscriptAccumulator {
  constructor(stableText = '') {
    this.stable = String(stableText || '');
    this.draft = '';
    this.draftJoin = '';
    this.draftStart = 0;
    this.lastFeedAt = 0;
  }
  feed(candidate, now = Date.now()) {
    const text = tidy(candidate);
    if (!text) return this.draft;
    const {text:delta,join} = getUniqueSuffix(this.stable, text);
    if (!delta) {
      // Do not remove the active draft if the provider briefly emits a stale
      // result from a preceding recognition event.
      if (this.draft && (same(this.draft).includes(same(text)) || same(text).includes(same(this.stable)))) {
        return this.draft;
      }
      return this.draft;
    }
    if (!this.draft) { this.draftStart = now; this.draftJoin = join; }
    // The provider can revise the same hypothesis while the user is speaking.
    // Keep its latest growing version rather than appending each revision.
    if (!this.draft || same(delta).startsWith(same(this.draft)) || same(delta) === same(this.draft)) {
      this.draft = delta;
    } else if (same(this.draft).startsWith(same(delta))) {
      // Earlier (shorter) revision: keep the longer hypothesis.
    } else {
      const overlap = getUniqueSuffix(this.draft, delta);
      if (overlap.join === ' ' && overlap.text) {
        this.draft = tidy(this.draft + ' ' + overlap.text);
      } else if (overlap.text && overlap.join === '\n') {
        // Corrections of a growing utterance often share their first 2 words.
        const a = words(this.draft), b = words(delta);
        const sharedStart = a.length >= 2 && b.length >= 2 && same(a.slice(0, 2).join(' ')) === same(b.slice(0, 2).join(' '));
        const norm = x => x.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
        let maxMatching = 0;
        for (let shift = -3; shift <= 3; shift++) {
          let matching = 0;
          for (let i = 0; i < a.length; i++) {
            const j = i + shift;
            if (j >= 0 && j < b.length && norm(a[i]) === norm(b[j])) matching++;
          }
          maxMatching = Math.max(maxMatching, matching);
        }
        const isRevision = Math.min(a.length, b.length) >= 4 && maxMatching / Math.min(a.length, b.length) >= 0.7;
        if (sharedStart || isRevision) this.draft = delta;
        else this.draft = tidy(this.draft + '\n' + delta);
      }
    }
    this.lastFeedAt = now;
    return this.draft;
  }
  commit() {
    const draft = tidy(this.draft);
    const originalJoin = this.draftJoin;
    this.draftJoin = '';
    this.draft = '';
    this.draftJoin = '';
    this.draftStart = 0;
    if (!draft) return {changed:false, added:'', text:this.stable};
    const {text,join} = getUniqueSuffix(this.stable, draft);
    if (!text) return {changed:false, added:'', text:this.stable};
    this.stable += (this.stable ? (join === '\n' && originalJoin === ' ' ? ' ' : join) : '') + text;
    return {changed:true, added:text, text:this.stable};
  }
  reset(stableText = '') { this.stable = String(stableText || ''); this.draft=''; this.draftJoin=''; this.draftStart=0;this.lastFeedAt=0; }
}
