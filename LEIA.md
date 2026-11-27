# T10: protótipo da prova ao vivo (teste de risco)

**O que é:** uma página única (PWA) que abre a câmera, acha o rosto e desenha uma armação 3D que acompanha a cabeça. Tudo roda **no aparelho**: nenhuma imagem sai dele e não há custo de IA.

- Detecção do rosto: MediaPipe Face Landmarker (478 pontos, via CDN). Desenho: Three.js 0.160 (via CDN).
- A armação é desenhada em milímetros e escalada pela íris (≈ 11,7 mm). Por isso aparece no **tamanho real**: trocar o calibre (49-20, 54-17…) muda o tamanho no rosto.
- Uma "cabeça invisível" esconde as hastes quando elas passam por trás do rosto.
- O painel mostra FPS, tempo de detecção, DP e largura do rosto **estimadas** (a medição de verdade é a T11).
- O botão "Copiar resultado" gera um texto com o aparelho e os números, para colar no WhatsApp.

## Como rodar no PC

```
python -m http.server 8710 --bind 127.0.0.1 --directory "G:/TCSYS/SISTEMAS-TCSYS/otica-sistema/A/prototipos/t10-prova-ao-vivo"
```

Abra http://localhost:8710. A câmera só funciona em `localhost` ou em `https`. Sem câmera, use "Testar com uma foto" (`teste-sem-oculos.png` é uma foto gerada por IA para teste).

## Como testar em tablet e celular

Link público (GitHub Pages, repositório `oioaisystem/prova-ao-vivo`, público): **https://oioaisystem.github.io/prova-ao-vivo/**. Para atualizar: copie os arquivos desta pasta para um clone desse repositório e faça push com a conta `oioaisystem`. Em cada aparelho: abrir, permitir a câmera, mexer a cabeça por 30 s, trocar 2 modelos e tocar em "Copiar resultado".

## Resultados (preencher)

| Data | Aparelho | Câmera | FPS | Detecção (ms) | Observações |
| --- | --- | --- | --- | --- | --- |
| 27/11/2026 | PC (navegador do app Claude), foto 299×303 | foto | 60 | ~11–15 (GPU) | Armação bem posicionada nos 4 modelos; carga do modelo ~0,8 s |
| 27/11/2026 | PC do dono, Chrome 158, Windows | webcam frontal 1280×720 | 60 | 15,6 média (2.335 quadros, GPU) | Carga do modelo 0,7 s. DP estimada 56,4 mm e rosto 131 mm (conferir com a receita na T11) |
