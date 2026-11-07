const express = require('express');
const cors = require('cors');
const app = express();
const port = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());

let sinaisEncontrados = [];

// Inicializa a configuração global para o bot ler
global.configuracaoAtual = { timeframe: 'M1', mercado: 'OTC', ignorarAtivo: null };
global.buscando = false;

app.get('/health', (req, res) => res.status(200).send('OK'));

// Quando o App no PC clica em "Buscar Ativo", ele cai aqui
app.post('/api/configurar', (req, res) => {
    sinaisEncontrados = []; // Limpa a lista de sinais antigos
    global.configuracaoAtual = req.body; // Salva as novas configs (M1/M5, OTC/Aberto, Ativo a ignorar)
    global.buscando = true; // Liga a trava para o bot começar a buscar
    
    console.log(`⚙️ Nova busca solicitada. Ignorando: ${global.configuracaoAtual.ignorarAtivo || 'Nenhum'}`);
    res.json({ success: true });
});

// O App no PC acessa essa rota a cada 3 segundos para ver se tem sinal novo
app.get('/api/sinais', (req, res) => {
    res.json(sinaisEncontrados);
});

// Função que o bot usa para enviar o sinal encontrado
global.adicionarSinal = (sinal) => {
    sinaisEncontrados.unshift(sinal);
    global.buscando = false; // Desliga a busca após enviar o sinal
};

// Importa e inicia o cérebro do bot
const { iniciarBotServidor } = require('./backend/bot_servidor');
const tokenPolarium = process.env.POLARIUM_TOKEN || 'COLE_SEU_TOKEN_AQUI';

if (tokenPolarium) {
    iniciarBotServidor(null, tokenPolarium);
}

app.listen(port, () => console.log(`✅ Servidor API rodando na porta ${port}`));