# BMUX - Adding New Pane Commands

## Overview

BMUX uses a simple, extensible command system for pane-level commands. Each pane has a command input at the bottom (like TMUX) where users can type commands.

## Command Structure

All commands are defined in `content/commands.js` in the `BMUX_COMMANDS` object.

### Command Definition Format

```javascript
'command-name': {
    description: 'What this command does',
    usage: 'command-name [arguments]',
    execute: async function(pane, args) {
        // pane: DOM element of the pane (.bmux-pane)
        // args: array of command arguments
        
        // Your command logic here
        
        // Return a string to display in the output
        return 'Command result message';
    }
}
```

## Adding a New Command

### Step 1: Define the Command

Open `content/commands.js` and add your command to the `BMUX_COMMANDS` object:

```javascript
const BMUX_COMMANDS = {
    // ... existing commands ...
    
    'newcommand': {
        description: 'Description of what your command does',
        usage: 'newcommand <required-arg> [optional-arg]',
        execute: async function(pane, args) {
            // Validate arguments
            if (args.length === 0) {
                return 'Error: Please provide required arguments';
            }
            
            // Access the iframe in this pane
            const iframe = pane.querySelector('iframe');
            if (!iframe || !iframe.contentDocument) {
                return 'Error: Unable to access iframe content';
            }
            
            // Perform operations
            const result = doSomething(iframe, args);
            
            // Return result
            return `Success: ${result}`;
        }
    }
};
```

### Step 2: Test the Command

1. Reload the extension
2. Refresh your page
3. Activate BMUX
4. In any pane's command input (bottom of pane), type: `newcommand arg1 arg2`
5. Press Enter

### Step 3: Document the Command

Your command will automatically appear in the `help` command output.

## Built-in Commands

### help
- **Description**: List all available commands
- **Usage**: `help`
- **Returns**: Full list of commands with descriptions

### source
- **Description**: Show page source code in console
- **Usage**: `source`
- **Returns**: Logs HTML source to console

### filter
- **Description**: Filter and display specific HTML elements
- **Usage**: `filter <css-selector>`
- **Example**: `filter div`, `filter .className`, `filter #myId`
- **Returns**: List of matching elements (also logs to console)

### url
- **Description**: Show or change the current pane URL
- **Usage**: `url [new-url]`
- **Examples**:
  - `url` - Show current URL
  - `url https://example.com` - Navigate to URL

### reload
- **Description**: Reload the current pane
- **Usage**: `reload`

### clear
- **Description**: Clear the command output
- **Usage**: `clear`

## Accessing Pane Contents

### Get the Iframe

```javascript
const iframe = pane.querySelector('iframe');
```

### Access Iframe Document (same-origin only)

```javascript
const doc = iframe.contentDocument;
if (!doc) {
    return 'Error: Cross-origin restriction (cannot access content)';
}
```

### Query Elements in the Page

```javascript
const elements = doc.querySelectorAll('.some-class');
elements.forEach(el => {
    console.log(el.textContent);
});
```

### Execute Scripts in the Pane

```javascript
iframe.contentWindow.eval('alert("Hello from BMUX!")');
```

## Common Patterns

### Form Field Extraction

```javascript
'extract-forms': {
    description: 'Extract all form fields from the page',
    usage: 'extract-forms',
    execute: async function(pane, args) {
        const iframe = pane.querySelector('iframe');
        if (!iframe || !iframe.contentDocument) {
            return 'Error: Cannot access page content';
        }
        
        const forms = iframe.contentDocument.querySelectorAll('form');
        let output = `Found ${forms.length} form(s)\n\n`;
        
        forms.forEach((form, i) => {
            output += `Form ${i}:\n`;
            const inputs = form.querySelectorAll('input, textarea, select');
            inputs.forEach(input => {
                output += `  - ${input.name || input.id}: ${input.type}\n`;
            });
        });
        
        return output;
    }
}
```

### Data Scraping

```javascript
'scrape': {
    description: 'Scrape specific data from the page',
    usage: 'scrape <selector>',
    execute: async function(pane, args) {
        if (args.length === 0) {
            return 'Error: Provide a CSS selector';
        }
        
        const iframe = pane.querySelector('iframe');
        const doc = iframe.contentDocument;
        const elements = doc.querySelectorAll(args[0]);
        
        const data = Array.from(elements).map(el => el.textContent.trim());
        console.log('Scraped data:', data);
        
        return `Scraped ${data.length} items. Check console.`;
    }
}
```

### Auto-fill Forms

```javascript
'autofill': {
    description: 'Auto-fill a form field',
    usage: 'autofill <field-name> <value>',
    execute: async function(pane, args) {
        if (args.length < 2) {
            return 'Error: autofill <field-name> <value>';
        }
        
        const [fieldName, ...valueParts] = args;
        const value = valueParts.join(' ');
        
        const iframe = pane.querySelector('iframe');
        const input = iframe.contentDocument.querySelector(
            `input[name="${fieldName}"], input#${fieldName}`
        );
        
        if (!input) {
            return `Error: Field "${fieldName}" not found`;
        }
        
        input.value = value;
        return `Set ${fieldName} = ${value}`;
    }
}
```

## Error Handling

Always handle potential errors:

```javascript
execute: async function(pane, args) {
    try {
        // Your logic
        return 'Success';
    } catch (e) {
        return `Error: ${e.message}`;
    }
}
```

## Async Operations

Commands can be `async` and use `await`:

```javascript
execute: async function(pane, args) {
    const iframe = pane.querySelector('iframe');
    
    // Wait for something
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Fetch external data
    const response = await fetch('https://api.example.com/data');
    const data = await response.json();
    
    return `Fetched: ${JSON.stringify(data)}`;
}
```

## Logging vs. Returning

- **Return**: Shows output in the pane's command output area
- **console.log()**: Logs to browser DevTools console
- Use both for comprehensive feedback

```javascript
execute: async function(pane, args) {
    const data = extractData(pane);
    
    console.log('Full data:', data); // For developers
    return `Extracted ${data.length} items`; // For users
}
```

## Best Practices

1. **Always validate arguments** before processing
2. **Handle cross-origin errors** gracefully
3. **Provide clear error messages**
4. **Use consistent naming** (lowercase, hyphenated)
5. **Document complex commands** with examples
6. **Log detailed data** to console for debugging
7. **Return concise messages** to users

## Command Template

Copy this template when creating new commands:

```javascript
'my-command': {
    description: 'One-line description of what this does',
    usage: 'my-command <required> [optional]',
    execute: async function(pane, args) {
        // Validate arguments
        if (args.length === 0) {
            return `Error: Usage: ${this.usage}`;
        }
        
        // Get iframe
        const iframe = pane.querySelector('iframe');
        if (!iframe || !iframe.contentDocument) {
            return 'Error: Cannot access page content (cross-origin)';
        }
        
        try {
            // Your logic here
            const result = performOperation(iframe, args);
            
            // Log details for debugging
            console.log('[my-command] Result:', result);
            
            // Return user-friendly message
            return `Success: ${result}`;
        } catch (e) {
            return `Error: ${e.message}`;
        }
    }
}
```

Happy coding! Your new commands will be automatically available to all panes.
