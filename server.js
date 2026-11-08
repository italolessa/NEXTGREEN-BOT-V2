const express = require('express');
const cors = require('cors');
const fs = require('fs'); // Importa o módulo de arquivos
const path = require('path');
const app = express();
const port = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());

const TOKEN_FILE = path.join(__dirname, 'token_atual.json');

let sinaisEncontrados = [];
let configuracaoAtual = { timeframe: 'M1', mercado: 'OTC', ignorarAtivo: null };

// Tenta ler o token salvo no arquivo. Se não existir, usa o da variável de ambiente.
function obterTokenSalvo() {
    try {
        if (fs.existsSync(TOKEN_FILE)) {
            return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf-8')).token;
        }
    } catch (e) {}
    return process.env.POLARIUM_TOKEN || '';
}

let tokenAtual = obterTokenSalvo();

app.get('/health', (req, res) => res.status(200).send('OK'));

// --- ROTA MÁGICA: Recebe o token do seu PC e salva no arquivo ---
app.post('/api/atualizar-token', (req, res) => {
    const novoToken = req.body.token;
    if (novoToken) {
        tokenAtual = novoToken;
        // Salva o token no arquivo para persistir mesmo se o Render reiniciar
        fs.writeFileSync(TOKEN_FILE, JSON.stringify({ token: novoToken }), 'utf-8');
        
        console.log("🔄 Novo Token recebido do App! Salvo e reiniciando conexão...");
        
        const { iniciarBotServidor } = require('./backend/bot_servidor');
        iniciarBotServidor(null, tokenAtual);
        
        res.json({ success: true, message: "Token atualizado e salvo na nuvem!" });
    } else {
        res.status(400).json({ error: "Token inválido" });
    }
});

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

app.get('/api/sinais', (req, res) => {
    res.json(sinaisEncontrados);
});

global.adicionarSinal = (sinal) => {
    if (configuracaoAtual.ignorarAtivo && sinal.ativo.includes(configuracaoAtual.ignorarAtivo)) {
        return; 
    }
    sinaisEncontrados.unshift(sinal);
    global.buscando = false; 
};

const { iniciarBotServidor } = require('./backend/bot_servidor');
if (tokenAtual && tokenAtual !== 'COLE_SEU_TOKEN_AQUI') {
    console.log("🔑 Usando token salvo em disco para iniciar.");
    iniciarBotServidor(null, tokenAtual);
}

app.listen(port, () => console.log(`✅ Servidor API rodando na porta ${port}`));