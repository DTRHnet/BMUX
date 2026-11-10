# BMUX CSP (Content Security Policy) Handling

**Version 1.0.0** — the rules in `rules.json` and the `declarativeNetRequest`
permission as shipped.

## The Problem

Many websites (GitHub, Google, Facebook, Twitter, etc.) use HTTP headers to prevent their content from being embedded in iframes:

1. **X-Frame-Options: DENY** - Old standard blocking all iframe embedding
2. **Content-Security-Policy: frame-ancestors 'none'** - Modern standard blocking iframe embedding

When you try to load these sites in BMUX panes, you see errors like:
```
Framing 'https://github.com/' violates the following Content Security Policy directive: 
"frame-ancestors 'none'". The request has been blocked.
```

## The Solution

BMUX uses Chrome's **declarativeNetRequest** API to remove these blocking headers **only for content loaded in BMUX panes**.

### How It Works

1. **Rules File** (`rules.json`):
   - Defines which headers to remove
   - Only applies to `sub_frame` requests (iframes)
   - Does NOT affect the main page

2. **Manifest Permissions**:
   - `declarativeNetRequest` - Allows modifying HTTP headers
   - `webRequest` - Allows monitoring requests
   - `host_permissions: ["<all_urls>"]` - Allows rules to apply to any site

3. **What Gets Removed**:
   - `X-Frame-Options` header
   - `Content-Security-Policy` header
   
   These are **only removed for iframe content** loaded by BMUX.

## Security Implications

### ✅ **What BMUX Does:**
- Removes frame-blocking headers for BMUX panes only
- Allows you to view any site in a pane
- Does NOT affect the original page's security
- Does NOT affect other browser tabs

### ⚠️ **What This Means:**
- Websites you load in panes **can be embedded** despite their wishes
- Some sites use frame-blocking for security reasons (e.g., to prevent clickjacking)
- **You** are responsible for what you load in panes

### 🔒 **What BMUX Does NOT Do:**
- Does NOT bypass authentication
- Does NOT steal cookies or data
- Does NOT modify page content
- Does NOT run on pages you don't explicitly load
- Does NOT affect sites you're not actively using in BMUX

## Browser Permission Warning

When you install/reload BMUX, Chrome will show a warning:

```
BMUX can:
- Read and change all your data on all websites
```

This is **standard for extensions that modify HTTP headers**. Here's why:

- **"Read all data"**: Needed to see which headers are present
- **"Change all data"**: Needed to remove CSP/X-Frame-Options headers
- **"All websites"**: Because you can load any site in a pane

**BMUX only uses these permissions to remove frame-blocking headers for panes.**

## Sites That Will Now Work

With CSP header removal, these sites will load in BMUX panes:

✅ GitHub  
✅ Google (Gmail, Drive, etc.)  
✅ Facebook  
✅ Twitter/X  
✅ LinkedIn  
✅ Reddit  
✅ YouTube  
✅ Stack Overflow  
✅ Most banking sites  

## Sites That May Still Have Issues

Some sites use additional anti-iframe techniques:

- **JavaScript iframe busters**: Code that detects if the page is in an iframe and redirects/breaks
- **Cookie restrictions**: Sites that block cookies in third-party contexts
- **Login redirects**: Sites that redirect to login when in an iframe

For these cases, you may need to:
1. Use the `url` command to reload
2. Clear cookies/cache
3. Load directly in main browser first

## Testing

1. **Reload Extension**: Go to `chrome://extensions` and click Reload
2. **Refresh Page**: Reload the webpage
3. **Try GitHub**: 
   ```
   - Open BMUX
   - Initial pane should show GitHub
   - Split (%) - new pane also shows GitHub
   - No CSP errors in console
   ```

## Disabling CSP Removal

If you don't want this behavior:

1. Remove `declarativeNetRequest` from `manifest.json` permissions
2. Remove the `declarative_net_request` section from `manifest.json`
3. Delete `rules.json`
4. Reload extension

**Note**: Without CSP removal, many major sites will not load in panes.

## Privacy & Trust

### What You Should Know:

1. **Open Source**: All BMUX code is visible in your installation folder
2. **No Analytics**: BMUX doesn't phone home or track usage
3. **No Ads**: BMUX doesn't inject ads or modify page content
4. **Local Only**: All state is stored locally in your browser

### What Gets Sent Over Network:

- **Nothing by BMUX itself**: The extension only modifies headers, doesn't send data
- **Normal page requests**: Pages loaded in panes make their normal HTTP requests
- **Your browsing**: You control what sites you visit in panes

## Comparison to Other Extensions

Many productivity extensions use similar techniques:

| Extension Type | Permissions | Use Case |
|----------------|-------------|----------|
| **Ad Blockers** | declarativeNetRequest + all_urls | Remove ads/tracking |
| **Privacy Tools** | declarativeNetRequest + all_urls | Block cookies/headers |
| **Developer Tools** | declarativeNetRequest + all_urls | Modify requests/responses |
| **BMUX** | declarativeNetRequest + all_urls | Remove frame-blocking |

BMUX uses **less intrusive modifications** than ad blockers (which modify page content).

## Alternative Approach (Without CSP Removal)

If you prefer not to grant these permissions:

### Option 1: Limited Functionality
- Remove CSP-removal features
- Only load sites that allow iframe embedding
- Many major sites won't work

### Option 2: Proxy Approach
- Route pane traffic through a proxy that strips headers
- Requires external proxy server
- Slower, more complex

### Option 3: WebExtension Policy Override (Firefox Only)
- Firefox has alternative APIs
- Chrome doesn't support this
- Not cross-browser compatible

## Recommended: Keep CSP Removal

For the best BMUX experience:
- ✅ Leave `declarativeNetRequest` enabled
- ✅ Allow the extension permissions
- ✅ Trust that BMUX only removes frame-blocking headers

**BMUX is designed to be a faithful browser TMUX implementation, and frame-blocking headers would break the core functionality.**

## FAQ

**Q: Is this safe?**  
A: Yes. BMUX only removes headers that prevent iframe embedding. It doesn't steal data or modify content.

**Q: Will this slow down my browser?**  
A: No. declarativeNetRequest is very efficient and processed natively by Chrome.

**Q: Can I see what headers are being removed?**  
A: Yes. Open DevTools → Network tab → Click any iframe request → Headers tab → "Response Headers"

**Q: Does this work in Firefox?**  
A: Untested. The manifest is Manifest V3 written for Chromium (`service_worker`,
`declarativeNetRequest`); Firefox would need `background.scripts`/event pages and a
check of its `declarativeNetRequest` support. No Firefox run is recorded.

**Q: Why not ask permission per-site?**  
A: Chrome's API doesn't support per-site prompts for header removal. It's all-or-nothing.

**Q: Can I trust this extension?**  
A: The code is fully visible in your installation. You can audit it anytime.

---

**BMUX prioritizes functionality while respecting user privacy and browser security where possible.**
