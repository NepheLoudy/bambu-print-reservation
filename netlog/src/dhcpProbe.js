// ============================================================
// dhcpProbe（v16→v17）：主路由 DHCP 服务主动探测
// 背景：2026-10-07「新设备连上没网」事故的病灶之一=RD08 固件半死时 DHCP
// 服务僵死（新关联设备拿不到任何地址）。有线侧既有探针（lan/wan/traffic）
// 全部测不到——小电脑自己是静态 IP，不依赖 DHCP。
// 原理：构造最小 DHCPDISCOVER 广播，绑 68 端口等 BOOTREPLY（OFFER/ACK，
// op=2 且 xid 匹配）。DISCOVER 不写租约（REQUEST 才写），对路由器与真实
// 租约零副作用。
// v17 勘误（2026-10-07 午后，曼波质疑成案）：RD08 对**陌生 MAC** 的首次
// DISCOVER 有 3.0~3.9s 的检查路径（查过进快表，同 MAC 第二次起毫秒级；
// 已知 MAC 恒 4-6ms）——v16 探针每次随机 MAC + 默认 3000ms 超时，等于
// 每次都走陌生路径在 3 秒线上掷骰子，router_dhcp_down/recover 振荡全是
// 伪影。修正：固定探针 MAC（02 开头本地管理位，不撞真实设备）+ 超时提到
// 5s（覆盖首查最坏 3.9s）——首查进快表后探针恒毫秒级应答，此后连续超时
// 才是真挂（真半死判据=已知 MAC 也慢/无应答）。
// 兼容性：绑 68 需系统未占用；失败返回 skipped（调用方静默降级，不告警）。
// ============================================================

const dgram = require('dgram');

/** v17 固定探针 MAC：02 开头（locally administered unicast），ASCII "NETLO" */
const DEFAULT_PROBE_MAC = [0x02, 0x4e, 0x45, 0x54, 0x4c, 0x4f];
/** v17 默认超时：覆盖陌生设备检查路径最坏 ~3.9s + 余量 */
const PROBE_TIMEOUT_MS = 5000;

/** "aa:bb:cc:dd:ee:ff"（冒号/横杠均可）→ 6 字节数组；非法返回 null */
function parseProbeMac(s) {
  if (!s) return null;
  const parts = String(s).split(/[:\-]/).map((x) => parseInt(x, 16));
  if (parts.length !== 6 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return parts;
}

/** 构造最小 DHCPDISCOVER 报文，返回 {buf, xid}；mac 缺省=随机（历史行为） */
function buildDiscover({ mac } = {}) {
  const xid = (Math.random() * 0xffffffff) >>> 0;
  const macBuf = mac && mac.length === 6
    ? Buffer.from(mac)
    : Buffer.from(Array.from({ length: 6 }, () => Math.floor(Math.random() * 256)));
  const buf = Buffer.alloc(300); // 236 固定头 + options
  buf[0] = 1;  // op=BOOTREQUEST
  buf[1] = 1;  // htype=以太网
  buf[2] = 6;  // hlen=MAC6
  buf.writeUInt32BE(xid, 4);
  buf.writeUInt16BE(0x8000, 10); // flags=BROADCAST（回应走广播，不依赖本机 IP 态）
  macBuf.copy(buf, 28);          // chaddr
  buf.writeUInt32BE(0x63825363, 236); // magic cookie
  let off = 240;
  buf[off++] = 53; buf[off++] = 1; buf[off++] = 1; // option53=DHCPDISCOVER
  buf[off] = 255;                                   // end
  return { buf, xid };
}

/**
 * 单次探测：广播 DISCOVER，等待 xid 匹配的 BOOTREPLY。
 * @param {object} [opts]
 *   - broadcastAddr  广播地址（默认 192.168.31.255）
 *   - timeoutMs      默认 PROBE_TIMEOUT_MS(5000)——v17 起覆盖陌生检查路径
 *   - mac            探针 MAC（6 字节数组）；缺省随机。**固定 MAC 首查进
 *                    快表后毫秒级应答，连续超时才是真挂**（v17 语义）
 *   - socketFactory  测试注入
 * @returns {Promise<{ok:boolean, skipped?:string, reason?:string, ms?:number}>}
 *   ok=true 收到 OFFER/ACK；ok=false 且 skipped 缺省=超时无应答；
 *   skipped='bind' = 68 端口被占/无权绑定（探测能力缺失，调用方应静默降级）。
 */
function probeDhcp({ broadcastAddr = '192.168.31.255', timeoutMs = PROBE_TIMEOUT_MS, mac, socketFactory } = {}) {
  return new Promise((resolve) => {
    const make = socketFactory || ((cb) => cb(dgram.createSocket('udp4')));
    make((socket) => {
      if (!socket) return resolve({ ok: false, skipped: 'bind', reason: 'socketFactory 未提供 socket' });
      const { buf, xid } = buildDiscover({ mac });
      let settled = false;
      const done = (v) => { if (!settled) { settled = true; try { socket.close(); } catch { /* 已关 */ } resolve(v); } };
      const t0 = Date.now();
      const timer = setTimeout(() => done({ ok: false, reason: 'timeout' }), timeoutMs);
      socket.on('error', (err) => { clearTimeout(timer); done({ ok: false, skipped: 'bind', reason: err.message }); });
      socket.on('message', (msg) => {
        // BOOTREPLY（op=2）且 xid 匹配才认（防其它 DHCP 流量串扰）
        if (msg.length >= 4 && msg[0] === 2 && msg.readUInt32BE(4) === xid) {
          clearTimeout(timer);
          done({ ok: true, ms: Date.now() - t0 });
        }
      });
      socket.bind(68, () => {
        try {
          socket.setBroadcast(true);
          socket.send(buf, 0, buf.length, 67, broadcastAddr);
        } catch (err) {
          clearTimeout(timer);
          done({ ok: false, skipped: 'bind', reason: err.message });
        }
      });
      socket.on('EADDRINUSE-handled', () => {}); // noop：EADDRINUSE 走 error 事件
    });
  }).catch((err) => ({ ok: false, skipped: 'bind', reason: String(err && err.message) }));
}

module.exports = { buildDiscover, probeDhcp, DEFAULT_PROBE_MAC, PROBE_TIMEOUT_MS, parseProbeMac };
