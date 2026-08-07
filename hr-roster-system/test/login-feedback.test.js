const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public/styles.css'), 'utf8');
const app = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8');
const state = fs.readFileSync(path.join(root, 'public/js/core/state.js'), 'utf8');

assert.match(html, /id="loginError"[^>]*role="alert"/);
assert.match(html, /id="loginSubmitButton"/);
assert.match(css, /\.toast\s*\{[^}]*z-index:\s*10001/s);
assert.match(css, /\.login-error-message\s*\{/);
assert.match(state, /let loginSubmitting = false/);
assert.match(app, /if \(loginSubmitting\) return/);
assert.match(app, /submitButton\.disabled = true/);
assert.match(app, /setLoginError\(error\.message/);
assert.match(app, /addEventListener\('input', \(\) => setLoginError\(''\)\)/);

console.log('login-feedback-tests-ok');
