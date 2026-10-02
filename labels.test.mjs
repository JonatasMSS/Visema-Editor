import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {tokenizerFiles} from './config.mjs';
import {createLabelsStore, loadTokenizer, normalizeTranscript, readCsv} from './labels.mjs';

const row = (id, frames = '500', tokens = '7 8 9') => `ptbr,ptbr_video_seg24s/${id}.mp4,${frames},${tokens}`;

async function tempLabels(files) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'visema-labels-'));
  for (const [name, lines] of Object.entries(files)) {
    await fs.writeFile(path.join(dir, name), `${lines.join('\n')}\n`, 'utf8');
  }
  return dir;
}

test('normaliza a transcrição como o notebook de preparação', () => {
  assert.equal(normalizeTranscript('  olá,\n\tmundo\u200b  '), 'OLÁ, MUNDO');
  assert.equal(normalizeTranscript('a\u0301gua'), 'ÁGUA', 'compõe acentos em NFC');
});

test('reproduz os IDs gravados no CSV original', async () => {
  const tokenize = await loadTokenizer(tokenizerFiles);
  // Início do segmento_01501 e de sua linha no CSV, gerada pelo TextTransform do Auto-AVSR.
  assert.equal(
    tokenize('POIS ACHEI UM CANTO BEM AGRADÁVEL E BONITO, APESAR DE EU NÃO TER ENTENDIDO NADA.'),
    '1777 6 808 33 9 1359 153 3653 8 1446 3 3887 5 28 14 194 2989 35 195 2',
  );
});

test('atualiza e remove apenas a linha do segmento, no CSV em que ela está', async () => {
  const dir = await tempLabels({
    'ptbr_train_transcript_lengths_seg24s.csv': [row('segmento_00001'), row('segmento_00002')],
    'ptbr_val_transcript_lengths_seg24s.csv': [row('segmento_00003')],
  });
  const store = createLabelsStore(dir, {folder: 'ptbr_video_seg24s'});
  const train = path.join(dir, 'ptbr_train_transcript_lengths_seg24s.csv');
  const val = path.join(dir, 'ptbr_val_transcript_lengths_seg24s.csv');

  const previous = await store.update('segmento_00002', {frames: 321, tokens: '1 2 3'});
  assert.deepEqual(previous, {file: train, line: row('segmento_00002')});
  assert.deepEqual(await readCsv(train), [row('segmento_00001'), row('segmento_00002', '321', '1 2 3')]);

  assert.deepEqual(await store.remove('segmento_00003'), {file: val, line: row('segmento_00003')});
  assert.deepEqual(await readCsv(val), []);
  assert.equal(await store.find('segmento_00003'), null);
  assert.equal(await store.update('segmento_00099', {frames: 1, tokens: '1'}), null, 'não cria linhas novas');
});

test('gravações simultâneas no mesmo CSV não se perdem', async () => {
  const ids = Array.from({length: 20}, (_, index) => `segmento_${String(index).padStart(5, '0')}`);
  const dir = await tempLabels({'ptbr_train_transcript_lengths_seg24s.csv': ids.map((id) => row(id))});
  const store = createLabelsStore(dir, {folder: 'ptbr_video_seg24s'});
  await Promise.all(ids.map((id, index) => index % 2
    ? store.remove(id)
    : store.update(id, {frames: index, tokens: String(index)})));
  const lines = await readCsv(path.join(dir, 'ptbr_train_transcript_lengths_seg24s.csv'));
  assert.deepEqual(lines, ids.flatMap((id, index) => index % 2 ? [] : [row(id, String(index), String(index))]));
});
