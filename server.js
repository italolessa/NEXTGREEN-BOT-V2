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

// Atualiza o Token via API do Render
app.post('/api/atualizar-token', async (req, res) => {
    const novoToken = req.body.token;
    if (!novoToken) return res.status(400).json({ error: "Token inválido" });

    tokenAtual = novoToken;
    console.log("🔄 Novo Token recebido do App! Iniciando conexão local e atualizando Render...");
    
    const { iniciarBotServidor } = require('./backend/bot_servidor');
    iniciarBotServidor(null, tokenAtual);

    try {
        const apiKey = process.env.RENDER_API_KEY;
        const serviceId = process.env.RENDER_SERVICE_ID;

        if (apiKey && serviceId) {
            const response = await axios.get(`https://api.render.com/v1/services/${serviceId}/env-vars`, {
                headers: { Authorization: `Bearer ${apiKey}` }
            });
            
            let envVars = response.data.map(env => {
                // A API do Render retorna um objeto com "envVar", precisamos ajustar
                if (env.envVar && env.envVar.key === 'POLARIUM_TOKEN') env.envVar.value = novoToken;
                return env;
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

// --- NOVA ROTA: Parar a busca (para o celular) ---
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