import {SentencePieceProcessor} from '@sctg/sentencepiece-js';
import fs from 'node:fs/promises';
import path from 'node:path';

// Etapas finais de normalizar_texto do notebook de preparação: sem caracteres de formatação,
// NFC, espaços colapsados e maiúsculas, como o corpus em que o SentencePiece foi treinado.
export function normalizeTranscript(text) {
  return String(text).replace(/\p{Cf}/gu, '').normalize('NFC').replace(/\s+/gu, ' ').trim().toUpperCase();
}

// Reproduz o TextTransform do Auto-AVSR: as peças do SentencePiece viram os IDs do _units.txt
// (1 = <unk>), que são os gravados na quarta coluna dos CSVs.
export async function loadTokenizer({model, units}) {
  const [modelData, unitsData] = await Promise.all([fs.readFile(model), fs.readFile(units, 'utf8')]);
  const processor = new SentencePieceProcessor();
  await processor.loadFromB64StringModel(modelData.toString('base64'));
  const ids = new Map(unitsData.split(/\r?\n/u).filter((line) => line.trim()).map((line) => {
    const parts = line.trim().split(/\s+/u);
    return [parts[0], parts.at(-1)];
  }));
  const unknown = ids.get('<unk>');
  if (!unknown) throw new Error(`${units} não define <unk>.`);
  return (text) => processor.encodePieces(text).map((piece) => ids.get(piece) ?? unknown).join(' ');
}

// Linha dos CSVs (sem cabeçalho): dataset, caminho relativo do MP4, nº de quadros, IDs.
export const parseRow = (line) => {
  const fields = line.split(',');
  return fields.length === 4 ? fields : null;
};

export async function readCsv(file) {
  const content = await fs.readFile(file, 'utf8');
  return content.split(/\r?\n/u).filter(Boolean);
}

export async function writeCsv(file, lines) {
  const temporary = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temporary, lines.length ? `${lines.join('\n')}\n` : '', 'utf8');
  await fs.rename(temporary, file);
}

export async function csvFiles(dir) {
  try {
    return (await fs.readdir(dir)).filter((name) => name.endsWith('.csv')).sort().map((name) => path.join(dir, name));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

// Mantém a linha de cada segmento nos CSVs de labels. O split (treino/val/teste) é o do CSV
// em que a linha já está; um segmento ausente de todos eles não é adicionado.
// As gravações são serializadas e atômicas, como no registro de progresso.
export function createLabelsStore(dir, {folder}) {
  let queue = Promise.resolve();
  const relative = (id) => `${folder}/${id}.mp4`;

  async function find(id) {
    for (const file of await csvFiles(dir)) {
      const lines = await readCsv(file);
      const index = lines.findIndex((line) => parseRow(line)?.[1] === relative(id));
      if (index >= 0) return {file, lines, index, line: lines[index]};
    }
    return null;
  }

  // Devolve a linha anterior, ou null quando o segmento não está em nenhum CSV.
  function edit(id, change) {
    const run = queue.then(async () => {
      const found = await find(id);
      if (!found) return null;
      const next = change(parseRow(found.line));
      if (next) found.lines[found.index] = next.join(',');
      else found.lines.splice(found.index, 1);
      await writeCsv(found.file, found.lines);
      return {file: found.file, line: found.line};
    });
    queue = run.catch(() => {});
    return run;
  }

  return {
    async find(id) {
      const found = await find(id);
      return found && {file: found.file, line: found.line};
    },
    update: (id, {frames, tokens}) => edit(id, ([dataset, rel]) => [dataset, rel, String(frames), tokens]),
    remove: (id) => edit(id, () => null),
  };
}
