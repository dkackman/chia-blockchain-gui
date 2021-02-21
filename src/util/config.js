const yaml = require('js-yaml');
const fs = require('fs');
const os = require('os');
const path = require('path');

// defaults used in case of error point to the localhost daemon & its certs
let self_hostname = 'localhost';
global.daemon_rpc_ws = `wss://${self_hostname}:55400`;
global.cert_path = 'config/ssl/daemon/private_daemon.crt';
global.key_path = 'config/ssl/daemon/private_daemon.key';

function loadConfig(version) {
  try {
    // finding the right config file uses this precedence
    // 1) CHIA_ROOT environment variable
    // 2) version passed in and determined by the `chia version` call

    console.log("loadConfig=" + version);
    // check if CHIA_ROOT is set. it overrides everything else
    const config_root_dir =
      'CHIA_ROOT' in process.env
        ? process.env.CHIA_ROOT
        : path.join(os.homedir(), '.chia', version);
    
    console.log("loadConfig::config_root_dir=" + config_root_dir);
    const config = yaml.load(
      fs.readFileSync(path.join(config_root_dir, 'config/config.yaml'), 'utf8'),
    );

    console.log("loadConfig:self_hostname=" + self_hostname);
    self_hostname = config?.ui?.daemon_host ?? 'localhost'; // jshint ignore:line
    const daemon_port = config?.ui?.daemon_port ?? 55400; // jshint ignore:line

    // store these in the global object so they can be used by both main and renderer processes
    global.daemon_rpc_ws = `wss://${self_hostname}:${daemon_port}`;
    global.cert_path = path.join(
      config_root_dir,
      config?.ui?.daemon_ssl?.private_crt ??
        'config/ssl/daemon/private_daemon.crt',
    ); // jshint ignore:line
    global.key_path = path.join(
      config_root_dir,
      config?.ui?.daemon_ssl?.private_key ??
        'config/ssl/daemon/private_daemon.key',
    ); // jshint ignore:line
  } catch (e) {
    console.log('loadConfig::Error loading config - using defaults');
    console.log(e);
  }
}

function manageDaemonLifetime() {
  // only start/stop daemon if it is running locally
  return self_hostname === 'localhost';
}

module.exports = {
  loadConfig,
  manageDaemonLifetime,
  self_hostname,
};
