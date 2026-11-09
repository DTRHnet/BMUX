# BMUX Cross-Origin Handling

**Version 0.6.0** — behaviour of the shipped code; see [IMPLEMENTATION.md](IMPLEMENTATION.md)
for where these decisions live.

## Overview

BMUX now properly handles cross-origin restrictions that occur when panes load content from different domains than the parent page.

## What is Cross-Origin Restriction?

When an iframe loads content from a different origin (domain/protocol/port), the browser's **Same-Origin Policy** prevents:
- Accessing `iframe.contentDocument`
- Reading `iframe.contentWindow.location.href`
- Manipulating the iframe's DOM
- Executing scripts within the iframe

This is a **security feature** to prevent malicious websites from stealing data.

## How BMUX Handles It

### 1. **Safe Helper Functions** (`content/commands.js`)

```javascript
// Safely access iframe document
function safeGetIframeDocument(iframe) {
    if (!iframe) return null;
    try {
        return iframe.contentDocument || iframe.contentWindow.document;
    } catch (e) {
        return null; // Cross-origin restriction
    }
}

// Check if iframe is accessible
function isIframeAccessible(iframe) {
    return safeGetIframeDocument(iframe) !== null;
}

// Safely get iframe URL
function safeGetIframeUrl(iframe) {
    if (!iframe) return null;
    try {
        return iframe.contentWindow.location.href;
    } catch (e) {
        // Cross-origin - fall back to src attribute
        return iframe.src || iframe.getAttribute('src');
    }
}
```

### 2. **Graceful Error Messages**

Instead of cryptic errors, BMUX provides clear, helpful messages:

```
Error: Cross-origin content cannot be accessed
URL: https://example.com/page

Tip: Cross-origin restrictions prevent inspecting external sites.
```

### 3. **Fallback Strategies**

For operations that can work around cross-origin:

**URL Reading:**
- Try: `iframe.contentWindow.location.href` (same-origin)
- Fallback: `iframe.src` (always works)

**Reloading:**
- Try: `iframe.contentWindow.location.reload()` (same-origin)
- Fallback: `iframe.src = iframe.src` (works cross-origin)

**Splitting Panes:**
- Always uses `src` attribute as fallback
- Logs when cross-origin fallback is used

## Commands and Cross-Origin Support

### ✅ Always Work (Cross-Origin Safe)

| Command | Description | How It Works |
|---------|-------------|--------------|
| `url` | Show/change URL | Reads `src` attribute |
| `url <new-url>` | Navigate | Sets `src` attribute |
| `reload` | Reload pane | Falls back to `src = src` |
| `clear` | Clear output | Only affects BMUX UI |
| `help` | List commands | Doesn't touch iframe |

### ⚠️ Same-Origin Only

| Command | Description | Behavior |
|---------|-------------|----------|
| `source` | Show HTML source | Returns error with URL info |
| `filter <selector>` | Find and box elements | Returns error with URL info; nothing is boxed |
| `capture-pane` | Print the pane's text | Returns error with URL info |

## What Users See

### Same-Origin Content (e.g., `file://`, same domain)
```
> source
Source logged to console (15234 chars)

> filter div
=== Found 47 element(s): "div" ===
[0] DIV.container
[1] DIV#header
...
```

### Cross-Origin Content (e.g., `https://google.com`)
```
> source
Error: Cross-origin content cannot be accessed
URL: https://www.google.com/

Tip: Cross-origin restrictions prevent inspecting external sites.

> filter div
Error: Cross-origin content
URL: https://www.google.com/

Tip: Use 'url' command to load a same-origin page.

> url
Current URL: https://www.google.com/

> reload
Reloading (cross-origin compatible)...
```

## Split Pane Behavior

When splitting, BMUX safely clones the URL:

### Same-Origin
```
Split horizontal: Cloned https://mysite.com/page
```

### Cross-Origin
```
Cross-origin: Using src attribute (https://external.com/...)
Split horizontal: 50/50
```

## Browser Console Debugging

BMUX logs cross-origin events to help developers:

```javascript
console.log("[BMUX client] > split-window -h");
console.log("[BMUX client] Split horizontal: 50/50");
```

`verbose on` mirrors those lines into the focused pane console, and `info` prints
the current layout and pane URLs, so cross-origin decisions can be followed without
the debug window open.

## Permissions

BMUX currently uses standard web extension permissions:
- `tabs` - For managing panes
- `activeTab` - For current tab access
- `storage` - For saving state
- `scripting` - For content scripts

**Note**: Even with all permissions, the browser **will not** allow cross-origin iframe DOM access. This is a fundamental browser security restriction.

## Workarounds for Advanced Users

If you need to inspect cross-origin content:

### Option 1: Use Browser DevTools
1. Right-click the pane iframe
2. Select "Inspect Element"
3. Use DevTools to explore the content

### Option 2: Load Same-Origin Proxy
```
> url https://cors-anywhere.herokuapp.com/https://example.com
```
(Note: Use trusted proxy services only)

### Option 3: Develop Custom Extension
For advanced cross-origin manipulation, you would need:
- A separate manifest permission per domain
- Or a backend proxy service
- Or browser-specific APIs (not portable)

## Best Practices

1. **Test with same-origin content** for full functionality
2. **Use `url` command** to check accessibility before other commands
3. **Commands will fail gracefully** with helpful error messages
4. **Check browser console** for detailed cross-origin logs

## Security Note

Cross-origin restrictions are **intentional security features**. BMUX respects these restrictions to:
- Protect user privacy
- Prevent data theft
- Comply with web security standards
- Maintain browser compatibility

Attempting to bypass cross-origin restrictions could:
- Violate browser extension policies
- Get the extension banned from stores
- Expose users to security risks

**BMUX is designed to work within browser security constraints.**
