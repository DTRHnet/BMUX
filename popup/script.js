document.getElementById('attach-btn').addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
        chrome.tabs.sendMessage(tab.id, { command: 'toggle-bmux' });
        window.close();
    }
});

document.getElementById('new-btn').addEventListener('click', () => {
    chrome.runtime.sendMessage({ command: 'new-session' }, (response) => {
        console.log("Session created", response);
    });
});
