# Auditoria completa + pesquisa — Editor de clipes CLIP.VOD (27/08/2026)

Documento de referência produzido ANTES de qualquer proposta de código. Fases 1 e 2 da missão
de redesenho do editor. As Fases 3 (20 perguntas) e 4 (arquitetura + prompts de sprint) dependem
das respostas do usuário.

**Regra que atravessa tudo:** a mecânica/receita dos 6 presets emocionais está CONGELADA.
Este documento avalia apenas como eles são apresentados, organizados e descobertos.

---

# FASE 1 — Auditoria do código real

Lido em: `C:\Users\pc\Desktop\Projetos\CLIP.VOD\twitch-clip-editor`
Documentos de decisão anteriores lidos: `painel-manual-clipes-sprints.md` (Sprints A–F),
`pesquisa-edicao-manual-pro.md` (Sprint J), `como-testar-sprint-j.md`.

## 1.1 Superfície do projeto

**Backend** (`backend/src`): Express + TS + better-sqlite3.
- routes: `vod.ts`, `candidates.ts` (685 linhas), `compositions.ts`, `effectsLibrary.ts`, `health.ts`
- services: 26 arquivos, 228 KB. O maior é `candidateExportService.ts` (63 KB) — concentra
  toda a montagem de filtro complexo do ffmpeg.
- pipeline: detectores (audioEnergy, laughterHype, chatPeak, fallbackPeak), `clipRenderer`,
  `captionGenerator`, `layoutPresets`.

**Frontend** (`frontend/src`): Next.js 15 App Router.
- 6 páginas: `/`, `/biblioteca`, `/vod/[vodId]`, `/vod/[vodId]/marked`,
  `/vod/[vodId]/marked/merge`, `/vod/[vodId]/segments`, `/vod/[vodId]/marked/[candidateId]`
- 1 componente extraído: `LibraryEffectsPanel.tsx`
- 2 libs: `api.ts`, `emotionPresets.ts` (espelho do backend, "keep in sync" por comentário)

**O editor é 1 arquivo de 2.204 linhas / 82,65 KB** (`marked/[candidateId]/page.tsx`), servindo
dois tipos de objeto (`candidate` e `clip_segment`) com ramificações `editKind === "clip_segment"`
espalhadas por toda a renderização. Não há sub-componentes além do painel de efeitos.

## 1.2 Inventário literal — todo input, botão e seção do editor

Na ordem em que aparecem na coluna única (`max-w-5xl`, tudo empilhado verticalmente):

| # | Seção | Controles |
|---|---|---|
| 1 | Header | link de volta (varia por tipo), link "Gaveta de edição", badges (Trecho de edição / Candidato / Gancho / Reutilizável), id + status em texto pequeno, aviso azul "editando trecho isolado", botões `← Trecho anterior` / `Próximo trecho →` + contador `n/N` |
| 2 | Faixas de feedback | 1 faixa vermelha de erro, 1 faixa verde de status — **canal único global** |
| 3 | Player | `<video controls>` nativo, `max-h-[480px]` |
| 4 | Timeline | barra de 40px, seleção azul, faixa âmbar do efeito, 2 handles brancos arrastáveis |
| 5 | Trim | `Start (min:seg)` texto, `End (min:seg)` texto, botão `Preview trecho` |
| 6 | Nudge | 8 botões: Start −1s / −0.5s / +0.5s / +1s, End −1s / −0.5s / +0.5s / +1s |
| 7 | Transcrição / legendas | botão `Transcrever este trecho`, botão `Salvar correções`, badge "editado manualmente", lista de `<textarea>` (1 por segmento), checkbox `Queimar legendas no export`, rádio `Clipe inteiro` / `Subset`, `Sub start (s)` número, `Sub end (s)` número |
| 8 | Export — cabeça | select `Layout`, select `Qualidade` (draft / hd / max) |
| 9 | Presets emocionais | 6 botões (Ênfase, Suspense, Comemoração, Surpresa, Decepção, Wasted); ao selecionar: `Início efeito (min:seg)`, `Fim efeito (min:seg)` **ou** `Início do efeito` + `Duração do efeito (segundos)` no Wasted; botões `Início = playhead` e `Fim = playhead`; slider `Intensidade (0–200%)`; 2 checkboxes **permanentemente desabilitados** no Wasted; botão `Gerar preview`; spinner; faixa de resumo; **segundo player** de preview; link `Limpar preset / efeitos` |
| 10 | Efeitos da biblioteca | busca por nome/tag, select `Item`, `Trim início (s)`, `Trim fim (s)`, `Timestamp no clipe (s)`; se vídeo: `X`, `Y`, `Largura`, `Altura`; se música: `Volume`, `Fade in (s)`, `Fade out (s)`, checkbox `Ducking`; se sfx: `Volume`; botão `Aplicar efeito`; lista de aplicados com botão `Remover` |
| 11 | Opções avançadas (accordion) | slider `Velocidade uniforme`, select `Cor` (5 opções), bloco `Zoom (keyframes)`: botão `Adicionar ponto de zoom` + por linha `Tempo (s)`, `Scale`, `X (%)`, `Y (%)`, `Remover`; texto `speedRamp ativo: …` |
| 12 | Ações | botão `Exportar`, botão `Enviar para edição` (só candidato) |
| 13 | Reutilizável | checkbox `Marcar como reutilizável`, `Nome`, `Tags (vírgula)`, botão `Salvar reutilizável` |
| 14 | Resultado | link `Abrir / download final`, terceiro `<video>` |

