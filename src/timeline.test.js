import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSegments,
  deleteLeftRange,
  deleteRightRange,
  formatTimecode,
  frameAtTime,
  keptFrames,
  playableFrame,
  removeFrames,
  rulerSteps,
  seekTimeForFrame,
  splitAt,
  tickLabel,
  toTimeRanges,
} from './timeline.js';

const spans = (segments) => segments.map(({start, end}) => [start, end]);

test('o tempo de busca de cada quadro volta exatamente para o mesmo quadro', () => {
  for (const fps of [24, 25, 30000 / 1001, 30, 50, 60]) {
    for (let frame = 0; frame < 3000; frame += 1) {
      for (const offset of [0.5, 0.02]) {
        assert.equal(frameAtTime(seekTimeForFrame(frame, fps, offset), fps), frame, `fps ${fps}, offset ${offset}, quadro ${frame}`);
      }
      assert.equal(frameAtTime(frame / fps, fps), frame, `fronteira do quadro ${frame} a ${fps} fps`);
    }
  }
});

test('timecode no formato MM:SS:QQ', () => {
  assert.equal(formatTimecode(0, 25), '00:00:00');
  assert.equal(formatTimecode(37, 25), '00:01:12');
  assert.equal(formatTimecode(25 * 61 + 24, 25), '01:01:24');
  assert.equal(formatTimecode(592, 25), '00:23:17');
});

test('dividir no cursor cria dois blocos e o quadro atual fica no da direita', () => {
  const [whole] = createSegments(100);
  const split = splitAt([whole], 40);
  assert.deepEqual(spans(split), [[0, 40], [40, 100]]);
  assert.equal(split[0].id, whole.id);
  assert.notEqual(split[1].id, whole.id);
  assert.equal(splitAt(split, 40), null, 'não divide de novo na mesma fronteira');
  assert.equal(splitAt(split, 100), null, 'não divide fora dos blocos');
  assert.equal(keptFrames(split), 100);
});

test('excluir à esquerda e à direita do cursor', () => {
  const segments = splitAt(createSegments(100), 40);
  const left = deleteLeftRange(segments, 55);
  assert.deepEqual(left, {start: 40, end: 55});
  assert.deepEqual(spans(removeFrames(segments, left.start, left.end)), [[0, 40], [55, 100]]);
  assert.equal(deleteLeftRange(segments, 40), null, 'nada a remover no primeiro quadro do bloco');

  const right = deleteRightRange(segments, 55);
  assert.deepEqual(right, {start: 55, end: 100});
  assert.deepEqual(spans(removeFrames(segments, right.start, right.end)), [[0, 40], [40, 55]]);
});

test('remover preserva divisões e o id do pedaço remanescente', () => {
  const segments = splitAt(createSegments(100), 50);
  const trimmed = removeFrames(segments, 45, 60);
  assert.deepEqual(spans(trimmed), [[0, 45], [60, 100]]);
  assert.equal(trimmed[0].id, segments[0].id);
  assert.equal(trimmed[1].id, segments[1].id);

  const hole = removeFrames(createSegments(100), 10, 20);
  assert.deepEqual(spans(hole), [[0, 10], [20, 100]]);
  assert.notEqual(hole[0].id, hole[1].id);

  const selected = segments[1];
  assert.deepEqual(spans(removeFrames(segments, selected.start, selected.end)), [[0, 50]]);
});

test('intervalos em segundos fundem blocos adjacentes e respeitam quadros', () => {
  const segments = removeFrames(splitAt(createSegments(592), 100), 300, 337);
  assert.deepEqual(toTimeRanges(segments, 25), [{start: 0, end: 12}, {start: 13.48, end: 23.68}]);
});

test('quadro reproduzível pula trechos removidos', () => {
  const segments = removeFrames(createSegments(100), 20, 30);
  assert.equal(playableFrame(segments, 10), 10);
  assert.equal(playableFrame(segments, 25), 30);
  assert.equal(playableFrame(removeFrames(segments, 90, 100), 95), 0);
});

test('régua escolhe passos legíveis e rótulos em segundos ou quadros', () => {
  assert.deepEqual(rulerSteps(1.6, 25), {major: 50, minor: 5});
  assert.deepEqual(rulerSteps(30, 25), {major: 5, minor: 1});
  assert.equal(tickLabel(125, 25), '00:05');
  assert.equal(tickLabel(130, 25), '5f');
});
