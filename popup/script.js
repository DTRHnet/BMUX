// Toggle Overlay Button
document.getElementById('toggle-overlay-btn').addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
        chrome.tabs.sendMessage(tab.id, { command: 'toggle-bmux' });
        window.close();
    }
});

// Toggle Control Mode Button
document.getElementById('toggle-control-btn').addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
        chrome.tabs.sendMessage(tab.id, { command: 'toggle-control-mode' });
        window.close();
    }
});

// Reset Layout Button: drop this tab back to a single pane
document.getElementById('reset-layout-btn').addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
        chrome.tabs.sendMessage(tab.id, { command: 'execute-line', line: 'new-window' });
        window.close();
    }
});