**Total: ~45 controles interativos e 3 players de vídeo em uma coluna vertical única.**

## 1.3 Problemas identificados (cada um com evidência no código)

### A. Cinco campos de tempo, três formatos, três referenciais — sem marcação visual

| Campo | Formato | Referencial |
|---|---|---|
| Start / End | relógio `m:ss` | **absoluto no VOD** se candidato; **relativo ao preview** se clip_segment (convertido por `clipOrigin`) |
| Início / Fim efeito | relógio `m:ss` | relativo ao clipe |
| Sub start / Sub end | número em segundos | relativo ao clipe |
| Zoom → Tempo (s) | número em segundos | relativo ao clipe |
| Trim início / Trim fim (efeito) | número em segundos | **relativo ao arquivo fonte do efeito** |
| Timestamp no clipe | número em segundos | relativo ao clipe |

O mesmo conceito ("um instante") aparece com duas grafias diferentes e três origens diferentes,
e o referencial de Start/End **muda de significado** conforme o tipo de objeto aberto — sem que
nada na tela diga isso além de uma frase em prosa no header.

### B. O bug relatado, localizado no código
Em `LibraryEffectsPanel.tsx`, `Trim início (s)`, `Trim fim (s)` e `Timestamp no clipe (s)` estão
na **mesma linha** (`flex flex-wrap gap-3`), com estilo idêntico e larguras quase iguais (w-24,
w-24, w-28). Os dois primeiros respondem "QUAL PARTE do arquivo de efeito usar", o terceiro
responde "QUANDO no clipe o efeito entra". Os defaults reforçam o erro: ao trocar de item o trim
é preenchido com `0 → duração total`, e `clipTimestamp` fica em `0` — ou seja, o padrão é
"o efeito inteiro, entrando no segundo zero", aplicado silenciosamente se o usuário só mexer no trim.

### C. Efeitos da biblioteca são invisíveis na timeline
A timeline desenha apenas a seleção de trim e a faixa do preset emocional. Efeitos aplicados
existem só como lista de texto (`t=2.0s · trim 0.0s–2.0s`). Não há como ver sobreposição entre
dois efeitos, nem entre efeito e preset, nem arrastar para reposicionar.

### D. Assimetria grave de feedback
Presets emocionais: preview real via ffmpeg, com cache, com duração final estimada.
Efeitos da biblioteca: o próprio painel declara **"Validação via export"**. São dois níveis de
confiança completamente diferentes na mesma tela.

