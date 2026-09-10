# Ferramentas de Edição Manual PRO — Pesquisa Consolidada (jul/2026)

Esse documento é a continuação do `pesquisa-ferramentas-pro-roadmap.md`, mas focado no oposto:
não em ferramentas que decidem o corte por você (Opus Clip, Submagic), e sim nas técnicas de
**edição manual** que CapCut Pro, Adobe Premiere e DaVinci Resolve usam de verdade pra dar
ganho de qualidade percebida num clipe. O objetivo é extrair o que é replicável no seu painel,
sem virar outro "agente idiota" decidindo por você — cada técnica abaixo é uma ferramenta que
VOCÊ aciona, não uma automação que decide sozinha.

## 1. O que o CapCut Pro (desktop) oferece hoje

Além do auto-edit por IA (que você já rejeitou), o CapCut desktop 2026 tem uma camada manual
robusta: <cite index="39-1">edição em timeline completa, keyframes, gráficos/curvas, ferramentas de cor, legendas automáticas, dublagem por IA, remoção de fundo, e fluxo de vídeo longo → shorts</cite>. Pra gaming especificamente, o uso manual recomendado é: <cite index="46-1">misturar clipes curtos para ação e um pouco mais longos para reação, usar câmera lenta em momentos épicos e acelerar sequências menos críticas, e usar keyframes para animar zoom e pan — essencial para dar sensação de movimento profissional (zoom leve em kills/momentos engraçados, pan lento sobre cenário ou placar, combinando keyframe com opacidade para fade-in/fade-out)</cite>.

## 2. Técnicas de corte que profissionais usam (aplicáveis manualmente no seu painel)

- **Jump cut:** <cite index="45-1">mesmo sujeito, posição ligeiramente diferente — perfeito pra vlogs e compressão de tempo</cite>. É basicamente cortar os "meios mortos" da fala e colar o resto, hoje já parcialmente coberto pela ideia de remoção de silêncio.
- **J-cut / L-cut:** <cite index="45-1">J-cut: áudio da cena seguinte chega antes do visual, suavizando a transição pra um novo local; L-cut: áudio da cena atual continua sob o próximo visual, útil pra transições emocionais/narrativas</cite>.
- **Match cut:** <cite index="45-1">semelhança visual ou sonora conecta duas cenas não relacionadas</cite> — menos aplicável a gameplay solo, mas útil se você juntar trechos de sessões diferentes com um elemento visual em comum.
- **Speed ramping:** <cite index="45-1">acelerar trechos monótonos do meio, desacelerar momentos dramáticos pra dar ênfase</cite> — você já tem controle de velocidade no export; o que falta é permitir variar a velocidade DENTRO do mesmo clipe (rampa), não só um valor fixo pro clipe inteiro.
- **Cutaway:** <cite index="45-1">um plano breve de outra coisa, escondendo cortes e adicionando contexto</cite>.
- **Pattern interrupt:** <cite index="50-1">uma pequena mudança inesperada que impede o espectador de "zonear" — zoom repentino, troca rápida de cor, um corte surpresa, ou um gráfico de movimento que aparece na tela</cite>, usado a cada ~15s pra manter atenção.
- **Regra de corte pela ação:** <cite index="45-1">sempre cortar durante o movimento — se alguém estende a mão pra porta, corte no meio do gesto — o movimento mascara o corte e o cérebro lê como continuidade, não interrupção</cite>.

## 3. Zoom/pan com keyframes (o "punch-in" que grita profissional)

O padrão do mercado é: <cite index="46-1">zoom leve em kills ou momentos engraçados, pan lento sobre cenário/placar, combinando keyframe com opacidade pra fade-in/fade-out</cite>. Tecnicamente isso é uma sequência de pontos-chave (tempo → escala/posição) interpolados suavemente — exatamente o mesmo tipo de expressão que o ffmpeg já usa em crop dinâmico, só que aplicado como zoom/pan controlado por VOCÊ no painel (não por IA de rastreio de rosto).

## 4. Áudio: ducking automático de música de fundo

Ponto de ganho de qualidade que muita gente ignora: quando você bota música de fundo num clipe
que também tem sua voz/call de jogo, a música precisa baixar automaticamente quando você fala.
Isso é padrão de estúdio (chamado "ducking"), e no ffmpeg é resolvido com o filtro
`sidechaincompress`: <cite index="54-1">o movimento profissional é fazer a música abaixar automaticamente sempre que a voz está falando; o sidechaincompress usa a faixa de voz como gatilho pra comprimir a música</cite>, com controle fino de <cite index="55-1">threshold (mais baixo = mais sensível à fala), ratio (quanto reduzir), attack (velocidade de resposta ao começar a fala) e release (velocidade de retorno ao volume normal depois)</cite>. É 100% implementável com ffmpeg puro, sem precisar de Adobe/DaVinci — inclusive o próprio Premiere Pro tem reclamações recorrentes de usuários sobre o ducking automático dele ser bugado, então fazer isso via ffmpeg direto pode até ficar mais confiável.

## 5. Efeitos sonoros e sincronia com beat

<cite index="50-1">Um whoosh, ding, ou pop bem posicionado adiciona uma camada extra de polimento e ar profissional; sincronizar cortes e transições com a batida da música também cria um ritmo que mantém o espectador engajado, mesmo que de forma subconsciente</cite>. Isso conecta direto com o Sprint I que já estava no roadmap anterior (efeitos sonoros em momentos de destaque) — a pesquisa reforça que vale a pena.

