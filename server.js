const express = require('express');
const cors = require('cors');
const axios = require('axios');
const app = express();
const port = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());

let sinaisEncontrados = [];
let configuracaoAtual = { timeframe: 'M1', mercado: 'OTC', ignorarAtivo: null };
let tokenAtual = process.env.POLARIUM_TOKEN || ''; 

app.get('/health', (req, res) => res.status(200).send('OK'));

// --- ROTA DE ATUALIZAR TOKEN (COM TRAVA DE ESTABILIDADE) ---
app.post('/api/atualizar-token', async (req, res) => {
    const novoToken = req.body.token;
    if (!novoToken) return res.status(400).json({ error: "Token inválido" });

    // 1. Verifica se o token é o mesmo que já está rodando
    if (novoToken === tokenAtual) {
        console.log("✅ Token já está ativo no servidor. Ignorando reinicialização.");
        return res.json({ success: true, message: "Token já ativo" });
    }

    // 2. Se for um token novo, atualiza e reinicia o SDK
    tokenAtual = novoToken;
    console.log("🔄 Novo Token recebido! Iniciando conexão local e atualizando Render...");
    
    const { iniciarBotServidor } = require('./backend/bot_servidor');
    iniciarBotServidor(null, tokenAtual);

    try {
        const apiKey = process.env.RENDER_API_KEY;
        const serviceId = process.env.RENDER_SERVICE_ID;

        if (apiKey && serviceId) {
            const response = await axios.get(`https://api.render.com/v1/services/${serviceId}/env-vars`, {
                headers: { Authorization: `Bearer ${apiKey}` }
            });
            
            let envVars = response.data.map(item => {
                let val = item.envVar ? item.envVar : item; 
                if (val.key === 'POLARIUM_TOKEN') val.value = novoToken;
                return val;
            });

            await axios.put(`https://api.render.com/v1/services/${serviceId}/env-vars`, envVars, {
                headers: { Authorization: `Bearer ${apiKey}` }
            });
            
            console.log("✅ Token salvo permanentemente no Render!");
        }
    } catch (error) {
        console.error("❌ Erro ao salvar token via API:", error.message);
    }

    res.json({ success: true, message: "Token atualizado!" });
});

// Rota para iniciar a busca
app.post('/api/configurar', (req, res) => {
    sinaisEncontrados = []; 
    configuracaoAtual = req.body;
    if (global.definirConfiguracao) global.definirConfiguracao(configuracaoAtual);
    global.buscando = true; 
    console.log(`⚙️ Busca ativada: ${configuracaoAtual.timeframe} | ${configuracaoAtual.mercado}`);
    res.json({ success: true });
});

// --- ROTA DE PARAR (Para o Celular desligar o radar) ---
app.post('/api/parar', (req, res) => {
    global.buscando = false;
    sinaisEncontrados = []; 
    console.log("🛑 Comando de parada recebido. Radar desligado.");
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