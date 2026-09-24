# Visema Studio

Editor local para os trios `segmento_XXXXX.mp4`, `.wav` e `.txt` em `dataset_root/ptbr`.

## Executar

Requisitos: Node.js 20+ e FFmpeg/FFprobe disponíveis no `PATH`.

```powershell
npm install
npm run dev
```

Abra `http://localhost:4173`.

## Comportamento

- O preview reproduz MP4 e WAV sincronizados.
- Um intervalo removido é cortado dos dois arquivos; as palavras correspondentes são removidas proporcionalmente do TXT.
- Ao salvar, os três arquivos mantêm o nome original. A versão anterior fica em `dataset_root/.history`.
- Excluir um clipe remove o trio e guarda uma cópia recuperável em `dataset_root/.trash`.
- Para usar outro dataset, defina `DATASET_ROOT` antes de iniciar o servidor.
