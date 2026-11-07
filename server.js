const express = require('express');
const cors = require('cors');
const app = express();
const port = process.env.PORT || 10000;

app.use(cors());
app.use(express.json()); // Permite receber dados do app

let sinaisEncontrados = [];
let configuracaoAtual = { timeframe: 'M1', mercado: 'OTC' };

app.get('/health', (req, res) => res.status(200).send('OK'));

// Rota que o App envia a configuração (M1/M5, OTC/Aberto)
app.post('/api/configurar', (req, res) => {
    configuracaoAtual = req.body;
    console.log(`⚙️ Configuração recebida: ${configuracaoAtual.timeframe} | ${configuracaoAtual.mercado}`);
    res.json({ success: true, config: configuracaoAtual });
});

// Rota que o App busca os sinais
app.get('/api/sinais', (req, res) => {
    res.json(sinaisEncontrados);
});

// Função que o bot usa para salvar o sinal
global.adicionarSinal = (sinal) => {
    // Só salva se o sinal bater com a configuração atual escolhida no app
    if (sinal.timeframe === configuracaoAtual.timeframe && sinal.mercado === configuracaoAtual.mercado) {
        sinaisEncontrados.unshift(sinal);
        if (sinaisEncontrados.length > 50) sinaisEncontrados.pop();
    }
};

const { iniciarBotServidor } = require('./backend/bot_servidor');
const tokenPolarium = process.env.POLARIUM_TOKEN || 'COLE_SEU_TOKEN_AQUI';

if (tokenPolarium) iniciarBotServidor(null, tokenPolarium);

app.listen(port, () => console.log(`✅ Servidor API rodando na porta ${port}`));