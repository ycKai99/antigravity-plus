const PRESETS = ['high-contrast', 'claude-desktop-purewhite', 'vintage-deep', 'high-contrast-dark'];

function readPresetArg(args) {
    let preset = null;
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--preset') {
            preset = args[++i];
            if (!preset || preset.startsWith('-')) {
                throw new Error('--preset requires a preset name. Available: ' + PRESETS.join(', '));
            }
        } else if (args[i].startsWith('--preset=')) {
            preset = args[i].slice('--preset='.length);
        } else {
            continue;
        }
        if (!PRESETS.includes(preset)) {
            throw new Error('Invalid theme preset: ' + preset + '. Available: ' + PRESETS.join(', '));
        }
    }
    return preset;
}

module.exports = { PRESETS, readPresetArg };
