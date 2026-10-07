// ============================================================
// dhcpProbe（v16）：主路由 DHCP 服务主动探测
// 背景：2026-10-07「新设备连上没网」事故的病灶之一=RD08 固件半死时 DHCP
// 服务僵死（新关联设备拿不到任何地址）。有线侧既有探针（lan/wan/traffic）
// 全部测不到——小电脑自己是静态 IP，不依赖 DHCP。
// 原理：构造最小 DHCPDISCOVER 广播（随机 xid/chaddr），绑 68 端口等
// BOOTREPLY（OFFER/ACK，op=2 且 xid 匹配）。DISCOVER 不写租约（REQUEST
// 才写），对路由器与真实租约零副作用。
// 兼容性：绑 68 需系统未占用；失败返回 skipped（调用方静默降级，不告警）。
// ============================================================

const dgram = require('dgram');

/** 构造最小 DHCPDISCOVER 报文（随机 xid + 随机 chaddr），返回 {buf, xid} */
function buildDiscover() {
  const xid = (Math.random() * 0xffffffff) >>> 0;
  const mac = Buffer.from(Array.from({ length: 6 }, () => Math.floor(Math.random() * 256)));
  const buf = Buffer.alloc(300); // 236 固定头 + options
  buf[0] = 1;  // op=BOOTREQUEST
  buf[1] = 1;  // htype=以太网
  buf[2] = 6;  // hlen=MAC6
  buf.writeUInt32BE(xid, 4);
  buf.writeUInt16BE(0x8000, 10); // flags=BROADCAST（回应走广播，不依赖本机 IP 态）
  mac.copy(buf, 28);             // chaddr
  buf.writeUInt32BE(0x63825363, 236); // magic cookie
  let off = 240;
  buf[off++] = 53; buf[off++] = 1; buf[off++] = 1; // option53=DHCPDISCOVER
  buf[off] = 255;                                   // end
  return { buf, xid };
}

/**
 * 单次探测：广播 DISCOVER，等待 xid 匹配的 BOOTREPLY。
 * @returns {Promise<{ok:boolean, skipped?:string, reason?:string, ms?:number}>}
 *   ok=true 收到 OFFER/ACK；ok=false 且 skipped 缺省=超时无应答；
 *   skipped='bind' = 68 端口被占/无权绑定（探测能力缺失，调用方应静默降级）。
 */
function probeDhcp({ broadcastAddr = '192.168.31.255', timeoutMs = 3000, socketFactory } = {}) {
  return new Promise((resolve) => {
    const make = socketFactory || ((cb) => cb(dgram.createSocket('udp4')));
    make((socket) => {
      if (!socket) return resolve({ ok: false, skipped: 'bind', reason: 'socketFactory 未提供 socket' });
      const { buf, xid } = buildDiscover();
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

module.exports = { buildDiscover, probeDhcp };