### E. "Opções avançadas" e "Presets emocionais" disputam os mesmos estados
`colorPreset`, `zoomKeyframes` e `speedRamp` são preenchidos por `expandEmotionPreset()` e
também editáveis manualmente no accordion. Consequências reais:
- editar Cor ou um keyframe depois de gerar o preview **não invalida o preview** (os `onChange`
  desses campos não chamam `invalidatePresetPreview()`) → o vídeo mostrado deixa de corresponder
  ao que será exportado;
- `selectEmotionPreset()` faz `setZoomKeyframes([])`, `setColorPreset("none")`, `setSpeedRamp([])`
  → clicar num preset **apaga sem aviso** todo o ajuste manual anterior.

### F. Um preset por clipe, por construção
`selectedPresetId` é um único id. Não existe forma de aplicar Ênfase aos 2s e Comemoração aos 7s
no mesmo corte. Para um corte de live com dois beats emocionais, o usuário tem que exportar,
reimportar, ou desistir. (Limitação de UI/estrutura — não da receita dos presets.)

### G. Velocidade tem dois controles, ambos escondidos
`speed` uniforme vive dentro do accordion "Opções avançadas" e é `disabled` sempre que o preset
trouxe `speedRamp`. No export vai `speed: speedRamp.length > 0 ? 1 : speed`. O usuário só
descobre por que o slider está morto se abrir o accordion e ler a legenda cinza.

### H. Wasted vaza por toda a tela, e promete algo que já existe
Campos diferentes (Duração em vez de Fim), payload diferente (`wastedInsert` em vez do trio
zoom/cor/speed), e **dois checkboxes permanentemente desabilitados** com a nota
"Disponível após a biblioteca de efeitos" — sendo que `/biblioteca` já existe, já aceita upload
de vídeo com chroma key configurável e já é aplicável ao clipe. A UI exibe uma promessa vencida.

### I. Legendas estão metade na seção errada
`Queimar legendas no export` e o range de legenda são opções de **export**, mas moram na seção
Transcrição. O range usa números em segundos enquanto todo o resto usa relógio. E o estilo da
legenda vem de `layoutPresetId`, escolhido lá embaixo em Export — sem nenhum preview do estilo.

### J. Um único canal de status para o app inteiro
`setStatus` / `setError` são compartilhados por trim, transcrição, preview de preset, efeitos de
biblioteca (via callbacks `onStatus`/`onError`) e export. Uma mensagem sobrescreve a outra, sem
histórico e sem indicação de qual seção falou.

### K. Não existe noção de "clipe pronto"
Nenhum checklist, nenhum indicador de "falta transcrever" ou "nenhum efeito aplicado". O status
do backend (`marked` → `trimmed` → `transcribed` → `exported`) aparece só como texto pequeno
cinza no header.

### L. Trim é round-trip de servidor a cada ajuste
`scheduleTrim` (debounce 450ms) reescreve `previews/{id}.mp4` a cada mudança de handle. Já causou
dessincronia de legenda — há um comentário longo em `onExport` explicando a correção
("Unconditional trim here was rewriting previews/{id}.mp4 … and desyncing captions"). Mudar o
range invalida na prática a transcrição e o preview de preset, mas a UI só reseta o range de legenda.

### M. Nomenclatura misturada PT/EN e jargão cru vazando
Na mesma tela: `Start (min:seg)`, `End (min:seg)`, `Sub start (s)`, `draft / hd / max`, `Scale`,
`speedRamp ativo`, `X/Y em % do frame`, `Timestamp no clipe`, `Trim início`, `keyframes`.

### N. Zero atalhos de teclado
Sem espaço = play/pause, sem I/O para marcar entrada/saída, sem setas para nudge, sem J/K/L.
Todo ajuste fino passa pelos 8 botões de nudge.

## 1.4 Lacunas — pronto no backend, sem UI

