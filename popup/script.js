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

// New Session Button
document.getElementById('new-session-btn').addEventListener('click', () => {
    chrome.runtime.sendMessage({ command: 'new-session' }, (response) => {
        console.log("Session created", response);
        window.close();
    });
});
