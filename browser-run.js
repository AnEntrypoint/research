// Runs one export of an ES module inside a fresh playwriter session and returns its JSON result.
const { spawnSync } = require('child_process');
const { pathToFileURL } = require('url');

function playwriter(cliArgs, timeout) {
    const env = { ...process.env, PLAYWRITER_EXEC_TIMEOUT: '300000' };
    if (process.platform !== 'win32') return spawnSync('playwriter', cliArgs, { encoding: 'utf8', timeout, env });
    const line = ['playwriter', ...cliArgs.map(a => `"${a.replace(/"/g, '\\"')}"`)].join(' ');
    return spawnSync('cmd.exe', ['/d', '/s', '/c', line], { encoding: 'utf8', timeout, env, windowsVerbatimArguments: true });
}

const output = r => `${r.stdout || ''}${r.stderr || ''}`;

function runInBrowser(modulePath, exportName, args) {
    const created = playwriter(['session', 'new'], 60000);
    const sessionId = output(created).split(/\r?\n/).map(s => s.trim()).filter(s => /^[\w-]+$/.test(s)).pop();
    if (!sessionId) throw new Error(`Could not start a playwriter session:\n${output(created).trim()}`);
    try {
        const moduleUrl = JSON.stringify(pathToFileURL(modulePath).href);
        const call = `m[${JSON.stringify(exportName)}]({ context, ...${JSON.stringify(args)} })`;
        const code = `const m = await import(${moduleUrl}); try { console.log('BROWSER_RESULT ' + JSON.stringify(await ${call})); } catch (e) { console.log('BROWSER_ERROR ' + e.message); }`;
        const text = output(playwriter(['-s', sessionId, '-e', code], 330000));
        const ok = text.match(/BROWSER_RESULT (.+)/);
        const err = text.match(/BROWSER_ERROR (.+)/);
        if (!ok) throw new Error(err ? err[1] : `playwriter returned no result:\n${text.trim()}`);
        return JSON.parse(ok[1]);
    } finally {
        playwriter(['session', 'delete', sessionId], 30000);
    }
}

module.exports = { runInBrowser };
