/**
 * 启动所有 Agent
 * 运行: node slave-all.js
 */

const { spawn } = require('child_process');
const path = require('path');

const AGENTS = [
  { name: '包工头', file: 'slave-ceo.js' },
  { name: '桥王', file: 'slave-cto.js' },
  { name: '天文台', file: 'slave-cro.js' },
  { name: '蛇头', file: 'slave-coo.js' },
  { name: '驴仔', file: 'slave-pm.js' },
  { name: '忍者神龟', file: 'slave-qd.js' }
];

const processes = [];

console.log('===========================================');
console.log('  启动所有 Agent...');
console.log('===========================================');

AGENTS.forEach((agent, index) => {
  const agentPath = path.join(__dirname, 'agents', agent.file);

  console.log(`启动 ${agent.name}...`);

  const proc = spawn('node', [agentPath], {
    cwd: __dirname,
    stdio: 'inherit'
  });

  proc.on('close', (code) => {
    console.log(`${agent.name} 退出，代码: ${code}`);
  });

  proc.on('error', (err) => {
    console.error(`${agent.name} 错误: ${err.message}`);
  });

  processes.push(proc);
});

console.log('===========================================');
console.log('  所有 Agent 已启动');
console.log('===========================================');

// 优雅关闭
function shutdown() {
  console.log('\n关闭所有 Agent...');
  processes.forEach((proc) => {
    if (proc && proc.kill) {
      proc.kill('SIGTERM');
    }
  });
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
