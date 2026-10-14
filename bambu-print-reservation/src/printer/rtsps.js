'use strict';

/**
 * 拓竹 X1/H2D 系画面通道：RTSPS（RTSP over TLS）客户端（2026-10-15 观察台 v55）
 *
 * 协议事实（2026-10-15 真机 H2D 实测，PRINTER-LAN-API.md §1.5 同批落档）：
 *   - 端口 322（不是 P1 的 6000 裸流，也不是 554），TLS 1.3，服务器 = LIVE555
 *   - 请求 URI 的 scheme 必须写 rtsps://（写 rtsp:// 会 301 重定向）
 *   - digest 认证（MD5，realm="LIVE555 Streaming Media"），用户名 bblp、密码 = Access Code
 *   - SETUP 走 TCP interleaved（RTP/RTCP 混在 RTSP 连接里，$ + channel + len 分帧）
 *   - RTP payload type 96 = H.264（FU-A 分片为主），channel 1 = RTCP（丢弃）
 *
 * 输出面：把 RTP 载荷还原成 H.264 Annex-B 字节流（00 00 00 01 起始码 + NALU），
 * 与 P1 系 TCP6000 裸流完全同款——观察台的 WS 中继与 WebCodecs 前端零改动复用。
 */

const tls = require('tls');
const crypto = require('crypto');
const { EventEmitter } = require('events');

const RTSPS_PORT = 322;
const STREAM_PATH = '/streaming/live/1';
// TLS + RTSP 握手（OPTIONS→DESCRIBE×2→SETUP→PLAY）总预算
const HANDSHAKE_TIMEOUT_MS = 12000;

function md5(s) {
  return crypto.createHash('md5').update(s).digest('hex');
}

/** 计算 RTSP digest 认证的 response 字段（LIVE555 老式 MD5，无 opaque） */
function digestResponse({ username, realm, nonce, method, uri, password }) {
  const ha1 = md5(`${username}:${realm}:${password}`);
  const ha2 = md5(`${method}:${uri}`);
  return md5(`${ha1}:${nonce}:${ha2}`);
}

/**
 * RTP → H.264 NALU 重组器（纯逻辑，单测覆盖）。
 * push(rtpPayload) 返回本次凑齐的完整 NALU（裸 NALU，不含起始码）。
 * 支持：单 NALU（type 1-23）、STAP-A（24）、FU-A（28）；其余类型丢弃。
 */
class H264Depacketizer {
  constructor() {
    // FU-A 分片进行中的 NALU：{ headerByte, chunks: Buffer[] }
    this.fu = null;
  }

  push(payload) {
    if (!payload || payload.length < 1) return [];
    const out = [];
    const type = payload[0] & 0x1f;
    if (type >= 1 && type <= 23) {
      // 单 NALU 整包
      this._flushFu(out);
      out.push(Buffer.from(payload));
    } else if (type === 24) {
      // STAP-A：连续 [size:2B][NALU] 段
      this._flushFu(out);
      let off = 1;
      while (off + 2 <= payload.length) {
        const size = payload.readUInt16BE(off);
        off += 2;
        if (size < 1 || off + size > payload.length) break; // 坏包丢弃剩余
        out.push(Buffer.from(payload.subarray(off, off + size)));
        off += size;
      }
    } else if (type === 28) {
      // FU-A：payload[0]=indicator(F|NRI|28)，payload[1]=header(S|E|R|type)
      if (payload.length < 2) return out;
      const headerByte = (payload[0] & 0xe0) | (payload[1] & 0x1f);
      const fuData = payload.subarray(2);
      if (payload[1] & 0x80) {
        // S=1：新 NALU 开始（上片未收完就丢弃）
        this.fu = { headerByte, chunks: [Buffer.from(fuData)] };
      } else if (this.fu) {
        this.fu.chunks.push(Buffer.from(fuData));
      } else {
        return out; // 中途接入的半片，丢弃等下个 S
      }
      if (payload[1] & 0x40) {
        // E=1：封口出 NALU
        out.push(Buffer.concat([Buffer.from([this.fu.headerByte]), ...this.fu.chunks]));
        this.fu = null;
      }
    }
    // 其余类型（FU-B 29、聚合加密等）本链路不出现，丢弃
    return out;
  }

  _flushFu(out) {
    if (this.fu) {
      // 半截分片凑不齐就丢弃（TCP interleaved 不丢包，出现即异常）
      out.push(Buffer.concat([Buffer.from([this.fu.headerByte]), ...this.fu.chunks]));
      this.fu = null;
    }
  }
}

