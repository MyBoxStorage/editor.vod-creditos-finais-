# Como testar o Sprint J (zoomKeyframes, speedRamp, colorPreset) sem UI

## Pré-requisito

Você precisa de um candidato que já esteja pelo menos com `status: "trimmed"` (preview cortado)
— idealmente também `"transcribed"`, pra poder testar o remapeamento da legenda junto. Pegue o
`id` de um candidato que você já usou nos testes anteriores, ou marque um novo pelo painel
(`/vod/:vodId/marked`) e anote o id que aparece na URL do editor
(`/vod/:vodId/marked/{candidateId}`).

Rode o backend localmente como você já faz (`npm run dev` ou o comando que você usa).

## Teste 1 — só zoomKeyframes (isolado, mais fácil de olhar o resultado)

Body mínimo, testando um zoom leve entrando e saindo:

```bash
curl -X POST http://localhost:3000/candidates/SEU_ID_AQUI/export \
  -H "Content-Type: application/json" \
  -d '{
    "quality": "hd",
    "useSubtitles": false,
    "zoomKeyframes": [
      { "time": 0,   "scale": 1.0, "x": 50, "y": 50 },
      { "time": 1.5, "scale": 1.25, "x": 50, "y": 40 },
      { "time": 3,   "scale": 1.0, "x": 50, "y": 50 }
    ]
  }'
```

(Ajuste os tempos pro tamanho real do seu clipe de teste — se o clipe tiver 5s, não faz sentido
o último ponto ser em 3s só se você quiser que o zoom volte ao normal antes do fim.)

O que olhar no resultado: o vídeo deve começar normal, dar um zoom suave entrando até 1.5s
(ficando 25% mais perto, levemente deslocado pra cima já que y foi de 50→40), e voltar ao normal
até os 3s. Se der zoom de forma abrupta (sem suavidade) ou cortar errado a imagem (mostrando
borda preta ou esticando), é bug no crop/scale.

## Teste 2 — só speedRamp (com legenda, pra testar o remapeamento)

Precisa que o candidato já tenha transcrição (`status: "transcribed"` ou depois de editado).

```bash
curl -X POST http://localhost:3000/candidates/SEU_ID_AQUI/export \
  -H "Content-Type: application/json" \
  -d '{
    "quality": "hd",
    "useSubtitles": true,
    "speedRamp": [
      { "time": 0, "speed": 1.0 },
      { "time": 2, "speed": 0.5 },
      { "time": 3, "speed": 1.0 }
    ]
  }'
```

Isso significa: velocidade normal de 0-2s, câmera lenta (0.5x) de 2-3s do clipe ORIGINAL, normal
depois. Lembrando que o vídeo final fica mais longo nesse trecho (1 segundo original vira 2
segundos no vídeo final, já que está em metade da velocidade).

O que olhar: assista o clipe final inteiro e confira se a legenda continua sincronizada com a
fala EXATAMENTE no trecho em câmera lenta — é aqui que mora o risco real (remapeamento errado
faria a legenda "correr na frente" ou "atrasar" bem no meio do clipe, mesmo que o começo e o fim
pareçam certos). Se só olhar o início e o fim e pular o meio, pode não pegar o bug.

## Teste 3 — colorPreset (o mais rápido de validar, é só visual)

```bash
curl -X POST http://localhost:3000/candidates/SEU_ID_AQUI/export \
  -H "Content-Type: application/json" \
  -d '{
    "quality": "hd",
    "useSubtitles": false,
    "colorPreset": "vivid"
  }'
```

Exporte o mesmo clipe uma vez com `"colorPreset": "none"` (ou sem o campo) e outra com
`"vivid"`, e compare lado a lado. Deve estar visivelmente mais saturado/contrastado, mas sem
ficar artificial ou estourado (se as cores "explodirem" ou a pele ficar com aspecto estranho,
os valores de eq= podem precisar ajuste).

## Teste 4 — combinando os três de uma vez (o caso de uso real)

Só depois que os 3 isolados estiverem validados:

```bash
curl -X POST http://localhost:3000/candidates/SEU_ID_AQUI/export \
  -H "Content-Type: application/json" \
  -d '{
    "quality": "hd",
    "useSubtitles": true,
    "colorPreset": "vivid",
    "zoomKeyframes": [
      { "time": 0,   "scale": 1.0,  "x": 50, "y": 50 },
      { "time": 1.5, "scale": 1.2,  "x": 50, "y": 45 },
      { "time": 3,   "scale": 1.0,  "x": 50, "y": 50 }
    ],
    "speedRamp": [
      { "time": 0, "speed": 1.0 },
      { "time": 2, "speed": 0.6 },
      { "time": 3, "speed": 1.0 }
    ]
  }'
```

## Teste 5 — confirmar retrocompatibilidade (o mais importante antes de seguir)

Exporte um clipe com o body EXATAMENTE como você usava antes do Sprint J (sem nenhum dos 3
campos novos):

```bash
curl -X POST http://localhost:3000/candidates/SEU_ID_AQUI/export \
  -H "Content-Type: application/json" \
  -d '{
    "quality": "hd",
    "speed": 1.0,
    "useSubtitles": true
  }'
```

Compare com um export que você já tinha salvo de antes do Sprint J, se ainda tiver algum. Se o
resultado for idêntico, a retrocompatibilidade está confirmada.

## Se o Postman for mais confortável que curl

Mesma ideia: método POST, URL `http://localhost:3000/candidates/{id}/export`, aba Body → raw →
JSON, colando os mesmos objetos acima.

## O que fazer se algo sair errado

Volta pro Cursor com o comportamento exato observado (não só "deu ruim") — por exemplo: "no
Teste 2, a legenda atrasa cerca de meio segundo a partir dos 2.3s". Quanto mais específico o
sintoma, mais rápido ele localiza se o bug está no cálculo do remapTime ou em outro ponto da
cadeia.
