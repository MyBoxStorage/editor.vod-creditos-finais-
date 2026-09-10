# Twitch Clip Editor

Pipeline local para transformar VOD da Twitch em clipes: download, transcrição, detecção de highlights, corte/crop, legendas e editor visual.

## Pré-requisitos

- Node.js 18+
- **yt-dlp** instalado e no PATH (`yt-dlp --version`) — usado por `POST /vod/ingest`
- ffmpeg (no PATH)
- Python 3.10+ com `faster-whisper` (`pip install faster-whisper`)
- Chave da API Claude (a partir do Sprint 4)
- Fonte **Anton** em `backend/assets/fonts/Anton-Regular.ttf` (já inclusa no repo; o ffmpeg usa `fontsdir` apontando para essa pasta)

### Detecção de risada (Mega-Gorilla/laughter-detection)

Usamos o fork [Mega-Gorilla/laughter-detection](https://github.com/Mega-Gorilla/laughter-detection) (compatível com Python 3.11; fork de `jrgillick/laughter-detection`).

Instale **manualmente** (não rode automaticamente pelo agente):

```powershell
cd $env:USERPROFILE\Desktop\Projetos
git clone https://github.com/Mega-Gorilla/laughter-detection.git
cd laughter-detection
pip install -r requirements.txt
```

Depois configure a variável de ambiente apontando para a raiz do clone:

```powershell
# sessão atual
$env:LAUGHTER_DETECTION_ROOT = "$env:USERPROFILE\Desktop\Projetos\laughter-detection"

# permanente (User)
[System.Environment]::SetEnvironmentVariable(
  "LAUGHTER_DETECTION_ROOT",
  "$env:USERPROFILE\Desktop\Projetos\laughter-detection",
  "User"
)
```

Opcionais: `LAUGHTER_THRESHOLD` (default `0.5`), `LAUGHTER_MIN_LENGTH` (default `0.2`), `PYTHON_PATH`.

Script: `backend/scripts/laughter_detect.py` → grava `backend/data/{vodId}/laughter.json`.
Candidatos: `POST /vod/:vodId/candidates` usa `laughterHype` (risada + picos de energia RMS). Chat peak detector fica desativado por padrão (sem audiência).

### API — ingestão de VOD

```bash
curl -X POST http://localhost:3001/vod/ingest ^
  -H "Content-Type: application/json" ^
  -d "{\"url\":\"https://www.twitch.tv/videos/VIDEO_ID\"}"
```

Salva em `backend/data/{vodId}/source.mp4` e `meta.json`.

### Transcrição (faster-whisper)

```bash
pip install faster-whisper
# opcional: set WHISPER_MODEL=medium|large-v3  (default: medium)
# opcional: set WHISPER_DEVICE=cuda|cpu        (default: cuda; cai pra CPU se GPU falhar)
# opcional: set WHISPER_COMPUTE_TYPE=float16|int8  (default: float16 em cuda, int8 em cpu)
# opcional: set PYTHON_PATH=python

curl -X POST http://localhost:3001/vod/VIDEO_ID/transcribe
```

Gera `backend/data/{vodId}/transcript.json` com timestamps por palavra.

#### CUDA no Windows (DLLs do pip nvidia-*)

No Windows, o `ctranslate2` precisa achar as DLLs de cuBLAS/cuDNN **antes** de carregar.
O script registra automaticamente estes defaults (sua máquina atual):

- `C:\Users\pc\AppData\Local\Programs\Python\Python312\Lib\site-packages\nvidia\cublas\bin`
- `C:\Users\pc\AppData\Local\Programs\Python\Python312\Lib\site-packages\nvidia\cudnn\bin`

Para sobrescrever (outra máquina / outro usuário):

```powershell
$env:NVIDIA_DLL_CUBLAS_DIR = "C:\caminho\para\nvidia\cublas\bin"
$env:NVIDIA_DLL_CUDNN_DIR  = "C:\caminho\para\nvidia\cudnn\bin"
```


## Estrutura

```
twitch-clip-editor/
  backend/    # Express + TypeScript (API)
  frontend/   # Next.js 15 (editor)
  scripts/    # scripts auxiliares (download, transcrição)
```

## Como rodar

### Backend

```bash
cd backend
npm install
npm run dev
```

API em `http://localhost:3001`. Health check: `GET /health` → `{ "status": "ok" }`.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

App em `http://localhost:3000`.
