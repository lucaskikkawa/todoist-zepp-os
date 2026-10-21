// Zeus 1.9.3 registers a package-relative alias via the caller's package.json.
// Resolve its shipped internal module explicitly for reproducible local installs.
const path = require('node:path');
const cliRoot = path.dirname(require.resolve('@zeppos/zeus-cli/package.json'));
require('module-alias').addAlias('zeppos-app-utils', path.join(cliRoot, 'private-modules/zeppos-app-utils'));
require(path.join(cliRoot, 'bin/main.js'));
