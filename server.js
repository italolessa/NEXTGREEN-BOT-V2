const express = require('express');
const app = express();
const port = process.env.PORT || 10000;

// Rota de saúde para o UptimeRobot
app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

// Importa o cérebro do robô
const { iniciarBotServidor } = require('./backend/bot_servidor');

// =====================================================================
// ⚠️ CONFIGURAÇÃO PARA TESTE LOCAL
// =====================================================================
// Se você for rodar no seu PC (node server.js), preencha aqui:
const TOKEN_MANUAL = 'COLE_SEU_TOKEN_AQUI'; 
const TIMEFRAME_MANUAL = 'M1'; // Escolha 'M1' ou 'M5'

// =====================================================================
// O Render vai usar as variáveis de ambiente. O PC usa as manuais.
// =====================================================================
const tokenFinal = process.env.POLARIUM_TOKEN || TOKEN_MANUAL;
const timeframeFinal = process.env.TIMEFRAME || TIMEFRAME_MANUAL;

if (!tokenFinal || tokenFinal === 'COLE_SEU_TOKEN_AQUI') {
    console.error("❌ ERRO: Token não configurado.");
    console.error("👉 Abra o server.js e cole seu token na variável TOKEN_MANUAL.");
} else {
    console.log(`🚀 Iniciando com Timeframe: ${timeframeFinal}`);
    iniciarBotServidor(null, tokenFinal, timeframeFinal);
}

// Inicia o servidor web
app.listen(port, () => {
    console.log(`✅ Servidor NextGreen rodando na porta ${port}`);
    console.log(`🌐 Acesse http://localhost:${port}/health para verificar o status.`);
});