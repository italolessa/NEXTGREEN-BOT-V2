const express = require('express');
const cors = require('cors');
const app = express();
const port = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());

let sinaisEncontrados = [];
let configuracaoAtual = { timeframe: 'M1', mercado: 'OTC', ignorarAtivo: null };

app.get('/health', (req, res) => res.status(200).send('OK'));

// Rota que o App envia a configuração
app.post('/api/configurar', (req, res) => {
    sinaisEncontrados = []; // Limpa sinais antigos
    configuracaoAtual = req.body;
    global.buscando = true; // Ativa a busca no cérebro do bot
    console.log(`⚙️ Nova configuração recebida. Ignorando ativo: ${configuracaoAtual.ignorarAtivo || 'Nenhum'}`);
    res.json({ success: true });
});

// Rota que o App busca os sinais
app.get('/api/sinais', (req, res) => {
    res.json(sinaisEncontrados);
});

// Função que o bot usa para salvar o sinal
global.adicionarSinal = (sinal) => {
    // Se o ativo que o bot achou for o mesmo que o app mandou ignorar, ele descarta
    if (configuracaoAtual.ignorarAtivo && sinal.ativo.includes(configuracaoAtual.ignorarAtivo)) {
        console.log(`⏳ [IGNORADO PELO APP] ${sinal.ativo}`);
        return; 
    }
    
    sinaisEncontrados.unshift(sinal);
    global.buscando = false; // Para a busca após enviar o sinal
};

// --- CÓDIGO DO BOT NA NUVEM ---
const { iniciarBotServidor } = require('./backend/bot_servidor');
const tokenPolarium = process.env.POLARIUM_TOKEN || 'COLE_SEU_TOKEN_AQUI';
if (tokenPolarium) {
    iniciarBotServidor(null, tokenPolarium);
}

app.listen(port, () => console.log(`✅ Servidor API rodando na porta ${port}`));