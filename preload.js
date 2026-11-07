const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    onNovoSinal: (callback) => ipcRenderer.on('novo-sinal', (_event, value) => callback(value)),
    configurarBusca: (config) => ipcRenderer.send('configurar-busca', config),
    fazerLogout: () => ipcRenderer.send('fazer-logout'),
    
    verificarLoginSalvo: (callback) => {
        ipcRenderer.send('verificar-login-salvo');
        ipcRenderer.on('status-login-salvo', (_event, temLogin) => callback(temLogin));
    },
    iniciarLogin: (dados) => ipcRenderer.send('iniciar-login', dados),
    fazerLoginSalvo: () => ipcRenderer.send('login-automatico')
});