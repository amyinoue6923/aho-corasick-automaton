/**
 * Aho-Corasick automaton.
 *
 * Implements the classic algorithm for searching an input text for many
 * fixed string patterns in a single left-to-right pass. The automaton is
 * built once (O(sum of pattern lengths) in time and states) and reused
 * across any number of searches.
 *
 * Output semantics (chosen deliberately, documented here so callers can rely
 * on them):
 *
 *   - `search(text)` yields the patterns found at each *ending* position in
 *     `text`, in ascending order of end index. Within a single end index,
 *     patterns are ordered by the order their dict links were first reached
 *     during the traversal — which, for non-overlapping equal-length hits,
 *     reduces to insertion order of the patterns. This ordering is stable for
 *     a given automaton but callers should not read into the within-position
 *     order beyond "it is deterministic".
 *   - `findAll(text)` returns a flat, end-index-sorted array of
 *     `{ pattern, startIndex, endIndex }`.
 *   - Patterns are matched as plain UTF-16 code units (JavaScript string
 *     semantics). Code points outside the BMP that are stored as a surrogate
 *     pair will only match if the pattern contains the identical surrogate
 *     pair. We do not normalise the input; callers who care about
 *     normalisation should do it before constructing the automaton.
 *
 * Why a class and not a function returning closures: the build step is the
 * expensive part (constructing goto + failure + output links). Encapsulating
 * it in a class makes "build once, query many" obvious at the call site and
 * lets the engine be passed around without rebuilding.
 */
export class AhoCorasick {
  /**
   * @param {string[]} patterns Patterns to search for. The empty string is
   *   silently skipped — it would match at every position and every caller
   *   we have ever seen treats that as a bug rather than a feature.
   */
  constructor(patterns) {
    if (!Array.isArray(patterns)) {
      throw new TypeError('patterns must be an array of strings');
    }
    for (let i = 0; i < patterns.length; i++) {
      if (typeof patterns[i] !== 'string') {
        throw new TypeError(`patterns[${i}] must be a string`);
      }
    }

    // Each state is a Map<charCode, nextState>. A Map keyed on numeric
    // char codes beats a plain object here: it avoids collision with
    // inherited prototype properties (e.g. a pattern containing 'constructor'
    // or '__proto__' as successive chars) and keeps lookups O(1) average.
    /** @type {Map<number, number>[]} */
    this.goto = [new Map()];
    /** @type {number[]} */
    this.fail = [0];
    /** @type {number[][]} */
    this.out = [[]];

    this._patternStrings = [];
    this._patternLengths = [];
    for (const p of patterns) {
      if (p.length === 0) continue;
      this._insert(p);
    }

    this._buildFailureLinks();
  }

  /**
   * Insert one pattern into the goto trie, recording its terminal state.
   * @param {string} pattern
   * @private
   */
  _insert(pattern) {
    let state = 0;
    for (let i = 0; i < pattern.length; i++) {
      const c = pattern.charCodeAt(i);
      let next = this.goto[state].get(c);
      if (next === undefined) {
        next = this.goto.length;
        this.goto.push(new Map());
        this.fail.push(0);
        this.out.push([]);
        this.goto[state].set(c, next);
      }
      state = next;
    }
    this.out[state].push(this._patternStrings.length);
    this._patternStrings.push(pattern);
    this._patternLengths.push(pattern.length);
  }

  /**
   * Build failure links via breadth-first traversal of the trie.
   *
   * For the root, all missing transitions are self-loops back to the root;
   * this is what makes the automaton consume one character per step and
   * never get "stuck". For deeper states the failure link points to the
   * longest proper suffix of the current path that is also a trie prefix.
   * Output links are propagated so a state implicitly contains all patterns
   * that are suffixes of the string it spells.
   * @private
   */
  _buildFailureLinks() {
    const queue = [];
    for (const c of this.goto[0].keys()) {
      const s = this.goto[0].get(c);
      this.fail[s] = 0;
      queue.push(s);
    }
    let head = 0;
    while (head < queue.length) {
      const r = queue[head++];
      for (const c of this.goto[r].keys()) {
        const u = this.goto[r].get(c);
        queue.push(u);
        let f = this.fail[r];
        // Root's missing edges are self-loops: a lookup that misses at the
        // root returns 0, so the loop below terminates at depth 1 at latest.
        while (f !== 0 && !this.goto[f].has(c)) {
          f = this.fail[f];
        }
        const fNext = this.goto[f].get(c);
        this.fail[u] = fNext === undefined || fNext === u ? 0 : fNext;
        // Inherit outputs along the failure chain (suffix-closed output set).
        const inherited = this.out[this.fail[u]];
        if (inherited.length) {
          this.out[u] = this.out[u].concat(inherited);
        }
      }
    }
  }

  /**
   * Walk one character from `state`, following failure links as needed.
   * Exposed for callers that want manual control of the traversal (e.g.
   * streaming); most callers should use {@link search} or {@link findAll}.
   * @param {number} state Current automaton state.
   * @param {string} ch    Next character to consume.
   * @returns {number} The next state.
   */
  step(state, ch) {
    if (typeof ch !== 'string' || ch.length === 0) {
      throw new TypeError('ch must be a single character');
    }
    const c = ch.charCodeAt(0);
    let s = state;
    while (s !== 0 && !this.goto[s].has(c)) {
      s = this.fail[s];
    }
    const next = this.goto[s].get(c);
    return next === undefined ? 0 : next;
  }

  /**
   * Iterate over matches in `text`, yielding one array per position at which
   * at least one pattern ends. Each array contains the pattern strings.
   * Arrays are ordered by ascending end index within `text`.
   *
   * @param {string} text
   * @returns {Generator<{ endIndex: number, patterns: string[] }, void, unknown>}
   */
  *search(text) {
    if (typeof text !== 'string') {
      throw new TypeError('text must be a string');
    }
    let state = 0;
    for (let i = 0; i < text.length; i++) {
      state = this.step(state, text[i]);
      const ids = this.out[state];
      if (ids.length === 0) continue;
      const patterns = new Array(ids.length);
      for (let k = 0; k < ids.length; k++) {
        patterns[k] = this._patternStrings[ids[k]];
      }
      yield { endIndex: i, patterns };
    }
  }

  /**
   * Convenience wrapper around {@link search} returning a flat array of
   * matches sorted by end index (and within a shared end index, by the
   * order patterns were discovered at that state).
   * @param {string} text
   * @returns {{ pattern: string, startIndex: number, endIndex: number }[]}
   */
  findAll(text) {
    const results = [];
    for (const { endIndex, patterns } of this.search(text)) {
      for (let k = 0; k < patterns.length; k++) {
        const p = patterns[k];
        results.push({
          pattern: p,
          startIndex: endIndex - p.length + 1,
          endIndex,
        });
      }
    }
    return results;
  }
}