| Recurso | Estado no backend | Estado no frontend |
|---|---|---|
| **Camada 3 — Compositions** | Completo: `POST /compositions`, `GET /compositions/:id`, add/remove segmento, `POST /reorder` (com ganchos forçados para a frente), `POST /export` com normalização de resolução | **Nenhuma UI.** Existe apenas `/marked/merge`, que usa o endpoint **antigo** `POST /candidates/merge` e exige que todos os candidatos já estejam com status `exported` |
| `clone-for-reuse` de clip_segment | `POST /clip-segments/:id/clone-for-reuse` | Nenhum botão |
| `hookStart` / `hookEnd` no export | Aceitos pelo endpoint de export | Nenhum controle no editor |
| Thumbnail de segmento | `GET /candidates/:id/thumbnail` com cache | A gaveta (`/segments`) renderiza literalmente a caixa cinza **"Sem thumb"** |
| Lista de trechos reutilizáveis | Flag + nome + tags persistidos | Nenhuma página lista os reutilizáveis marcados |

Observação de nomenclatura: existem **dois conceitos chamados "biblioteca"** — a biblioteca de
efeitos (`/biblioteca`, uploads de vídeo/música/SFX) e os clip_segments marcados como
"reutilizáveis" (com nome e tags). Nada na UI os distingue.

---

# FASE 2 — Pesquisa externa (fontes reais, 2026)

## 2.1 Quem é referência de UX em 2026, e por quê

O mercado se separou por **filosofia de edição**, não por qualidade. Cada um resolve um
"job-to-be-done" diferente: CapCut é o cavalo de batalha de timeline multitrack e biblioteca de
templates; Descript é o editor movido a documento, com transcrição na nuvem; Opus Clip é o
recortador long-to-short com autopostagem.

O eixo que importa para o CLIP.VOD é **controle × velocidade**. No mesmo teste de 30 minutos de
fonte: Opus Clip é o mais rápido em lote mas oferece o menor controle manual; CapCut exige
esforço real de timeline e devolve a maior liberdade criativa.

Onde cada um economiza tempo é a parte mais transferível: CapCut economiza dando **movimentos
visuais prontos** (templates, auto-reframe, legendas, efeitos) num fluxo desenhado para
TikTok/Reels/Shorts; Descript economiza deixando você **editar as palavras primeiro** (remover
muletas, apertar o ritmo, cortar seções apagando texto); Opus Clip economiza **achando os
momentos** por você.

Vale registrar o diagnóstico do problema, que descreve exatamente a dor deste projeto: criadores
não desistem por odiar editar — desistem porque editar rouba as horas de publicar; você abre uma
timeline, perde o embalo, e um único vídeo custa uma noite inteira.

**Fontes:** cutfa.st, "AI Video Editor Comparison 2026" (23/04/2026);
gstory.ai, "CapCut vs Descript vs OpusClip … 2026" (26/02/2026);
getaitoolhub.com, "AI Video Editing Tools 2026" (15/03/2026);
tasarim.ai comparativo (01/03/2026).

## 2.2 Padrões de INTERAÇÃO que se repetem

O padrão dominante para posicionar qualquer coisa no tempo é **playhead-primeiro**, não
campo-de-número:

1. **Keyframe = playhead + propriedade.** Um keyframe do CapCut guarda o valor de uma propriedade
   num instante. Você põe outro adiante com valor diferente e o editor desenha a mudança entre
   eles. Esse é o sistema inteiro: selecione o elemento, defina o estado inicial, mova o playhead,
   mude a mesma propriedade, e dê play a partir de um momento antes do primeiro marcador.
   (capcutguide.com, atualizado 17/08/2026 — verificado contra material oficial em 16/08/2026)
2. **A propriedade cria o keyframe sozinha.** Depois do primeiro marcador, mexer no valor com o
   playhead em outro ponto gera o segundo automaticamente — não é preciso clicar no diamante de
   novo. (positioniseverything.net, 26/02/2026)
3. **Distância entre marcadores = velocidade da animação.** Marcadores próximos = movimento rápido;
   afastados = movimento suave e lento. (techbloat.com, 16/05/2026)
4. **Remover = mesmo gesto, invertido.** Com o playhead sobre o keyframe, clicar no diamante de
   novo apaga. (multilogin.com, 07/03/2026)
