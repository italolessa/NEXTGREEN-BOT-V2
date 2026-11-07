const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    // Funções do Robô
    onNovoSinal: (callback) => ipcRenderer.on('novo-sinal', (_event, value) => callback(value)),
    buscarAtivo: (config) => ipcRenderer.send('buscar-ativo', config),
    aprovarSinal: (dados) => ipcRenderer.send('aprovar-sinal', dados),
    fazerLogout: () => ipcRenderer.send('fazer-logout'),
    
    // Funções da Varredura Adaptativa
    pararBusca: () => ipcRenderer.send('parar-busca'),
    resetarFiltros: () => ipcRenderer.send('resetar-filtros'),

    // Funções de Login
    verificarLoginSalvo: (callback) => {
        ipcRenderer.send('verificar-login-salvo');
        ipcRenderer.on('status-login-salvo', (_event, temLogin) => callback(temLogin));
    },
    iniciarLogin: (dados) => ipcRenderer.send('iniciar-login', dados),
    fazerLoginSalvo: () => ipcRenderer.send('login-automatico'),

    // Funções do Histórico
    lerHistorico: () => ipcRenderer.invoke('ler-historico'),
    limparHistorico: () => ipcRenderer.invoke('limpar-historico')
});