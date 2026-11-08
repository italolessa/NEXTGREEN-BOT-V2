const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    // Escuta os sinais do bot
    onNovoSinal: (callback) => ipcRenderer.on('novo-sinal', (_event, value) => callback(value)),
    
    // Botões de controle
    configurarBusca: (config) => ipcRenderer.send('configurar-busca', config),
    aprovarSinal: (dados) => ipcRenderer.send('aprovar-sinal', dados),
    
    // NOVAS PONTES DE CONTROLE NA NUVEM
    pararBusca: () => ipcRenderer.send('parar-busca'),
    resetarFiltros: () => ipcRenderer.send('resetar-filtros'),
    
    // Funções de Login
    fazerLogout: () => ipcRenderer.send('fazer-logout'),
    verificarLoginSalvo: (callback) => {
        ipcRenderer.send('verificar-login-salvo');
        ipcRenderer.on('status-login-salvo', (_event, temLogin) => callback(temLogin));
    },
    iniciarLogin: (dados) => ipcRenderer.send('iniciar-login', dados),
    fazerLoginSalvo: () => ipcRenderer.send('login-automatico')
});