/**
 * 从 interleaved 字节流**起始位置**连续切帧（$ + channel:1 + len:2BE + data）。
 * 只在 buf 以 $ 开头时切帧，遇到非 $ 字节立即停手交还 RTSP 文本分支——
 * 流里二进制与 RTSP 响应混跑（实测 PLAY 响应前就有 RTCP SR 插队），
 * 绝不能跨内容类型跳字节，否则会把对端的响应文本当垃圾吃掉。
 * 返回 { frames, rest }；rest 为未凑齐的帧尾（等下一包）或非 $ 开头的余量。
 */
function parseInterleavedFrames(buf) {
  const frames = [];
  while (buf.length >= 4 && buf[0] === 0x24) {
    const len = buf.readUInt16BE(2);
    if (buf.length < 4 + len) break;
    frames.push({ channel: buf[1], data: buf.subarray(4, 4 + len) });
    buf = buf.subarray(4 + len);
  }
  return { frames, rest: buf };
}

/** 计算 RTP 头长度（含 CSRC 与扩展头），返回 payload；坏头返回 null */
function rtpPayload(frame) {
  if (frame.length < 12) return null;
  const b0 = frame[0];
  if ((b0 >> 6) !== 2) return null; // version
  let off = 12 + (b0 & 0x0f) * 4;
  if (b0 & 0x10) {
    // 扩展头：4B 固定段 + length 字段（4B 单位）指出的扩展体
    if (frame.length < off + 4) return null;
    off += 4 + frame.readUInt16BE(off + 2) * 4;
  }
  if (frame.length < off) return null;
  return frame.subarray(off);
}

const START_CODE = Buffer.from([0, 0, 0, 1]);

/**
 * 一条 RTSPS 观看会话：TLS 连接 + RTSP 握手 + interleaved RTP 消费。
 * 事件面与 net.Socket 对齐（'data'/'error'/'close' + destroy()）——
 * index.js 的 WS 中继与 P1 裸流共用同一套转发代码。
 * 每个观看客户端一条会话，断开即销毁，不在 client 内长驻。
 */
class RtpsSession extends EventEmitter {
  constructor({ host, username = 'bblp', password, path = STREAM_PATH, port = RTSPS_PORT }) {
    super();
    this.host = host;
    this.port = port;
    this.username = username;
    this.password = password;
    // RTSP 绝对 URI 的 scheme 必须 rtsps（rtsp 会被 301），host 不带端口（LIVE555 口径）
    this.uri = `rtsps://${host}${path}`;
    this.socket = null;
    this.depacketizer = new H264Depacketizer();
    this.rx = Buffer.alloc(0);
    this.cseq = 0;
    this.digest = null;
    this.session = null;
    this.streaming = false;
    this.destroyed = false;
    this._pending = null; // { resolve, reject, method } 当前等待的响应
    this._handshakeTimer = null;
  }

  connect() {
    this.socket = tls.connect(
      { host: this.host, port: this.port, rejectUnauthorized: false },
      () => this._request('OPTIONS')
    );
    this.socket.on('data', (chunk) => this._onData(chunk));
    this.socket.on('error', (err) => this._fail(err));
    this.socket.on('close', () => {
      if (!this.destroyed) this.emit('close');
    });
    this._handshakeTimer = setTimeout(() => {
      this._fail(new Error(`RTSPS 握手超时（${HANDSHAKE_TIMEOUT_MS / 1000}s，stage=${this._stage}）`));
    }, HANDSHAKE_TIMEOUT_MS);
    this._stage = 'tls';
    return this;
  }

  _request(method, extraHeaders = {}) {
    this._stage = method.toLowerCase();
    this.cseq += 1;
    let req = `${method} ${this.uri} RTSP/1.0\r\nCSeq: ${this.cseq}\r\nUser-Agent: bambu-print-reservation\r\n`;
    if (this.digest) {
      req += `Authorization: Digest username="${this.username}", realm="${this.digest.realm}", nonce="${this.digest.nonce}", uri="${this.uri}", response="${digestResponse({ ...this.digest, username: this.username, password: this.password, method, uri: this.uri })}"\r\n`;
    }
    if (this.session) req += `Session: ${this.session}\r\n`;
    for (const [k, v] of Object.entries(extraHeaders || {})) req += `${k}: ${v}\r\n`;
    req += '\r\n';
    this.socket.write(req);
  }

