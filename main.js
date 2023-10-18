const core = require('@actions/core');
const github = require('@actions/github');
const { execFileSync } = require('child_process');

const kindConfigFile = core.getInput('kind_config');
const openobserveEndpointRaw = core.getInput('openobserve_endpoint');
const openobserveUsername = core.getInput('openobserve_username');
const openobservePassword = core.getInput('openobserve_password');
const openobserveStream = core.getInput('openobserve_stream') || github.context.repo.repo;
const namespace = core.getInput('namespace');
const waitUntilReady = core.getInput('wait_until_ready') || false;

const openobserveEndpoint = openobserveEndpointRaw.endsWith('/') ? openobserveEndpointRaw : openobserveEndpointRaw + '/';

const vectorAgentValues = `
role: "Agent"
service:
  enabled: false
customConfig:
  data_dir: /vector-data-dir
  api:
    enabled: false
  sources:
    # https://vector.dev/docs/reference/configuration/sources/kubernetes_logs/
    kubernetes_logs:
      type: kubernetes_logs
  # https://vector.dev/docs/reference/configuration/transforms/log_to_metric/#examples-sum
  transforms:
    kubernetes_logs_with_ghactions_metadata:
      type: remap
      inputs: [ "kubernetes_logs" ]
      source: |
        .github = ${JSON.stringify(github.context)}
  sinks:
    # https://openobserve.ai/docs/ingestion/logs/vector/
    openobserve-logs:
      type: http
      inputs: [ "kubernetes_logs_with_ghactions_metadata" ]
      uri: "${openobserveEndpoint}${openobserveStream}/_json"
      method: post
      auth:
        strategy: basic
        user: "${openobserveUsername}"
        password: "${openobservePassword}"
      compression: gzip
      encoding:
        codec: json
        timestamp_format: rfc3339
      healthcheck:
        enabled: false
`;

const vectorAggregatorValues = `
role: "Stateless-Aggregator"

service:
  enabled: false

customConfig:
  data_dir: /vector-data-dir
  api:
    enabled: false
  sources:
    cadvisor:
      type: prometheus_scrape
      auth:
        strategy: bearer
        token: PLACEHOLDER
      endpoints: [ "https://placeholder/metrics/cadvisor" ]
      tls:
        verify_certificate: false
  transforms:
    cadvisor_with_ghactions_metadata:
      type: remap
      inputs: [ "cadvisor" ]
      source: |
        .tags.github_job = "${github.context.job}"
        .tags.github_owner = "${github.context.repo.owner}"
        .tags.github_repo = "${github.context.repo.repo}"
        .tags.github_event_name = "${github.context.eventName}}"
        .tags.github_run_id = ${github.context.runId}
        .tags.github_run_number = ${github.context.runNumber}
        .tags.github_workflow = "${github.context.workflow}"
        .tags.github_sha = "${github.context.sha}"
        .tags.github_ref = "${github.context.ref}"
  sinks:
    openobserve-metrics:
      type: prometheus_remote_write
      inputs: [ "cadvisor_with_ghactions_metadata" ]
      endpoint: "${openobserveEndpoint}prometheus/api/v1/write"
      auth:
        strategy: basic
        user: "${openobserveUsername}"
        password: "${openobservePassword}"
      healthcheck:
        enabled: false
`;

const clusterRole = `
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: metrics-reader
rules:
- apiGroups: [""]
  resources:
  - nodes
  - nodes/proxy
  verbs:
  - get
  - watch
  - list
---

apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: metrics-reader
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: metrics-reader
subjects:
- kind: ServiceAccount
  name: vector-aggregator
  namespace: ${namespace}
`;

core.debug('------------------------------ VALUES ------------------------------')
core.debug(vectorAgentValues);
core.debug(vectorAggregatorValues);
core.debug('------------------------------ VALUES ------------------------------')

// Helper functions
// ----------------------------------------------------------------------------------------------------


const BOLD_GREEN = '\x1B[1;32m';
const RESET = '\x1B[0m';


function exec(cmd, args, stdin) {
  console.log(`${BOLD_GREEN}$ ${cmd} ${args.join(' ')}${RESET}`);
  if (stdin) {
    execFileSync(cmd, args, { input: stdin, stdio: ['pipe', 'inherit', 'inherit'] });
  }
  else {
    execFileSync(cmd, args, { stdio: 'inherit' });
  }
}

function checkOutput(cmd, args) {
  return execFileSync(cmd, args, {encoding: 'utf-8'}).trim();
}


function getCadvisorEndpoints() {
  const envUrl = 'https://$\\{KUBERNETES_SERVICE_HOST\\}:$\\{KUBERNETES_SERVICE_PORT_HTTPS\\}';
  const endpoints = getNodes().map(node => `${envUrl}/api/v1/nodes/${node}/proxy/metrics/cadvisor`);
  return `{${endpoints.join(',')}}`;
}

function getNodes() {
  return checkOutput('kubectl', ['get', 'nodes', '-o', 'jsonpath={.items[*].metadata.name}']).split(' ');
}

function getSaToken(namespace, serviceAccount, duration) {
  return checkOutput('kubectl', ['create', 'token', '-n', namespace, `--duration=${duration}`, serviceAccount]);
}


// Script begins here
// ----------------------------------------------------------------------------------------------------

const kindConfigArgs = kindConfigFile ? ['--config', kindConfigFile] : [];
exec('kind', ['create', 'cluster'].concat(kindConfigArgs));

exec('helm', ['repo', 'add', 'vector', 'https://helm.vector.dev']);
exec('helm', ['repo', 'update', 'vector']);

// install vector agent, which collects logs
exec('helm', ['install', '--create-namespace', '-n', namespace, '-f', '-', 'vector-agent', 'vector/vector'], vectorAgentValues);


// install vector aggregator, which collects metrics from kubelets
// https://github.com/vectordotdev/vector/issues/18857
exec('helm', ['install', '-n', namespace, '-f', '-', 'vector-aggregator', 'vector/vector'], vectorAggregatorValues);
exec('kubectl', ['apply', '-f', '-'], clusterRole);
exec(
  'helm', 
  [
    'upgrade', '--reuse-values', '-n', namespace, 'vector-aggregator', 'vector/vector', 
    '--set', `customConfig.sources.cadvisor.auth.token=${getSaToken(namespace, 'vector-aggregator', '24h')}`,
    '--set', `customConfig.sources.cadvisor.endpoints=${getCadvisorEndpoints()}`
  ]
);

if (waitUntilReady) {
  exec('kubectl', ['rollout', 'status', '--timeout=5m', '-n', namespace, 'daemonset/vector-agent']);
  exec('kubectl', ['rollout', 'status', '--timeout=5m', '-n', namespace, 'deployment/vector-aggregator']);
}
