import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createProgressStore} from './progress.mjs';

async function tempFile() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'visema-progress-'));
  return path.join(dir, '.progress.json');
}

test('marca, preserva a data original e desmarca segmentos', async () => {
  const file = await tempFile();
  const store = createProgressStore(file);
  assert.deepEqual(await store.load(), {});

  const doneAt = await store.setDone('segmento_00001', true);
  assert.match(doneAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(await store.setDone('segmento_00001', true), doneAt, 'remarcar não altera a data');
  assert.deepEqual(Object.keys(await store.load()), ['segmento_00001']);

  assert.equal(await store.setDone('segmento_00001', false), null);
  assert.deepEqual(await store.load(), {});
});

test('gravações simultâneas não se perdem', async () => {
  const file = await tempFile();
  const store = createProgressStore(file);
  const ids = Array.from({length: 25}, (_, index) => `segmento_${String(index).padStart(5, '0')}`);
  await Promise.all(ids.map((id) => store.setDone(id, true)));
  assert.equal(Object.keys(await store.load()).length, 25);
});

test('não sobrescreve um arquivo corrompido', async () => {
  const file = await tempFile();
  await fs.writeFile(file, '{ inválido');
  const store = createProgressStore(file);
  await assert.rejects(store.setDone('segmento_00001', true), /corrompido/);
  assert.equal(await fs.readFile(file, 'utf8'), '{ inválido');
});
