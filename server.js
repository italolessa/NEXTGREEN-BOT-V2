const express = require('express');
const cors = require('cors');
const axios = require('axios'); // Precisamos do axios aqui
const app = express();
const port = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());

let sinaisEncontrados = [];
let configuracaoAtual = { timeframe: 'M1', mercado: 'OTC', ignorarAtivo: null };
let tokenAtual = process.env.POLARIUM_TOKEN || ''; 

app.get('/health', (req, res) => res.status(200).send('OK'));

// --- A ATUALIZAÇÃO DEFINITIVA ---
app.post('/api/atualizar-token', async (req, res) => {
    const novoToken = req.body.token;
    if (!novoToken) return res.status(400).json({ error: "Token inválido" });

    tokenAtual = novoToken;
    console.log("🔄 Novo Token recebido do App! Iniciando conexão local e atualizando Render...");
    
    // 1. Inicia o bot com o token novo na memória
    const { iniciarBotServidor } = require('./backend/bot_servidor');
    iniciarBotServidor(null, tokenAtual);

    // 2. Salva o token nas variáveis de ambiente do Render via API
    try {
        const apiKey = process.env.RENDER_API_KEY;
        const serviceId = process.env.RENDER_SERVICE_ID;

        if (apiKey && serviceId) {
            // Pega a lista atual de variáveis
            const response = await axios.get(`https://api.render.com/v1/services/${serviceId}/env-vars`, {
                headers: { Authorization: `Bearer ${apiKey}` }
            });
            
            // Atualiza o valor do POLARIUM_TOKEN
            let envVars = response.data.map(env => {
                if (env.key === 'POLARIUM_TOKEN') env.value = novoToken;
                return env;
            });

            // Envia de volta para o Render
            await axios.put(`https://api.render.com/v1/services/${serviceId}/env-vars`, envVars, {
                headers: { Authorization: `Bearer ${apiKey}` }
            });
            
            console.log("✅ Token salvo permanentemente no Render! O servidor está reiniciando...");
        }
    } catch (error) {
        console.error("❌ Erro ao salvar token via API:", error.message);
    }

    res.json({ success: true, message: "Token atualizado!" });
});

app.post('/api/configurar', (req, res) => {
    sinaisEncontrados = []; 
    configuracaoAtual = req.body;
    if (global.definirConfiguracao) global.definirConfiguracao(configuracaoAtual);
    global.buscando = true; 
    console.log(`⚙️ Busca ativada: ${configuracaoAtual.timeframe} | ${configuracaoAtual.mercado}`);
    res.json({ success: true });
});

app.get('/api/sinais', (req, res) => res.json(sinaisEncontrados));

global.adicionarSinal = (sinal) => {
    if (configuracaoAtual.ignorarAtivo && sinal.ativo.includes(configuracaoAtual.ignorarAtivo)) return; 
    sinaisEncontrados.unshift(sinal);
    global.buscando = false; 
};

const { iniciarBotServidor } = require('./backend/bot_servidor');
if (tokenAtual && tokenAtual !== 'COLE_SEU_TOKEN_AQUI') {
    iniciarBotServidor(null, tokenAtual);
}

app.listen(port, () => console.log(`✅ Servidor API rodando na porta ${port}`));