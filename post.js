const core = require('@actions/core');
const { execFileSync } = require('child_process');

const namespace = core.getInput('namespace');


function exec(cmd, args, stdin) {
  core.debug(`$ ${cmd} ${args.join(' ')}`);
  if (stdin) {
    execFileSync(cmd, args, { input: stdin, stdio: ['pipe', 'inherit', 'inherit'] });
  }
  else {
    execFileSync(cmd, args, { stdio: 'inherit' });
  }
}

// perform clean shutdown to ensure that data are flushed to OpenObserve
exec('helm', ['uninstall', '-n', namespace, 'vector-agent']);
exec('helm', ['uninstall', '-n', namespace, 'vector-aggregator']);
exec('kubectl', ['delete', 'namespace', namespace]);

exec('kind', ['delete', 'cluster']);
