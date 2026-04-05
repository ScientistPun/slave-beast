/**
 * Agent 启动脚本
 * 用法: node agent-startup.js <agent-name>
 *       node agent-startup.js all
 */

const { spawn } = require('child_process');
const AGENTS = ['ceo', 'cto', 'cro', 'coo', 'pm', 'qd'];

const args = process.argv.slice(2);

if (args.length === 0) {
  console.log('用法: node agent-startup.js <agent-name|all>');
  console.log('可用:', AGENTS.join(', '));
  process.exit(1);
}

const target = args[0].toLowerCase();

if (target === 'all') {
  console.log('启动所有 Agent...');
  AGENTS.forEach(agent => {
    spawn('node', [`./agents/${agent}.js`], { cwd: __dirname, stdio: 'inherit' });
  });
} else if (AGENTS.includes(target)) {
  console.log(`启动 Agent: ${target}`);
  spawn('node', [`./agents/${target}.js`], { cwd: __dirname, stdio: 'inherit' });
} else {
  console.error(`未知 Agent: ${target}`);
  process.exit(1);
}
