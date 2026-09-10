/**
 * 部署后一次性操作：
 * 1) 上传 hub 修复后的 chatService.js 并重启 knowledge-tracker
 * 2) 注入两条仿真消息验证修复（真实 mention 结构：mentioned_type=bot、id 为对象）
 *    - A: 假群 ID + content 为对象 + "help"  → 验证 @检测修复
 *    - B: 真实财务群 ID + content 为字符串 + "/approval-list" → 验证指令链路
 * 用法：node nas-e2e-test.js
 */
const { Client } = require('ssh2');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '.env') });

// 群 id 等同凭据，不硬编码进仓库：E2E_FINANCE_CHAT_ID=oc_xxx node nas-e2e-test.js
const FINANCE_CHAT_ID = process.env.E2E_FINANCE_CHAT_ID || '';
if (!FINANCE_CHAT_ID) {
  console.error('缺少 E2E_FINANCE_CHAT_ID 环境变量（财务群 chat_id），拒绝执行');
  process.exit(1);
}

const realMention = {
  key: '@_user_1',
  id: { open_id: 'ou_e2e_test', union_id: 'on_e2e_test', user_id: '' },
  mentioned_type: 'bot',
  name: '爆米花机-对话型',
  tenant_key: '160aac2e0d809758',
};

const msgA = {
  type: 'im.message.receive_v1',
  event: {
    message: {
      message_id: 'e2e_fix_A',
      message_type: 'text',
      chat_type: 'group',
      chat_id: 'oc_e2e_fake_group',
      content: { text: '@_user_1 help' },
      mentions: [realMention],
    },
    sender: { sender_id: { open_id: 'ou_e2e_sender' } },
  },
};

const msgB = {
  type: 'im.message.receive_v1',
  event: {
    message: {
      message_id: 'e2e_fix_B',
      message_type: 'text',
      chat_type: 'group',
      chat_id: FINANCE_CHAT_ID,
      content: JSON.stringify({ text: '@_user_1 /approval-list' }),
      mentions: [realMention],
    },
    sender: { sender_id: { open_id: 'ou_e2e_sender' } },
  },
};

function dq(s) { return s.replace(/'/g, "'\\''"); }

const conn = new Client();
conn.on('ready', () => {
  const sftpSteps = [
    ['../ticket-pm/project-management-robot/server/src/services/chatService.js', '/opt/knowledge-tracker/server/src/services/chatService.js'],
  ];
  conn.sftp((err, sftp) => {
    if (err) { console.error('SFTP 失败:', err.message); process.exit(1); }
    let i = 0;
    (function up() {
      if (i >= sftpSteps.length) return runCmds();
      const [local, remote] = sftpSteps[i++];
      sftp.fastPut(path.resolve(__dirname, local), remote, (e) => {
        console.log((e ? '✗ ' : '✓ ') + local + ' → ' + remote + (e ? ' ' + e.message : ''));
        if (e) process.exit(1);
        up();
      });
    })();

    function runCmds() {
      const cmds = [
        'pm2 restart knowledge-tracker 2>&1 | grep -e knowledge-tracker -e ✓ | head -3',
        'sleep 4',
        `curl -s -X POST http://localhost:3010/api/dispatch -H 'Content-Type: application/json' -d '${dq(JSON.stringify(msgA))}'`,
        'echo',
        `curl -s -X POST http://localhost:3010/api/dispatch -H 'Content-Type: application/json' -d '${dq(JSON.stringify(msgB))}'`,
        'echo',
        'sleep 5',
        'echo "===== 网关日志 ====="',
        'tail -14 /home/qianli/.pm2/logs/feishu-gateway-out.log',
        'echo "===== hub 日志 ====="',
        'tail -16 /home/qianli/.pm2/logs/knowledge-tracker-out.log',
        'echo "===== approval-bot 日志 ====="',
        'tail -8 /home/qianli/.pm2/logs/approval-bot-out.log',
      ];
      let j = 0;
      (function exec() {
        if (j >= cmds.length) { conn.end(); return; }
        conn.exec(cmds[j++], (e, stream) => {
          stream.on('data', (d) => process.stdout.write(d));
          stream.stderr.on('data', (d) => process.stderr.write(d));
          stream.on('close', (c) => { console.log(`--- [exit ${c}]`); exec(); });
        });
      })();
    }
  });
}).on('error', (e) => { console.error('SSH 失败:', e.message); process.exit(1); })
  .connect({
    host: process.env.NAS_HOST, port: Number(process.env.NAS_PORT || 22), username: process.env.NAS_USER,
    password: process.env.NAS_PASSWORD, readyTimeout: 12000,
  });