  _onData(chunk) {
    this.rx = Buffer.concat([this.rx, chunk]);
    // 统一状态机：RTSP 响应（文本）与 interleaved 流（二进制）在同一条 TLS 连接里
    // 混跑——实测 PLAY 响应回来前 RTCP SR 就先到，按缓冲区首字节分流处理
    for (;;) {
      if (this.destroyed) return;
      if (this.rx.length >= 4 && this.rx[0] === 0x24) {
        const { frames, rest } = parseInterleavedFrames(this.rx);
        if (!frames.length) return; // 帧尾未凑齐，等下一包
        this.rx = rest;
        for (const f of frames) {
          if (f.channel !== 0) continue; // channel 1 = RTCP，丢弃
          const payload = rtpPayload(f.data);
          if (!payload) continue;
          const pt = f.data[1] & 0x7f;
          if (pt !== 96) continue; // 非 H.264 动态流丢弃
          for (const nalu of this.depacketizer.push(payload)) {
            this.emit('data', Buffer.concat([START_CODE, nalu]));
          }
        }
        continue;
      }
      if (this.rx.length < 4) return; // 凑不出判定头，等
      if (this.rx.toString('latin1', 0, 4) !== 'RTSP') {
        // 流态下非 $ 非 RTSP=坏字节，逐字节重同步（TLS 流不应出现）；
        // 握手期出现同理——都没得解析的东西就不该在
        this.rx = this.rx.subarray(1);
        continue;
      }
      const lineEnd = this.rx.indexOf('\r\n\r\n');
      if (lineEnd < 0) return; // 头未收全
      const head = this.rx.subarray(0, lineEnd).toString('latin1');
      const lines = head.split('\r\n');
      const status = parseInt((lines[0].match(/RTSP\/1\.0 (\d+)/) || [])[1] || '0', 10);
      const hdr = {};
      for (const l of lines.slice(1)) {
        const m = l.match(/^([^:]+):\s*(.*)$/);
        if (m) hdr[m[1].toLowerCase()] = m[2];
      }
      const bodyLen = parseInt(hdr['content-length'] || '0', 10);
      const consumed = lineEnd + 4 + bodyLen;
      if (this.rx.length < consumed) return; // body 未收全（DESCRIBE 的 SDP）
      this.rx = this.rx.subarray(consumed);
      this._onResponse(status, hdr);
      if (this.destroyed) return;
    }
  }

  _onResponse(status, hdr) {
    if (status === 401 && hdr['www-authenticate'] && !this.digest) {
      this.digest = {
        realm: (hdr['www-authenticate'].match(/realm="([^"]+)"/) || [])[1],
        nonce: (hdr['www-authenticate'].match(/nonce="([^"]+)"/) || [])[1],
      };
      this._replayCurrent();
      return;
    }
    if (status !== 200) {
      this._fail(new Error(`RTSP ${this._stage} 失败（HTTP ${status}）`));
      return;
    }
    const sess = (hdr.session || '').split(';')[0];
    if (sess) this.session = sess;

    if (this._stage === 'options') {
      this._stage = 'describe';
      this._request('DESCRIBE', { Accept: 'application/sdp' });
    } else if (this._stage === 'describe') {
      this._stage = 'setup';
      this._request('SETUP', { Transport: 'RTP/AVP/TCP;interleaved=0-1' });
    } else if (this._stage === 'setup') {
      this._stage = 'play';
      this._request('PLAY', {});
    } else if (this._stage === 'play') {
      clearTimeout(this._handshakeTimer);
      this.streaming = true;
      // 缓冲里可能已攒着先到的流数据——外层 _onData 循环会继续消化，无需递归
      this.emit('open');
    }
  }

  /** 401 后带 digest 重发当前方法（同 CSeq 语义无必要，递增即可） */
  _replayCurrent() {
    const stage = this._stage;
    if (stage === 'describe') this._request('DESCRIBE', { Accept: 'application/sdp' });
    else if (stage === 'setup') this._request('SETUP', { Transport: 'RTP/AVP/TCP;interleaved=0-1' });
    else if (stage === 'play') this._request('PLAY', {});
    else this._request('OPTIONS');
  }

  _fail(err) {
    if (this.destroyed) return;
    clearTimeout(this._handshakeTimer);
    this.emit('error', err);
    this.destroy();
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    clearTimeout(this._handshakeTimer);
    // TEARDOWN 尽力而为：对端可能已不在，失败无所谓
    try {
      if (this.socket && !this.socket.destroyed && this.session) {
        this.cseq += 1;
        this.socket.write(`TEARDOWN ${this.uri} RTSP/1.0\r\nCSeq: ${this.cseq}\r\nSession: ${this.session}\r\n\r\n`);
      }
    } catch { /* ignore */ }
    try { this.socket && this.socket.destroy(); } catch { /* ignore */ }
    if (this.streaming) {
      this.streaming = false;
      this.emit('close');
    }
  }
}

module.exports = RtpsSession;
module.exports.RTSPS_PORT = RTSPS_PORT;
module.exports.STREAM_PATH = STREAM_PATH;
module.exports.H264Depacketizer = H264Depacketizer;
module.exports.parseInterleavedFrames = parseInterleavedFrames;
module.exports.rtpPayload = rtpPayload;
module.exports.digestResponse = digestResponse;
