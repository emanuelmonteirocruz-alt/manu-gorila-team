# Publicar e instalar no tablet e no celular (100% gratuito)

O app Manu Gorila Team é um **PWA**: um site que você instala como aplicativo. Depois de instalado, ele abre em tela cheia com ícone próprio, gira livremente (paisagem no tablet) e funciona sem internet. Não precisa de loja de apps nem de conta de desenvolvedor.

| Peça | Serviço gratuito | Para quê |
|---|---|---|
| Hospedagem do app | **Vercel** (ou Netlify / Cloudflare Pages) | Endereço `https://...` para instalar |
| Banco + login + IA | **Supabase** (plano Free) | Sincronizar tablet ⇄ celular ⇄ computador |
| Código | **GitHub** | A Vercel publica a partir do repositório |

> Sem o Supabase, o app funciona igual, mas cada aparelho guarda os próprios dados. Com o Supabase, tudo o que você registra no tablet aparece no celular.

---

## 1. GitHub (≈ 3 min)
1. Crie uma conta em github.com (se ainda não tiver).
2. Crie um repositório **privado** chamado `em-treino`.
3. Envie esta pasta do projeto para ele. Posso fazer isso por você se você me passar o nome do repositório.

## 2. Supabase: banco e login (≈ 10 min)
1. Acesse supabase.com e clique em **New project**. Região: **South America (São Paulo)**.
2. Abra **SQL Editor → New query**, cole o conteúdo de `supabase/setup_completo.sql` e toque em **Run**. Esse arquivo junta tudo, de 0001 a 0005. Outro caminho é tocar em **📋 Copiar SQL de instalação**, em Config. no próprio app.
3. Em **Authentication → Users → Add user**, crie o seu login (e-mail e senha). O **primeiro usuário vira o Treinador** automaticamente.
4. Em **Project Settings → API**, copie a **Project URL** e a **anon public key**.
5. (Opcional, IA) Instale a Supabase CLI e rode:
   ```bash
   supabase secrets set ANTHROPIC_API_KEY=sua-chave
   supabase functions deploy classify-exercise copilot-draft verify-link
   ```
   Sem isso, a classificação de exercícios usa o modo offline e o copiloto gera o rascunho local.

> O plano Free pausa o projeto depois de cerca de 1 semana **sem nenhum acesso**. Usando o app no dia a dia, isso não acontece. Se acontecer, é só clicar em "Restore" no painel.

## 3. Vercel: publicar o app (≈ 5 min)
1. Acesse vercel.com e entre com o GitHub.
2. Clique em **Add New → Project** e importe `em-treino`. O preset **Vite** é detectado sozinho.
3. Em **Environment Variables**, adicione:
   - `VITE_SUPABASE_URL` = a Project URL
   - `VITE_SUPABASE_ANON_KEY` = a anon key
4. Clique em **Deploy**. Você recebe um endereço como `https://em-treino.vercel.app`.

O `vercel.json` já está configurado para as rotas do app. Na Netlify, o `netlify.toml` faz o mesmo papel.

## 4. Instalar no tablet (Android)
1. Abra o endereço no **Chrome**.
2. Vá em **Config.** e toque em **📲 Instalar Manu Gorila Team**. Outro caminho: menu **⋮ → Instalar app**.
3. Em **Config.**, entre com o e-mail e a senha do treinador para ligar a sincronização.

## 5. Instalar no celular
- **Android:** mesmo passo do tablet.
- **iPhone:** abra no **Safari**, toque em **Compartilhar ⬆️** e depois em **Adicionar à Tela de Início**.

## Microfone (ditado)
- **Android (Chrome):** usa o reconhecimento de voz do Google e precisa de internet na hora de ditar. O resto do app funciona offline.
- **iPhone:** o ditado do navegador pode não estar disponível. Nesse caso, use o teclado com o microfone do próprio iOS, direto na caixa "Transcrição corrigida". A autocorreção funciona igual.

## Atualizações
Cada alteração enviada ao GitHub é publicada automaticamente pela Vercel. O app instalado se atualiza sozinho na próxima vez que você abrir.