## 6. Cor e consistência visual

<cite index="48-1">Cor pode parecer um toque final, mas é uma ferramenta de marca poderosa — quando as pessoas reconhecem seu conteúdo antes mesmo de ver a logo, você acertou a consistência visual; não precisa de software caro de correção de cor, a maioria das plataformas modernas já inclui correção básica</cite>. Pra você, isso seria: um preset de cor/LUT simples aplicado consistentemente em todos os clipes exportados (ex.: leve aumento de contraste/saturação padronizado), reforçando identidade visual do canal.

## 7. Consolidação: o que entra no painel agora

Cruzando com o que já pesquisamos antes (Sprints G/H/I do documento anterior — legenda animada,
remoção de silêncio, efeitos sonoros), a pesquisa de ferramentas manuais confirma 3 adições que
fazem sentido somar ao roadmap, todas como FERRAMENTAS que você aciona manualmente, não decisões
automáticas:

| Ferramenta manual | O que dá de ganho real | Esforço de implementação |
|---|---|---|
| Zoom/pan com keyframes (punch-in) | Sensação de movimento profissional em momentos de destaque | Médio — expressão de crop dinâmica no ffmpeg, você define os pontos no painel |
| Ducking de música de fundo (sidechaincompress) | Música nunca abafa sua fala/call | Baixo — um filtro ffmpeg, parâmetros configuráveis |
| Speed ramp dentro do mesmo clipe (não só velocidade fixa) | Ênfase dramática em vez de acelerar/desacelerar o clipe inteiro igual | Médio — múltiplos pontos de velocidade em vez de um valor único |
| Preset de cor/LUT simples | Identidade visual consistente entre clipes | Baixo — curva de cor fixa aplicada no export |

## 8. Sprint proposto — Sprint J: Ferramentas Manuais de Polimento

### Prompt para o Cursor — Sprint J

```
Leia painel-manual-clipes-sprints.md e pesquisa-ferramentas-pro-roadmap.md antes de começar
(contexto do projeto). Leia candidateExportService.ts e qualityPresets.ts antes de editar.

Objetivo: adicionar ao /candidates/:id/export quatro novos campos opcionais no body, cada um
uma FERRAMENTA manual que o usuário aciona explicitamente no painel (nada automático):

1. `zoomKeyframes`: array opcional de { time, scale, x, y } (time em segundos relativos ao
   clipe, scale 1.0 = sem zoom, x/y = centro do zoom em % do frame). Se fornecido, gera uma
   expressão de crop/zoom dinâmica no ffmpeg interpolando entre os pontos. Se vazio/ausente,
   comportamento atual sem zoom continua idêntico.

2. `speedRamp`: array opcional de { time, speed } substituindo o campo único `speed` quando
   fornecido (ex.: [{time:0,speed:1},{time:2,speed:0.5},{time:3,speed:1}] = câmera lenta só
   entre 2s e 3s). Se só vier o `speed` único (formato atual), manter compatibilidade retroativa
   sem quebrar nada que já funciona.

3. `duckMusic`: boolean opcional. Se true E se houver uma trilha de música de fundo configurada
   pro export (perguntar se já existe algum mecanismo de música de fundo no projeto antes de
   inventar um novo -- se não existir, PARE e pergunte se é pra criar do zero ou se essa parte
   fica pra depois), aplicar sidechaincompress com voz como gatilho e música como sinal
   comprimido, parâmetros: threshold 0.02, ratio 10, attack 50ms, release 400ms (ajustáveis
   depois se soar mal, mas comece com esses).

4. `colorPreset`: string opcional (ex.: "none" | "vivid" | "warm"). Aplicar uma curva de
   cor/contraste/saturação fixa e simples via ffmpeg (eq= filter, valores conservadores, sem
   exagero) correspondente ao preset escolhido. Comece só com "none" e "vivid" (leve aumento de
   contraste e saturação) -- não invente mais presets sem confirmar comigo os valores exatos.

Regras:
- Todos os 4 campos são OPCIONAIS e aditivos. Nenhum comportamento existente do /export pode
  mudar quando esses campos não forem enviados.
- Não misture isso com o merge -- essas ferramentas se aplicam só no /export de candidato
  individual por enquanto.
- Edição cirúrgica em cima do que já existe, sem duplicar a lógica de build do ffmpeg -- estenda
  a função existente de montagem de filtro complexo.
- Se qualquer um dos 4 pontos tiver ambiguidade real (formato de dado, onde a trilha de música
  mora, valores exatos de cor), PARE e pergunte antes de decidir sozinho.
- Não instale nenhuma dependência nova.
- Ao terminar, rode build/typecheck, resuma o que foi feito e os arquivos alterados, e PARE.
  Frontend (sliders/timeline pra criar os keyframes de zoom/speed) fica pra um sprint separado
  depois que o backend estiver validado.
```

---

Isso fecha a parte de pesquisa. Se quiser, no próximo passo eu já preparo o Sprint K (frontend
das ferramentas do Sprint J: editor visual de keyframes de zoom, timeline de speed ramp, toggle
de ducking, seletor de preset de cor) — mas só depois que o backend do J estiver funcionando e
você tiver testado o resultado sonoro/visual.
