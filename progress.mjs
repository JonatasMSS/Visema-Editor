import fs from 'node:fs/promises';

// Registro dos segmentos já concluídos, em JSON: {"done": {"segmento_00001": "<ISO>"}}.
// O arquivo é lido a cada consulta (é pequeno e pode ser editado à mão) e as gravações
// são serializadas e atômicas (arquivo temporário + rename).
export function createProgressStore(file) {
  let queue = Promise.resolve();

  async function load() {
    let raw;
    try {
      raw = await fs.readFile(file, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') return {};
      throw error;
    }
    try {
      const data = JSON.parse(raw);
      return data && typeof data.done === 'object' && !Array.isArray(data.done) ? {...data.done} : {};
    } catch {
      // Não sobrescreve um arquivo corrompido: o progresso salvo nele seria perdido.
      throw new Error(`O arquivo de progresso ${file} está corrompido. Corrija ou remova-o.`);
    }
  }

  function setDone(id, done) {
    const run = queue.then(async () => {
      const current = await load();
      if (done) current[id] ??= new Date().toISOString();
      else delete current[id];
      const temporary = `${file}.${process.pid}.tmp`;
      await fs.writeFile(temporary, `${JSON.stringify({done: current}, null, 2)}\n`, 'utf8');
      await fs.rename(temporary, file);
      return current[id] ?? null;
    });
    queue = run.catch(() => {});
    return run;
  }

  return {load, setDone};
}