5. **Menos é mais.** Excesso de keyframes torna o movimento mais difícil de controlar e editar
   depois; poucos e bem colocados produzem resultado mais limpo. (positioniseverything.net)
6. **Rápido × avançado não é um toggle.** O CapCut resolve com camadas de descoberta: templates e
   efeitos prontos na frente, painel de propriedades (escala, posição, rotação, opacidade) à
   direita para quem quiser abrir. O loop básico ensinado é sempre o mesmo: importar → cortar o
   tempo morto → texto/legenda → som → cor → exportar. (multilogin.com, 07/03/2026)

**Implicação direta para o CLIP.VOD:** hoje o editor tem os botões `Início = playhead` /
`Fim = playhead` só dentro do painel de preset. O padrão de mercado é o inverso: o playhead é o
mecanismo *primário* de posicionamento para tudo (efeito, overlay, zoom, SFX), e o campo numérico
é a correção fina opcional.

## 2.3 O que está formatando cortes de gameplay virais agora (ago/2026)

**Legendas queimadas não são acessibilidade, são o conteúdo.** Boa parte do short-form é assistida
sem som, e áudio de gameplay é justamente o primeiro que as pessoas mutam — a legenda carrega a
call, a reação e a piada. Legendas automáticas de plataforma vêm desligadas para muita gente e são
removidas quando o clipe é baixado e repostado: se a legenda não estiver nos pixels, assuma que
ela não existe. O ritmo recomendado pela própria TikTok é de 5 a 10 palavras por segundo de texto
na tela — mais rápido que isso e o espectador para de ler. (blog.eklipse.gg, ~ago/2026)

**Zonas seguras.** As três plataformas cobrem regiões parecidas; aproximadamente os **60% centrais**
sobrevivem em todas. O terço inferior do vertical é ocupado pela caixa de legenda, nome de usuário
e atribuição de som em todas as plataformas. (blog.eklipse.gg)

**O hook é decidido em 1–3 segundos.** 71% dos espectadores decidem nos primeiros segundos se vale
continuar. Metas concretas para Shorts: retenção de intro (quem passa dos 3s) acima de 70%, e
completion acima de 60% para clipes abaixo de 30s. (teleprompter.com, ~jul/2026; opus.pro, 12/02/2026)

**Pattern interrupt tem o maior retorno de 1 segundo, e o maior risco.** Quebrar o padrão visual ou
sonoro no primeiro segundo tem a maior retenção crua de 1s entre sete padrões testados (~89% no
TikTok), **mas piora o completion se o interrupt não conectar com o que vem depois**. E há punição
nova: o TikTok passou a tratar "early exit rate" (sair em até 3s depois de um hook envolvente) como
sinal negativo. (greenfroglabs.com, 10/04/2026)

**Formato específico de gaming.** O TikTok classifica clipes em baldes de interesse por jogo, e a
audiência-semente vem de quem já engajou com aquele jogo — completion rate é o sinal mais
importante. Os clipes estão ficando **mais curtos**, e a alavanca mais confiável de crescimento é
**volume de testes por semana**, não perfeição por clipe. (blog.eklipse.gg, 28/04/2026;
viryze.com, 29/03/2026)

## 2.4 Onde a pesquisa NÃO trouxe nada confiável (declarado, não preenchido com suposição)

- Nenhum dado datado de ago/2026 sobre **duração ideal específica para cortes de simulador ou jogo
  de tiro**. O material disponível é genérico de gaming (15–60s, tendência a encurtar).
- Nenhum estudo confiável sobre **intensidade ideal de zoom/punch-in** em cortes de gameplay. A
  recomendação recorrente é qualitativa ("mantenha movimentos sutis").
- Nenhum benchmark público de UX **especificamente para ferramentas de corte de live** — o material
  é todo sobre editores gerais ou clippers de podcast/talking-head.

---

# FASE 3 — Sessão de 20 perguntas

As 20 perguntas foram entregues em conversa. Este documento fica como base para a Fase 4
(arquitetura de UX consolidada + prompts de sprint para o Cursor), que só começa depois das
respostas reais do usuário.
