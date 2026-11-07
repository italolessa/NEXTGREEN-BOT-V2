const express = require('express');
const app = express();
const port = process.env.PORT || 10000;

// Rota de saúde para o UptimeRobot fazer o ping e manter o servidor acordado
app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

// Importa a versão do bot adaptada para servidor
const { iniciarBotServidor } = require('./backend/bot_servidor');

// =====================================================================
// ⚠️ COLE O SEU TOKEN DA POLARIUM AQUI ENTRE AS ASPAS PARA TESTAR LOCAL
// =====================================================================
const TOKEN_MANUAL = '519feb3c9cbec623a6f7e1fa8a0a370w'; 
// =====================================================================

// Se estiver no Render, ele usa a variável de ambiente. 
// Se estiver no seu PC, ele usa o TOKEN_MANUAL que você colou acima.
const tokenFinal = process.env.POLARIUM_TOKEN || TOKEN_MANUAL;

if (!tokenFinal || tokenFinal === 'COLE_SEU_TOKEN_AQUI') {
    console.error("❌ ERRO: Token não configurado.");
    console.error("👉 Abra o server.js e cole seu token na variável TOKEN_MANUAL para testar no PC.");
} else {
    // Inicia o bot no modo servidor
    iniciarBotServidor(null, tokenFinal);
}

// Inicia o servidor web
app.listen(port, () => {
    console.log(`✅ Servidor NextGreen rodando na porta ${port}`);
    console.log(`🌐 Acesse http://localhost:${port}/health para verificar o status.`);
    console.log(`⏳ Aguardando o SDK conectar...`);
});