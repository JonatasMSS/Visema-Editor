import test from 'node:test';
import assert from 'node:assert/strict';
import {removeTranscriptForRange, subtractRange} from './editor.js';

test('remove um intervalo da mídia e as palavras proporcionais', () => {
  const ranges = subtractRange([{start: 0, end: 10}], 4, 6);
  assert.deepEqual(ranges, [{start: 0, end: 4}, {start: 6, end: 10}]);
  assert.equal(
    removeTranscriptForRange('um dois três quatro cinco seis sete oito nove dez', [{start: 0, end: 10}], 4, 6),
    'um dois três quatro sete oito nove dez',
  );
});
