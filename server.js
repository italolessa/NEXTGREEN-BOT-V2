const express = require('express');
const cors = require('cors');
const app = express();
const port = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());

let sinaisEncontrados = [];
let configuracaoAtual = { timeframe: 'M1', mercado: 'OTC', ignorarAtivo: null };
let tokenAtual = process.env.POLARIUM_TOKEN || '';
let botInstance = null; // Para guardar a referência do bot

app.get('/health', (req, res) => res.status(200).send('OK'));

// --- ROTA MÁGICA: Recebe o token do seu PC e reinicia o robô na nuvem ---
app.post('/api/atualizar-token', (req, res) => {
    const novoToken = req.body.token;
    if (novoToken) {
        tokenAtual = novoToken;
        console.log("🔄 Novo Token recebido do App! Reiniciando conexão com a Polarium...");
        
        const { iniciarBotServidor } = require('./backend/bot_servidor');
        // Reinicia o bot com o token novo
        iniciarBotServidor(null, tokenAtual);
        
        res.json({ success: true, message: "Token atualizado e bot reiniciado na nuvem!" });
    } else {
        res.status(400).json({ error: "Token inválido" });
    }
});

// Rota que o App envia a configuração (M1/M5, OTC/Aberto)
app.post('/api/configurar', (req, res) => {
    sinaisEncontrados = []; 
    configuracaoAtual = req.body;
    
    if (global.definirConfiguracao) {
        global.definirConfiguracao(configuracaoAtual);
    }
    
    global.buscando = true; 
    console.log(`⚙️ Busca ativada: ${configuracaoAtual.timeframe} | ${configuracaoAtual.mercado}`);
    res.json({ success: true });
});

// Rota que o App busca os sinais
app.get('/api/sinais', (req, res) => {
    res.json(sinaisEncontrados);
});

// Função que o bot usa para salvar o sinal
global.adicionarSinal = (sinal) => {
    if (configuracaoAtual.ignorarAtivo && sinal.ativo.includes(configuracaoAtual.ignorarAtivo)) {
        return; 
    }
    sinaisEncontrados.unshift(sinal);
    global.buscando = false; 
};

// --- INICIALIZAÇÃO DO BOT NA NUVEM ---
const { iniciarBotServidor } = require('./backend/bot_servidor');
if (tokenAtual && tokenAtual !== 'COLE_SEU_TOKEN_AQUI') {
    iniciarBotServidor(null, tokenAtual);
}

app.listen(port, () => console.log(`✅ Servidor API rodando na porta ${port}`));