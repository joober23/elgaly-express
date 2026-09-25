# 📦 Elgaly Express - Sistema de Rotina & Despacho Dimensional

Aplicação web inspirada no universo ficcional **Elgaly Express**! Desenvolvida para organizar suas rotinas da **Faculdade** e da **Vida Pessoal**, com acompanhamento de hábitos diários, cálculo de agilidade/prazos, passaporte de entregador anos 2000 (`nickname.express.com`) com **Sincronização em Nuvem (Firebase Cloud Firestore)** e emissão de relatórios oficiais em **PDF** com logotipo oficial.

---

## ⚡ Novidades desta Versão

### 1. ☁️ Sincronização em Tempo Real (Firebase + Google)
- Integrado oficialmente com o seu projeto Firebase (`elgaly-express-230108`).
- **Sincronização PC ⇄ Celular**: Tudo o que você cadastrar, marcar ou editar no computador aparece instantaneamente no seu celular sem precisar recarregar a página!
- **Modo Offline**: Se estiver sem internet, o app guarda as alterações no cache e sincroniza com a nuvem assim que você se reconectar.

### 2. 🖥️ Navbar Inteligente no Computador (Auto-Hide)
- Ao rolar a página para baixo no desktop, o cabeçalho se esconde suavemente para dar espaço total de leitura.
- Ao rolar minimamente para cima, o cabeçalho reaparece instantaneamente.

### 3. 📱 Menu Lateral Deslizante no Celular (Mobile Drawer)
- Em telas menores (smartphones), a barra de navegação se transforma em um **menu lateral estilo gaveta**.
- Botão hambúrguer estilizado (**☰**) no topo esquerdo que abre o painel deslizante com animação e efeito de fundo desfocado.

### 4. 📄 Relatório em PDF com Logotipo Oficial
- Emita relatórios para **7, 15 ou 30 dias** com o logotipo da Elgaly Express em alta resolução, carimbo de Rank (Rank S, A, B, C) e manifesto de tarefas.

---

## 🌐 Como Colocar no GitHub Pages & Autorizar o Firebase

### Passo 1: Enviar os arquivos para o GitHub
Abra a pasta `C:\Users\livin\.gemini\antigravity\scratch\elgaly-express` e envie:
```bash
git init
git add .
git commit -m "Adiciona sincronizacao Firebase e menu lateral mobile"
git branch -M main
git remote add origin https://github.com/SEU_USUARIO/elgaly-express.git
git push -u origin main
```
No GitHub, vá em **Settings** > **Pages** > escolha a branch `main` e salve!

### Passo 2: Autorizar seu domínio no Firebase (Importante para o Login com Google no GitHub!)
Por segurança, o Firebase só aceita logins dos domínios autorizados por você:
1. Acesse o [Console do Firebase](https://console.firebase.google.com/) no seu projeto `elgaly-express-230108`.
2. Vá em **Authentication** > aba **Configurações** (ou *Settings*) > **Domínios autorizados**.
3. O `localhost` já vem autorizado (por isso funciona no seu PC!).
4. Clique em **Adicionar domínio** e digite o domínio do seu GitHub Pages:
   `SEU_USUARIO.github.io`
5. Clique em **Salvar**.

Pronto! Agora o login com Google e a sincronização em nuvem funcionarão tanto no seu computador quanto no seu celular online!

---

## 📁 Estrutura de Arquivos
```text
elgaly-express/
├── index.html           # Estrutura com drawer mobile e abas SPA
├── style.css            # Estilo neo-brutalista, drawer mobile e auto-hide
├── firebase-service.js  # Conexão Firebase Auth e Firestore em tempo real
├── app.js               # Gerenciador de rotinas, UI e navegação
├── report.js            # Motor analítico e gerador de PDF com logotipo
├── README.md            # Documentação e instruções de deploy
├── images/
│   └── elgalylogo.png    # Logotipo oficial da Elgaly Express
└── vendor/              # Bibliotecas locais offline (jsPDF e Confetti)
```
