import { test } from 'node:test';
import assert from 'node:assert/strict';

import { AhoCorasick } from '../src/index.js';

/** Flatten findAll results to a string for compact, deterministic asserts. */
function flat(ac, text) {
  return ac.findAll(text)
    .map(m => `${m.startIndex}:${m.endIndex}:${m.pattern}`)
    .join('|');
}

test('single pattern: finds every non-overlapping occurrence', () => {
  const ac = new AhoCorasick(['ab']);
  assert.equal(flat(ac, 'ababab'), '0:1:ab|2:3:ab|4:5:ab');
  assert.equal(flat(ac, 'aaaa'), '');
  assert.equal(flat(ac, ''), '');
});

test('overlapping occurrences are reported independently', () => {
  // 'aba' overlaps itself by one char: aba-ba vs a-baba
  const ac = new AhoCorasick(['aba']);
  assert.equal(flat(ac, 'ababa'), '0:2:aba|2:4:aba');
});

test('multiple distinct patterns, no shared prefix', () => {
  const ac = new AhoCorasick(['cat', 'dog', 'bird']);
  assert.equal(flat(ac, 'a cat and a dog'), '2:4:cat|12:14:dog');
});

test('shared prefix is handled without losing the longer match', () => {
  // 'he' is a prefix of 'hello' and also of 'help'; both may fire.
  const ac = new AhoCorasick(['he', 'hello', 'help']);
  assert.equal(flat(ac, 'hello'), '0:1:he|0:4:hello');
  assert.equal(flat(ac, 'help me'), '0:1:he|0:3:help');
});

test('suffix pattern fires via failure links', () => {
  // 'pin' is a suffix of 'spin'; the failure link from the 'n' state of
  // 'spin' must reach the 'n' state of 'pin' so both match at 'spin'.
  const ac = new AhoCorasick(['spin', 'pin']);
  assert.equal(flat(ac, 'spin'), '0:3:spin|1:3:pin');
});

test('empty input and empty patterns behave predictably', () => {
  const ac = new AhoCorasick(['x', '']);
  // Empty string is silently skipped by the constructor.
  assert.equal(flat(ac, 'xxx'), '0:0:x|1:1:x|2:2:x');
  assert.equal(flat(ac, ''), '');
});

test('duplicate patterns are each reported', () => {
  const ac = new AhoCorasick(['ab', 'ab']);
  const res = ac.findAll('ab');
  assert.equal(res.length, 2);
  assert.deepEqual(res.map(m => m.pattern), ['ab', 'ab']);
});

test('case sensitivity is exact (no folding)', () => {
  // 'Ab' (not 'AB') appears once in 'abABAb' at index 4-5.
  const ac = new AhoCorasick(['Ab']);
  assert.equal(flat(ac, 'abABAb'), '4:5:Ab');
});

test('UTF-16 code-unit matching: BMP and astral', () => {
  // U+1F4A9 is two code units in JS. Matching is on code units, so a
  // pattern that contains the full surrogate pair matches correctly.
  const ac = new AhoCorasick(['\uD83D\uDCA9']);
  assert.equal(flat(ac, 'x\uD83D\uDCA9y'), '1:2:\uD83D\uDCA9');
});

test('patterns containing prototype-poisonous substrings are safe', () => {
  // Using Map<charCode,...> keyed on numbers avoids the 'constructor' /
  // '__proto__' trap that plain objects fall into.
  const ac = new AhoCorasick(['constructor', '__proto__']);
  assert.equal(flat(ac, 'a constructor here'), '2:12:constructor');
});

test('findAll preserves end-index order across interleaved patterns', () => {
  const ac = new AhoCorasick(['a', 'ba']);
  // 'aba': a@0, then 'ba' and 'a' both end at index 2.
  assert.deepEqual(
    ac.findAll('aba').map(m => m.endIndex),
    [0, 2, 2],
  );
});

test('rejects non-array / non-string inputs at construction', () => {
  assert.throws(() => new AhoCorasick('ab'), TypeError);
  assert.throws(() => new AhoCorasick([42]), TypeError);
});

test('search rejects non-string text and yields nothing for empty patterns', () => {
  const ac = new AhoCorasick(['ab']);
  assert.throws(() => ac.search(42).next(), TypeError);
  const empty = new AhoCorasick([]);
  assert.deepEqual(empty.findAll('anything'), []);
});

test('step exposes the automaton state for streaming use', () => {
  const ac = new AhoCorasick(['ab']);
  let s = 0;
  s = ac.step(s, 'a');
  assert.equal(s, 1); // matched 'a'
  s = ac.step(s, 'b');
  assert.equal(s, 2); // matched 'ab', state with output
  s = ac.step(s, 'x'); // failure back to root
  assert.equal(s, 0);
});
