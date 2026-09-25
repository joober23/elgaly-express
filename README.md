# 📦 Elgaly Express - Sistema de Rotina & Despacho Dimensional

Aplicação web inspirada na história em quadrinhos autoral **Elgaly Express**! Desenvolvida para organizar suas rotinas da **Faculdade** e da **Vida Pessoal**, com acompanhamento de hábitos diários, cálculo de agilidade/prazos, passaporte de entregador anos 2000 (`nickname.express.com`) com suporte a login com Google e emissão de relatórios oficiais em **PDF** com o logotipo oficial para períodos de **7, 15 ou 30 dias**.

---

## 🎨 Principais Novidades desta Versão
1. **Totalmente Zerado (Clean Slate)**: Inicia sem dados prévios para você cadastrar suas próprias matérias, trabalhos e rotinas do zero!
2. **Logotipo Oficial no PDF**: O relatório gerado em PDF agora estampa o logotipo oficial da Elgaly Express no cabeçalho.
3. **Passaporte EEX Anos 2000 (`nickname.express.com`)**:
   - Faça login com Google ou ative seu apelido direto pelo formulário.
   - Todo usuário ganha seu identificador retro (ex: `juanio.express.com`).
   - Dados segregados por usuário: amigos e colegas podem usar no mesmo navegador ou em dispositivos diferentes com perfis individuais!
4. **Visualizações em Abas (Single Page App - SPA)**:
   - 🏠 **Início**: Cumprimento personalizado com seu apelido (`Olá, juanio.express.com!`), status da rota de hoje e indicadores rápidos.
   - ☀️ **Rotina Diária**: Check-in de hábitos com histórico e contador de streak (🔥).
   - 📦 **Encomendas & Prazos**: Central com busca rápida integrada, filtros por faculdade/pessoal e cálculo automático de agilidade.
   - 📊 **Relatórios & PDF**: Painel analítico de 7, 15 ou 30 dias com Ranks (Rank S+, A, B, C) e download do relatório oficial em PDF.
   - 👤 **Perfil EEX**: Crachá de entregador anos 2000 com estatísticas de carreira.
5. **100% Responsivo no Celular (Mobile Ready)**: Otimizado para telas de smartphones, com toque fluido e navegação deslizante.
6. **Rodapé Oficial da HQ**:
   > *© 1998 - 2026 | Elgaly Express: Serviços de Entrega*  
   > *Avenida Tennant Rockstead, 67, Nova Amerit - NA (Nova Arcanis)*

---

## 🌐 Como Colocar Online no GitHub Pages (Passo a Passo)

Para acessar no celular ou compartilhar com amigos:

1. **Crie um repositório no GitHub**:
   - Acesse [github.com/new](https://github.com/new) e crie um repositório público (ex: `elgaly-express`).
2. **Envie os arquivos da pasta**:
   - Abra a pasta do projeto: `C:\Users\livin\.gemini\antigravity\scratch\elgaly-express`
   - Inicialize o git e suba os arquivos:
     ```bash
     git init
     git add .
     git commit -m "Lançamento oficial Elgaly Express"
     git branch -M main
     git remote add origin https://github.com/SEU_USUARIO/elgaly-express.git
     git push -u origin main
     ```
3. **Ative o GitHub Pages**:
   - No seu repositório no GitHub, vá em **Settings** > **Pages** (no menu lateral esquerdo).
   - Em **Source**, selecione **Deploy from a branch**.
   - Em **Branch**, selecione `main` e a pasta `/(root)`, depois clique em **Save**.
4. **Pronto!** Em cerca de 1 a 2 minutos, seu site estará online em:
   `https://SEU_USUARIO.github.io/elgaly-express/`
   Você poderá abrir direto no navegador do celular, adicionar à tela de início e usar como aplicativo!

---

## 📁 Estrutura de Arquivos
```text
elgaly-express/
├── index.html        # Estrutura SPA com abas e modais
├── style.css         # Estilo neo-brutalista comic responsivo para mobile
├── app.js            # Gerenciador de rotinas, auth EEX e UI
├── report.js         # Motor estatístico 7/15/30 dias e PDF com logotipo
├── README.md         # Instruções de deploy e documentação
├── images/
│   └── elgalylogo.png # Logotipo oficial da Elgaly Express
└── vendor/           # Bibliotecas locais offline (com fallback CDN)
    ├── jspdf.umd.min.js
    └── confetti.browser.min.js
```
