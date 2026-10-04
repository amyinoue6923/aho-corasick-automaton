# aho-corasick

A small Aho-Corasick automaton for searching a text for many fixed string
patterns in a single left-to-right pass. Build the automaton once, query any
number of texts.

```js
import { AhoCorasick } from './src/index.js';

const ac = new AhoCorasick(['cat', 'dog', 'bird']);
for (const { endIndex, patterns } of ac.search('I saw a cat and a dog')) {
  console.log(endIndex, patterns); // 8 ['cat']  then  18 ['dog']
}
// or a flat array:
ac.findAll('I saw a cat and a dog');
// => [{ pattern: 'cat', startIndex: 7, endIndex: 9 },
//     { pattern: 'dog', startIndex: 17, endIndex: 19 }]
```

## Why

When you need to find several literal strings inside the same body of text,
running `String.prototype.indexOf` once per pattern is O(P * N). Aho-Corasick
builds a trie with failure links in O(sum of pattern lengths) and then scans
the text once in O(N + matches), which is the right call when the pattern
set is large or reused across many documents.

The trade-off: the automaton holds its own copy of every pattern plus a
per-state transition map, so memory is roughly proportional to the total
length of the patterns. For a handful of short needles, plain `indexOf` in a
loop is simpler and faster.

## Edge you will hit

- **Empty patterns are skipped silently.** They would match at every position
  in the text, which in practice is always a caller bug. If you need to
  detect empty input, check it yourself before constructing the automaton.
- **Matching is by UTF-16 code unit.** A pattern containing one half of a
  surrogate pair (e.g. a lone high surrogate from an astral code point) will
  match that lone code unit in the text. To match whole astral characters,
  include the full surrogate pair in the pattern.
- **No case folding or normalisation.** `'Ab'` and `'ab'` are different
  patterns. Normalise both your patterns and your text up front if you need
  case-insensitive or Unicode-normalised matching.
- **Overlapping matches are reported independently.** Searching for `'aba'`
  in `'ababa'` yields two matches ending at indices 2 and 4.

## Exports

- `AhoCorasick` (named export, no default export)
  - `new AhoCorasick(patterns: string[])`
  - `search(text: string): Generator<{ endIndex: number, patterns: string[] }>`
  - `findAll(text: string): { pattern: string, startIndex: number, endIndex: number }[]`
  - `step(state: number, ch: string): number` — single-character transition,
    exposed for streaming consumption of input.
