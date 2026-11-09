# BMUX Implementation Update

> **Historical (0.0.1).** A snapshot of the first working command registry, when
> there were six commands. Kept as a record; for the current state see
> [IMPLEMENTATION.md](IMPLEMENTATION.md) (0.6.0, 44 commands).

## Current Status

I've successfully implemented the following:

### 1. **Command System** ✅
- Created `content/commands.js` with extensible command registry
- Implemented 6 initial commands:
  - `help` - Lists all commands
  - `source` - Shows page HTML source
  - `filter <selector>` - Filters elements by CSS selector
  - `url [new-url]` - Shows/changes pane URL
  - `reload` - Reloads the pane
  - `clear` - Clears command output

### 2. **Documentation** ✅
- Created `ADDING_COMMANDS.md` with comprehensive guide on:
  - How to add new commands
  - Command structure and format
  - Common patterns (form extraction, scraping, auto-fill)
  - Error handling and best practices
  - Complete template for new commands

### 3. **CSS Updates** ✅
- Updated `content/styles.css` with:
  - `.bmux-pane-cmd-container` - Command input area
  - `.bmux-pane-cmd-prompt` - Green ">" prompt
  - `.bmux-pane-cmd-input` - Text input field
  - `.bmux-pane-output` - Scrollable output area

### 4. **Manifest Update** ✅
- Added `commands.js` to content_scripts before `main.js`

## Remaining Changes Needed

The main JavaScript file (`content/main.js`) needs three key method updates:

### A. `renderWindow()` Method
**Current**: Creates pane with `about:blank`  
**Needed**: Use `window.location.href` as the initial pane URL

```javascript
renderWindow(windowData) {
    this.ui.panes.innerHTML = '';
    const currentUrl = window.location.href;
    const pane = this.createPaneElement(currentUrl);
    this.ui.panes.appendChild(pane);
}
```

### B. `splitWindow()` Method  
**Current**: Creates new pane with hardcoded URL  
**Needed**: Clone the active pane's URL to the new pane

```javascript
splitWindow(direction) {
    // ... existing setup code ...
    
    // Get URL from active pane to clone it
    const activeIframe = activePane.querySelector('iframe');
    const cloneUrl = activeIframe ? activeIframe.src : window.location.href;
    
    // Create new pane with cloned URL
    const newPane = this.createPaneElement(cloneUrl);
    
    // ... rest of split logic ...
}
```

### C. New `createPaneElement()` Method
**Purpose**: Factory method to create a pane with iframe + command input

```javascript
createPaneElement(url) {
    const pane = document.createElement('div');
    pane.className = 'bmux-pane active';
    pane.style.flex = '1';

    // Iframe
    const iframe = document.createElement('iframe');
    iframe.src = url || window.location.href;
    pane.appendChild(iframe);

    // Footer with command input
    const footer = document.createElement('div');
    footer.className = 'bmux-pane-footer';

    // Command Input Container
    const cmdContainer = document.createElement('div');
    cmdContainer.className = 'bmux-pane-cmd-container';
    
    const prompt = document.createElement('span');
    prompt.className = 'bmux-pane-cmd-prompt';
    prompt.textContent = '>';
    
    const input = document.createElement('input');
    input.className = 'bmux-pane-cmd-input';
    input.type = 'text';
    input.placeholder = 'Type "help" for commands';
    
    cmdContainer.appendChild(prompt);
    cmdContainer.appendChild(input);

    // Output Container
    const output = document.createElement('div');
    output.className = 'bmux-pane-output';

    footer.appendChild(cmdContainer);
    footer.appendChild(output);
    pane.appendChild(footer);

    // Bind command input
    input.addEventListener('keydown', async (e) => {
        if (e.key === 'Enter') {
            const cmdText = input.value.trim();
            input.value = '';
            
            if (cmdText) {
                await this.executePaneCommand(pane, cmdText, output);
            }
            e.stopPropagation();
        }
    });

    return pane;
}
```

### D. New `executePaneCommand()` Method
**Purpose**: Execute commands from the pane's input

```javascript
async executePaneCommand(pane, cmdText, output) {
    const [cmd, ...args] = cmdText.split(' ');
    
    this.log(`Pane Command: ${cmdText}`);
    
    // Check if command exists
    if (typeof BMUX_COMMANDS === 'undefined') {
        output.textContent = 'Error: Command system not loaded';
        output.classList.add('visible');
        return;
    }

    const commandDef = BMUX_COMMANDS[cmd];
    if (!commandDef) {
        output.textContent = `Unknown command: ${cmd}. Type "help" for available commands.`;
        output.classList.add('visible');
        return;
    }

    // Execute command
    try {
        const result = await commandDef.execute(pane, args);
        output.textContent = result;
        output.classList.add('visible');
        
        // Auto-hide output after 5 seconds for non-help/non-error messages
        if (cmd !== 'help' && !result.startsWith('Error')) {
            setTimeout(() => {
                output.classList.remove('visible');
            }, 5000);
        }
    } catch (e) {
        output.textContent = `Error executing ${cmd}: ${e.message}`;
        output.classList.add('visible');
    }
}
```

### E. Update `buildNode()` Method
**Change**: Call `createPaneElement()` instead of inline creation

```javascript
buildNode(node) {
    if (node.type === 'pane') {
        return this.createPaneElement(node.url || window.location.href);
    } else if (node.type === 'container') {
        // ... existing container logic ...
    }
    return document.createElement('div');
}
```

## Manual Implementation Steps

1. **Open** `content/main.js`
2. **Find** the `renderWindow` method (around line 427)
3. **Replace** with version A above
4. **Find** the `splitWindow` method (around line 377)
5. **Update** to get and clone the URL (version B)
6. **Add** two new methods after `renderWindow`:
   - `createPaneElement()` (version C)
   - `executePaneCommand()` (version D)
7. **Find** the `buildNode` method (around line 436)
8. **Update** to use `createPaneElement()` (version E)
9. **Remove** the old manual footer creation from `buildNode`

## Testing

After implementation:

1. **Reload extension** in `chrome://extensions`
2. **Refresh the page**
3. **Activate BMUX** (Alt+Shift+B or popup)
4. **Verify**: Initial pane shows current page
5. **Split**: New pane should clone the URL
6. **Type** `help` in pane command input
7. **Test** commands like `source`, `filter div`, `url`

## Files Modified Summary

- ✅ `content/commands.js` - Created
- ✅ `content/styles.css` - Updated
- ✅ `manifest.json` - Updated
- ✅ `ADDING_COMMANDS.md` - Created
- ⏳ `content/main.js` - Needs manual updates (backup created as `main.js.backup`)

The system is 90% complete. The remaining task is updating `content/main.js` with the 5 method changes outlined above.
