/**
 * 打印机上传通道分流单测（2026-10-07 FTPS 批）：
 * P1/A1 新固件只开官方 FTPS(990)（21 明文口已关，实测）——FTPS 优先、FTP(21) 回退、
 * X1/H2D 仍走 SFTP(22)。mock basic-ftp 验证 connectFTPS 连接参数（端口/implicit TLS/凭证）。
 * 用法：node test/printer-upload-channel-test.js
 */
// 在 client.js 加载前把 basic-ftp 替换成 mock（client.js 顶层 require basic-ftp）
const basicFtpPath = require.resolve('basic-ftp');
class MockFTPSClient {
  constructor() { MockFTPSClient.instances.push(this); }
  async access(opts) {
    MockFTPSClient.accessCalls.push(opts);
    if (MockFTPSClient.accessShouldFail) throw new Error('mock access fail');
  }
  async uploadFrom(buf, remote) {
    MockFTPSClient.uploads.push(String(remote));
    if (MockFTPSClient.uploadShouldFail) throw new Error('mock upload fail');
  }
  close() { this.closed = true; }
}
MockFTPSClient.instances = [];
MockFTPSClient.accessCalls = [];
MockFTPSClient.uploads = [];
MockFTPSClient.accessShouldFail = false;
MockFTPSClient.uploadShouldFail = false;
require.cache[basicFtpPath] = {
  id: basicFtpPath, filename: basicFtpPath, loaded: true, exports: { Client: MockFTPSClient },
};

const assert = require('assert');
const PrinterClient = require('../src/printer/client.js');

let failures = 0;
let passed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures++;
    console.error(`  ✗ ${name}\n    ${err.message}`);
  }
}

function reset() {
  MockFTPSClient.instances = [];
  MockFTPSClient.accessCalls = [];
  MockFTPSClient.uploads = [];
  MockFTPSClient.accessShouldFail = false;
  MockFTPSClient.uploadShouldFail = false;
}

function makeClient(model) {
  return new PrinterClient({
    id: 1, name: `测试-${model}`, model,
    host: '192.168.2.189', accessCode: '12345678', serial: '00M09TEST',
  });
}

(async () => {
  console.log('== 上传通道分流 ==');

  await test('P1S：FTPS(990) 成功时不碰 FTP(21)', async () => {
    reset();
    const c = makeClient('P1S');
    let ftpCalled = 0;
    c.ftpPut = async () => { ftpCalled++; };
    await c.uploadBuffer(Buffer.from('x'), '/sdcard/a.3mf');
    assert.strictEqual(MockFTPSClient.uploads[0], '/sdcard/a.3mf');
    assert.strictEqual(ftpCalled, 0, 'FTP(21) 不应被调用');
  });

  await test('P1S：FTPS 失败回退 FTP(21) 且断开坏 FTPS 会话', async () => {
    reset();
    MockFTPSClient.uploadShouldFail = true;
    const c = makeClient('P1S');
    let ftpCalled = 0;
    c.ftpPut = async () => { ftpCalled++; };
    await c.uploadBuffer(Buffer.from('x'), '/sdcard/b.3mf');
    assert.strictEqual(ftpCalled, 1, 'FTP(21) 回退应被调用');
    assert.strictEqual(c.ftpsClient, null, 'FTPS 坏会话应被置空');
    assert.strictEqual(MockFTPSClient.instances[0].closed, true, 'FTPS 客户端应被 close');
  });

  await test('P1S：FTPS 与 FTP 双失败时错误信息含两个通道', async () => {
    reset();
    MockFTPSClient.uploadShouldFail = true;
    const c = makeClient('P1S');
    c.ftpPut = async () => { throw new Error('ECONNREFUSED 21'); };
    await assert.rejects(
      () => c.uploadBuffer(Buffer.from('x'), '/sdcard/c.3mf'),
      (err) => /FTPS\(990\)/.test(err.message) && /FTP\(21\)/.test(err.message) && /mock upload fail/.test(err.message)
    );
  });

  await test('X1C：仍走 SFTP(22)，不触发 FTPS/FTP', async () => {
    reset();
    const c = makeClient('X1C');
    let sftpCalled = 0;
    let ftpsCalled = 0;
    c.sftpPut = async () => { sftpCalled++; };
    c.ftpsPut = async () => { ftpsCalled++; };
    await c.uploadBuffer(Buffer.from('x'), '/sdcard/d.3mf');
    assert.strictEqual(sftpCalled, 1);
    assert.strictEqual(ftpsCalled, 0);
    assert.strictEqual(MockFTPSClient.accessCalls.length, 0);
  });

  await test('H2D：仍走 SFTP(22)', async () => {
    reset();
    const c = makeClient('H2D');
    let sftpCalled = 0;
    c.sftpPut = async () => { sftpCalled++; };
    await c.uploadBuffer(Buffer.from('x'), '/sdcard/e.3mf');
    assert.strictEqual(sftpCalled, 1);
  });

  console.log('== connectFTPS 连接参数 ==');

  await test('FTPS 连接：990 / implicit TLS / bblp + Access Code / 跳过自签校验', async () => {
    reset();
    const c = makeClient('P1S');
    await c.connectFTPS();
    const opts = MockFTPSClient.accessCalls[0];
    assert.strictEqual(opts.host, '192.168.2.189');
    assert.strictEqual(opts.port, 990);
    assert.strictEqual(opts.user, 'bblp');
    assert.strictEqual(opts.password, '12345678');
    assert.strictEqual(opts.secure, 'implicit');
    assert.strictEqual(opts.secureOptions.rejectUnauthorized, false);
  });

  await test('FTPS 连接失败时不残留客户端', async () => {
    reset();
    MockFTPSClient.accessShouldFail = true;
    const c = makeClient('P1S');
    await assert.rejects(() => c.connectFTPS(), /mock access fail/);
    assert.strictEqual(c.ftpsClient, null);
    assert.strictEqual(MockFTPSClient.instances[0].closed, true);
  });

  console.log('== disconnectFileSession 清理 ==');

  await test('disconnectFileSession 会同时清理 FTPS 会话', async () => {
    reset();
    const c = makeClient('P1S');
    await c.connectFTPS();
    assert.ok(c.ftpsClient);
    await c.disconnectFileSession();
    assert.strictEqual(c.ftpsClient, null);
    assert.strictEqual(MockFTPSClient.instances[0].closed, true);
  });

  console.log(failures === 0 ? `\n全部通过（${passed} 项）` : `\n${failures} 项失败`);
  process.exit(failures === 0 ? 0 : 1);
})();
