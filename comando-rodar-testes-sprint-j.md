Leia como-testar-sprint-j.md antes de começar.

Objetivo: você mesmo vai rodar os 5 testes descritos nesse arquivo contra o backend local,
sem eu precisar rodar nada manualmente. Eu vou validar visualmente o resultado depois.

Passos:

1. Suba o backend localmente (o comando que já é usado no projeto pra dev, ex. npm run dev),
   se ainda não estiver rodando.
2. Pegue um candidateId real e válido para os testes:
   - Se já existir algum candidato com status "transcribed" em algum marked_candidates.json
     do projeto, use esse id.
   - Se não existir nenhum, rode o fluxo mínimo necessário (mark-candidates numa VOD de teste
     que já tenha dados processados, depois trim-preview, depois transcribe-clip) só o
     suficiente pra ter um candidato pronto pros testes. Não invente um VOD ou id que não
     exista de verdade no projeto.
3. Rode o Teste 1 (zoomKeyframes) via curl exatamente como está no arquivo, ajustando os tempos
   pro tamanho real do clipe de teste que você tiver.
4. Rode o Teste 2 (speedRamp com legenda).
5. Rode o Teste 3 (colorPreset "vivid" vs sem preset).
6. Rode o Teste 4 (os três combinados).
7. Rode o Teste 5 (retrocompatibilidade, sem nenhum campo novo).

Para cada teste:
- Confirme que o request retornou 200 e o path do arquivo exportado.
- Rode ffprobe no arquivo resultante e me reporte: duração final, resolução, se o vídeo abre
  sem erro.
- NÃO tente avaliar sozinho se o zoom "ficou bonito" ou se a cor "ficou boa" -- isso eu vejo
  na tela. Sua parte é garantir que o pipeline rodou sem erro e me dar os arquivos pra eu
  assistir.
- Para o Teste 2 especificamente, me diga também: quantos segmentos tem a legenda gerada
  (.ass ou .srt) e quais são os timestamps de início/fim de cada segmento no arquivo final —
  isso me ajuda a cruzar com o que estou vendo/ouvindo sem precisar decodificar o ASS na mão.

Ao final dos 5 testes:
- Liste os paths de todos os arquivos exportados (prontos/{runId}/{candidateId}_final.mp4 ou
  equivalente), um por teste, pra eu conseguir abrir e assistir cada um.
- Se qualquer teste falhar com erro (não simplesmente "ficou feio", mas erro de fato: request
  falhou, ffmpeg quebrou, arquivo corrompido, build quebrou), pare nesse teste, me mostre o erro
  completo, e não continue pros testes seguintes até eu decidir o próximo passo.
- Não altere nenhum código nesse processo — isso é só execução de testes contra o que já foi
  implementado no Sprint J. Se notar um bug real rodando os testes, me reporte, não corrija
  sozinho ainda.
