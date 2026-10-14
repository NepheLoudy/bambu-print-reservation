/**
 * RTSPS 模块纯逻辑单测（不连打印机）：RTP→H.264 重组器 / interleaved 分帧 /
 * RTP 头剥离 / digest 认证向量。用法：node test/rtsps-test.js
 */
const assert = require('assert');
const {
  H264Depacketizer,
  parseInterleavedFrames,
  rtpPayload,
  digestResponse,
} = require('../src/printer/rtsps');

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (err) {
    failures++;
    console.error(`✗ ${name} — ${err.message}`);
  }
}

// ---------- digest 认证（LIVE555 老式 MD5，回归向量锁定） ----------
check('digest response 回归向量', () => {
  const got = digestResponse({
    username: 'bblp',
    realm: 'LIVE555 Streaming Media',
    nonce: 'deadbeef',
    method: 'DESCRIBE',
    uri: 'rtsps://192.168.2.116:322/streaming/live/1',
    password: '12345678',
  });
  assert.strictEqual(got, 'ac03c648ca24325e1bfec4c1a6fb6724');
});

// ---------- H264Depacketizer：单 NALU ----------
check('单 NALU 包直接出 NALU', () => {
  const d = new H264Depacketizer();
  const out = d.push(Buffer.from([0x65, 1, 2, 3]));
  assert.strictEqual(out.length, 1);
  assert.deepStrictEqual([...out[0]], [0x65, 1, 2, 3]);
});

// ---------- H264Depacketizer：FU-A 分片重组 ----------
check('FU-A 三片重组，头由 S 片 indicator+type 还原', () => {
  const d = new H264Depacketizer();
  const ind = 0x7c; // F=0 NRI=3 type=28(FU-A)
  const p1 = d.push(Buffer.from([ind, 0x80 | 0x05, 0xaa, 0xbb])); // S=1, type=5(IDR)
  assert.strictEqual(p1.length, 0, 'S 片不应出 NALU');
  const p2 = d.push(Buffer.from([ind, 0x00, 0xcc])); // 中片
  assert.strictEqual(p2.length, 0);
  const p3 = d.push(Buffer.from([ind, 0x40, 0xdd])); // E=1
  assert.strictEqual(p3.length, 1);
  assert.deepStrictEqual([...p3[0]], [0x65, 0xaa, 0xbb, 0xcc, 0xdd]); // 头=0x60|0x05
});

check('FU-A 半途接入（无 S 片）被丢弃，不污染下个 NALU', () => {
  const d = new H264Depacketizer();
  const ind = 0x7c;
  assert.deepStrictEqual(d.push(Buffer.from([ind, 0x00, 0x01])), [], '无 S 的中片丢弃');
  const out = d.push(Buffer.from([ind, 0x80 | 0x01, 0x02]), );
  assert.strictEqual(out.length, 0);
  const done = d.push(Buffer.from([ind, 0x40, 0x03]));
  assert.strictEqual(done.length, 1);
  assert.deepStrictEqual([...done[0]], [0x61, 0x02, 0x03]);
});

// ---------- H264Depacketizer：STAP-A ----------
check('STAP-A 拆出多个 NALU', () => {
  const d = new H264Depacketizer();
  const nal1 = Buffer.from([0x67, 0x11, 0x22]);
  const nal2 = Buffer.from([0x68, 0x33]);
  const payload = Buffer.concat([
    Buffer.from([0x78]), // STAP-A
    (() => { const b = Buffer.alloc(2); b.writeUInt16BE(nal1.length); return b; })(), nal1,
    (() => { const b = Buffer.alloc(2); b.writeUInt16BE(nal2.length); return b; })(), nal2,
  ]);
  const out = d.push(payload);
  assert.strictEqual(out.length, 2);
  assert.deepStrictEqual([...out[0]], [...nal1]);
  assert.deepStrictEqual([...out[1]], [...nal2]);
});

check('未知类型（FU-B 29 等）丢弃', () => {
  const d = new H264Depacketizer();
  assert.deepStrictEqual(d.push(Buffer.from([0x1d, 0x00, 0x01])), []);
});

// ---------- parseInterleavedFrames ----------
check('完整 $ 帧切出，channel/data 正确', () => {
  const frame = Buffer.concat([
    Buffer.from([0x24, 0x00, 0x00, 0x04]),
    Buffer.from([1, 2, 3, 4]),
  ]);
  const { frames, rest } = parseInterleavedFrames(frame);
  assert.strictEqual(frames.length, 1);
  assert.strictEqual(frames[0].channel, 0);
  assert.deepStrictEqual([...frames[0].data], [1, 2, 3, 4]);
  assert.strictEqual(rest.length, 0);
});

check('帧尾未凑齐时整段保留等待', () => {
  const buf = Buffer.from([0x24, 0x00, 0x00, 0x08, 1, 2]); // 声称 8 字节只到 2
  const { frames, rest } = parseInterleavedFrames(buf);
  assert.strictEqual(frames.length, 0);
  assert.strictEqual(rest.length, buf.length);
});

check('回归：$ 帧后跟 RTSP 文本，文本必须原样保留（不被当垃圾吃掉）', () => {
  const payload = Buffer.from([9, 9, 9, 9]);
  const bin = Buffer.concat([
    Buffer.from([0x24, 0x00, 0x00, 0x04]), payload,
  ]);
  const text = Buffer.from('RTSP/1.0 200 OK\r\nCSeq: 5\r\n\r\n');
  const { frames, rest } = parseInterleavedFrames(Buffer.concat([bin, text]));
  assert.strictEqual(frames.length, 1, '二进制帧切出');
  assert.strictEqual(rest.toString('latin1'), text.toString('latin1'), 'RTSP 文本分毫不差');
});

check('非 $ 开头原样返回', () => {
  const buf = Buffer.from('RTSP/1.0 200 OK\r\n\r\n');
  const { frames, rest } = parseInterleavedFrames(buf);
  assert.strictEqual(frames.length, 0);
  assert.strictEqual(rest.toString('latin1'), buf.toString('latin1'));
});

// ---------- rtpPayload ----------
check('标准 12 字节头剥出 payload', () => {
  const frame = Buffer.concat([Buffer.from([0x80, 96, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1]), Buffer.from([5, 5])]);
  const payload = rtpPayload(frame);
  assert.ok(payload);
  assert.deepStrictEqual([...payload], [5, 5]);
});

check('CSRC 与扩展头计入头长', () => {
  // CC=1（+4B CSRC）、X=1（4B 固定 + 2 个 4B 字 = 12B 扩展）
  const head = Buffer.from([0x91, 96, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0xaa, 0xbb, 0xcc, 0xdd, 0x80, 96, 0, 2, 0, 0, 0, 2, 1, 2, 3, 4]);
  const payload = rtpPayload(Buffer.concat([head, Buffer.from([7])]));
  assert.ok(payload, 'payload 应剥离成功');
  assert.deepStrictEqual([...payload], [7]);
});

check('坏版本号返回 null', () => {
  const frame = Buffer.from([0x00, 96, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1]);
  assert.strictEqual(rtpPayload(frame), null);
});

process.exit(failures ? 1 : 0);
